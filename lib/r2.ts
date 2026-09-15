/**
 * lib/r2.ts — Cloudflare R2(S3 호환) 저장소. tbfa 원본: ../tbfa-mis/lib/r2-client.ts (복사 2026-09-14 · put/get/publicUrl 추가)
 *   env: R2_ACCOUNT_ID · R2_ENDPOINT(선택) · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_BASE(선택 — 공개 버킷 도메인).
 *   공개 URL: R2_PUBLIC_BASE 가 있으면 `${base}/${key}` · 없으면 우리 서빙 함수 `/api/r2-image?key=`(netlify/functions/r2-image.ts).
 *   graceful: 미설정이면 r2Configured()=false — 호출부가 정직하게 «이미지 저장소 미설정»으로 처리.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

export function r2Configured(): boolean {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  return !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && endpoint && process.env.R2_BUCKET);
}

export function getR2Client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("[R2] 환경변수가 누락되었습니다 (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT|R2_ACCOUNT_ID)");
  }
  _client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: false });
  return _client;
}

export const R2_BUCKET: string = process.env.R2_BUCKET || "autocreate";

/** 안전한 키 — `pieces/{tid}/{pieceId}/{ts}_{rand}.png` 처럼 호출부가 접두를 정한다. */
export function safeKey(prefix: string, ext: string): string {
  const p = String(prefix || "etc").replace(/[^a-z0-9_\-/]/gi, "").replace(/^\/+|\/+$/g, "").slice(0, 120) || "etc";
  const e = String(ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${p}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${e}`;
}

/**
 * 기본 캐시는 **영구·불변**이다 — 우리 키는 대부분 `safeKey()` 로 이름이 매번 달라서 그래도 된다.
 * 🔴 그러나 **이름이 고정인 파일**(예: `runner/latest.json`)에 그 헤더를 쓰면 새로 올려도 옛 값이 한참 읽힌다 —
 *    자동 업데이트가 «조용히» 멈춘다. 그런 파일은 호출부가 짧은 캐시를 직접 준다.
 */
export async function r2Put(key: string, bytes: Uint8Array | Buffer, contentType: string, cacheControl = "public, max-age=31536000, immutable", contentDisposition?: string): Promise<{ key: string; url: string }> {
  const client = getR2Client();
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: contentType, CacheControl: cacheControl,
    // 저장해 두는 «이 이름으로 저장» — presign 의 ResponseContentDisposition 이 우선이지만, 서명 없이 열릴 때의 보루다.
    ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
  }));
  return { key, url: r2PublicUrl(key) };
}

export async function r2Get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const client = getR2Client();
    const r = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!r.Body) return null;
    const bytes = await r.Body.transformToByteArray();
    return { bytes, contentType: r.ContentType || "application/octet-stream" };
  } catch { return null; }
}

/** 공개 URL — R2_PUBLIC_BASE(공개 버킷 커스텀 도메인) 있으면 직접, 없으면 서빙 함수 경유. */
export function r2PublicUrl(key: string): string {
  const base = String(process.env.R2_PUBLIC_BASE || "").replace(/\/$/, "");
  if (base) return `${base}/${key}`;
  const site = String(process.env.SITE_URL || "").replace(/\/$/, "");
  return `${site}/api/r2-image?key=${encodeURIComponent(key)}`;
}

/* ═══════════ [P1R5 §2.1·§2.3b] presigned URL ═══════════
 *   🔴 담당 주의: 계약 §2.3b 는 `r2Head·r2PresignPut·r2PresignGet` 을 **B2 의 append-only 추가분**으로 적었다.
 *      B2 본체가 머지되기 전에 검수 화면(A)이 영상·자막을 재생해야 해서 **B-1 이 먼저 넣는다** — B2 는 중복 정의하지 말고 이것을 쓴다(메인에 통보 완료).
 *   왜 공개 URL 이 아닌가: `/api/r2-image` 는 png/jpg/webp 만 서빙하고 **인증이 없다**. 영상·나레이션·자막은 테넌트 자산이라
 *      키를 아는 사람이면 누구나 받는 상태를 만들 수 없다 → 짧은 수명의 서명 URL 로만 내려보낸다(§4.6 교차 누수 0).
 */
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** 검수 화면이 한 번 열어 끝까지 재생할 만큼(기본 6시간 · 상한 7일 = SigV4 한계). */
export const PRESIGN_GET_TTL_SEC = Math.min(604_800, Math.max(60, Number(process.env.R2_PRESIGN_TTL_SEC || "21600")));

/**
 * 읽기 서명 URL — 화면이 presign 을 따로 요청하지 않도록 **서버가 채워서** 내려보낸다(A 전제).
 *
 * `filename` 을 주면 «이 이름으로 저장» 을 **서명 안에** 담는다(`ResponseContentDisposition`).
 * 🔴 왜 서명에 담아야 하나(2026-09-15 A 발견): 받는 곳은 R2 도메인이라 **우리 화면과 출처가 다르다** —
 *    `<a download="...">` 는 cross-origin 에서 **무시된다**. 그래서 이름을 안 담으면 브라우저는 키 이름으로 저장하고,
 *    고객 다운로드 폴더에는 «v1.1.3.zip» 처럼 **무엇인지 알 수 없는 파일**이 남는다.
 *    이름은 서명에 들어가므로 나중에 URL 을 만져 바꿀 수도 없다(서명이 깨진다).
 */
export async function r2PresignGet(key: string, ttlSec: number = PRESIGN_GET_TTL_SEC, opts: { filename?: string } = {}): Promise<string> {
  const client = getR2Client();
  const cd = contentDisposition(opts.filename);
  return await getSignedUrl(client, new GetObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    ...(cd ? { ResponseContentDisposition: cd } : {}),
  }), { expiresIn: ttlSec });
}

/**
 * «이 이름으로 저장» 헤더 한 줄을 만든다 — **한글 파일이름까지** 간다(RFC 5987).
 *
 *   🔴 왜 두 벌을 싣나: `filename="…"` 은 **ASCII 만** 안전하다. 한글을 그대로 넣으면 브라우저마다 다르게 깨지고,
 *      어떤 브라우저는 헤더 전체를 버린다 — 그러면 고객 폴더에 R2 키 이름(`v1.1.5.zip`·`AC-329-….mp4`)이 남는다.
 *      RFC 5987 의 `filename*=UTF-8''<percent-encoded>` 가 유니코드용이고, **둘 다 실으면**
 *      새 브라우저는 `filename*` 을, 옛 브라우저는 ASCII 폴백을 쓴다(표준이 그렇게 고르라고 정해 뒀다).
 *   🔴 이게 없어서 B-1 이 영상 파일이름에서 **한글 제목을 떨어뜨리고** `AC-329-20260915.mp4` 를 쓰고 있었다 —
 *      고객이 받는 건 «내 영상 제목»이 아니었다. 프리사인은 교차 출처라 화면의 `<a download>` 도 무시되므로
 *      **헤더 말고 방법이 없다**(2026-09-15 A·B-1 발견).
 *   방어: 따옴표·역슬래시·개행은 헤더를 깨뜨리므로 제거하고, ASCII 폴백은 비ASCII 를 `_` 로 바꾼다.
 */
export function contentDisposition(filename?: string): string {
  const raw = String(filename ?? "").replace(/[\r\n"\\]/g, "").trim().slice(0, 120);
  if (!raw) return "";
  const ascii = raw.replace(/[^\x20-\x7E]/g, "_").replace(/\s+/g, " ").trim() || "download";
  // 이름이 전부 ASCII 면 한 벌이면 충분하다(헤더를 괜히 길게 만들지 않는다).
  if (ascii === raw) return `attachment; filename="${ascii}"`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}
/** 쓰기 서명 URL — 러너가 mp4·포스터를 직접 PUT 한다(6MB 본문 우회 · 러너에 R2 자격 0). */
export async function r2PresignPut(key: string, contentType: string, ttlSec = 3600): Promise<string> {
  const client = getR2Client();
  return await getSignedUrl(client, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: ttlSec });
}
/** 실존 확인 — 러너의 «올렸다»는 주장을 믿지 않고 서버가 직접 본다(§2.1). 없으면 null. */
export async function r2Head(key: string): Promise<{ bytes: number; contentType: string } | null> {
  try {
    const client = getR2Client();
    const r = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { bytes: Number(r.ContentLength || 0), contentType: String(r.ContentType || "application/octet-stream") };
  } catch { return null; }
}

/* ═══════════ 삭제(2026-09-15 · 메인 발주) — 🔴 되돌릴 수 없다. R2 는 버전 관리가 없다(AC-37). ═══════════
 *   쓰는 곳: 테스트 잔재 정리 · (앞으로) 테넌트 삭제·탈퇴 · 내보내기 만료 정리. 지금 리포에 테넌트 삭제 흐름은 **없다**(호출처 0 · 2026-09-15 grep).
 *   🔴 접두 삭제는 **테넌트 접두(`autocreate/{tid}/`)만** 받는다 — `autocreate/` 통째나 공용 `autocreate/bgm/` 은 거부한다(한 줄 실수로 전 테넌트 자산이 날아가는 일 0).
 *   삭제 전에 몇 개인지 세고(`dryRun`) 지운 키 수를 돌려준다 — «지웠다»는 말은 숫자와 함께만. */
import { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function r2Delete(key: string): Promise<boolean> {
  if (!/^autocreate\/[^/]+\/.+/.test(key)) throw new Error(`[R2] 삭제 거부 — 테넌트 자산 키가 아닙니다: ${key}`);
  const client = getR2Client();
  try { await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })); return true; }
  catch (e) { console.error("[R2] delete 실패", key, String((e as Error)?.message ?? e).slice(0, 120)); return false; }
}

/** 접두 아래 키 목록(페이지 전부 · 상한 `max`). 목록만 — 지우지 않는다. */
export async function r2ListPrefix(prefix: string, max = 5000): Promise<string[]> {
  const client = getR2Client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token && keys.length < max);
  return keys.slice(0, max);
}

/**
 * r2DeletePrefix — 테넌트 접두 아래를 전부 지운다. 🔴 `autocreate/{tid}/` 꼴만(숫자 tid) · 공용 접두 거부.
 *   `dryRun:true` 면 세기만 한다. 반환 = { listed, deleted, failed }.
 */
export async function r2DeletePrefix(prefix: string, opts: { dryRun?: boolean; max?: number } = {}): Promise<{ listed: number; deleted: number; failed: number; keys: string[] }> {
  if (!/^autocreate\/\d+\/$/.test(prefix)) throw new Error(`[R2] 접두 삭제 거부 — 'autocreate/{tid}/' 꼴만 받습니다: ${prefix}`);
  const keys = await r2ListPrefix(prefix, opts.max ?? 5000);
  if (opts.dryRun || !keys.length) return { listed: keys.length, deleted: 0, failed: 0, keys };
  const client = getR2Client();
  let deleted = 0, failed = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const r = await client.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
      const errs = r.Errors?.length ?? 0;
      failed += errs; deleted += batch.length - errs;
      for (const e of r.Errors ?? []) console.error("[R2] 접두 삭제 실패", e.Key, e.Message);
    } catch (e) { failed += batch.length; console.error("[R2] 접두 삭제 배치 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
  }
  console.log(`[R2] ${prefix} 아래 ${deleted}/${keys.length} 삭제${failed ? ` · 실패 ${failed}` : ""}`);
  return { listed: keys.length, deleted, failed, keys };
}
