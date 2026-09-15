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
export async function r2Put(key: string, bytes: Uint8Array | Buffer, contentType: string, cacheControl = "public, max-age=31536000, immutable"): Promise<{ key: string; url: string }> {
  const client = getR2Client();
  await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: contentType, CacheControl: cacheControl }));
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

/** 읽기 서명 URL — 화면이 presign 을 따로 요청하지 않도록 **서버가 채워서** 내려보낸다(A 전제). */
export async function r2PresignGet(key: string, ttlSec: number = PRESIGN_GET_TTL_SEC): Promise<string> {
  const client = getR2Client();
  return await getSignedUrl(client, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: ttlSec });
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
