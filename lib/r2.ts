/**
 * lib/r2.ts — Cloudflare R2(S3 호환) 저장소. tbfa 원본: ../tbfa-mis/lib/r2-client.ts (복사 2026-09-14 · put/get/publicUrl 추가)
 *   env: R2_ACCOUNT_ID · R2_ENDPOINT(선택) · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_BASE(선택 — 공개 버킷 도메인).
 *   공개 URL: R2_PUBLIC_BASE 가 있으면 `${base}/${key}` · 없으면 우리 서빙 함수 `/api/r2-image?key=`(netlify/functions/r2-image.ts).
 *   graceful: 미설정이면 r2Configured()=false — 호출부가 정직하게 «이미지 저장소 미설정»으로 처리.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function r2Put(key: string, bytes: Uint8Array | Buffer, contentType: string): Promise<{ key: string; url: string }> {
  const client = getR2Client();
  await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
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

/* ───────── P1R5 §2.1 — presigned 3종 ─────────
 *   러너에 **R2 자격을 주지 않는다**(CLAUDE §4.7 «평문 표면 2곳»). 대신 서버가 잡을 내려줄 때
 *   읽을 것은 presigned GET, 올릴 곳은 presigned PUT 으로 **URL 만** 쥐여 준다(유효시간 제한).
 *
 *   🔴 **정본은 B-1 판**(메인 정리 2026-09-14 · 검수 화면이 mp4·wav·srt 를 틀어야 하는데 `/api/r2-image` 는
 *      png/jpg/webp 전용 + 인증 없음이라 테넌트 자산을 못 태운다 · §4.6). 시그니처:
 *        r2PresignGet(key, ttlSec = 21600) · r2PresignPut(key, contentType, ttlSec = 3600) · r2Head(key)
 *   ⚠️ 2026-09-14 현재 B-1 판이 **아직 main 에 없다**(main 947d16c 확인) — 없는 모듈을 import 할 수 없어
 *      아래 정의를 그대로 둔다. 대신 **이름·인자 순서·기본값을 B-1 정본에 맞춰** 놨으므로,
 *      B-1 판이 들어오면 이 블록만 지우면 된다 — **호출부는 한 줄도 바뀌지 않는다**. */

/** 객체가 실제로 있나 + 크기. 🔴 «러너가 올렸다»는 주장을 믿지 않고 이걸로 확인한다(계약 §2.1). 없으면 null. */
export async function r2Head(key: string): Promise<{ bytes: number; contentType: string } | null> {
  try {
    const r = await getR2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { bytes: Number(r.ContentLength ?? 0), contentType: r.ContentType || "application/octet-stream" };
  } catch { return null; }
}

/** 올리기용 서명 URL(러너가 mp4·포스터를 직접 PUT — 함수 본문 6MB 벽 우회). */
export async function r2PresignPut(key: string, contentType: string, ttlSec = 3_600): Promise<string> {
  return getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: ttlSec });
}

/** 읽기용 서명 URL(러너가 클립·이미지·오디오를 내려받는다). 공개 버킷이 아니어도 된다. */
export async function r2PresignGet(key: string, ttlSec = 21_600): Promise<string> {
  return getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: ttlSec });
}

/** 공개 URL — R2_PUBLIC_BASE(공개 버킷 커스텀 도메인) 있으면 직접, 없으면 서빙 함수 경유. */
export function r2PublicUrl(key: string): string {
  const base = String(process.env.R2_PUBLIC_BASE || "").replace(/\/$/, "");
  if (base) return `${base}/${key}`;
  const site = String(process.env.SITE_URL || "").replace(/\/$/, "");
  return `${site}/api/r2-image?key=${encodeURIComponent(key)}`;
}
