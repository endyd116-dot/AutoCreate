/**
 * lib/publish/wordpress.ts — 워드프레스 발행 커넥터(계약 §3 · DESIGN §2.1 «API · REST + Application Password»).
 *   AC 신규 2026-09-14(B2).
 *
 *   순서(계약 §3 그대로): **이미지 먼저** → 본문 치환 → 글.
 *     ① 우리 R2 이미지를 내려받아 `POST {site}/wp-json/wp/v2/media`(Basic · Content-Disposition) → `source_url`
 *     ② bodyHtml 안의 R2 URL 을 워드프레스 URL 로 치환(남의 사이트 글이 우리 R2 를 핫링크하지 않게 — R2 를 지우면 글이 깨진다)
 *     ③ `POST {site}/wp-json/wp/v2/posts` { status:"publish", title, content, tags }
 *   태그는 워드프레스가 **term id** 를 요구한다 → 이름으로 찾고 없으면 만든다. 태그가 실패해도 **글은 올린다**(태그는 부가 정보).
 *
 *   자격: `account_creds(kind 'app_password')` = { siteUrl, loginId, appPassword }. 🔴 이 파일 밖으로 나가지 않는다.
 */
import { loadWpCreds } from "./tokens";
import type { PublishPiece, PublishAccount } from "./contract";
import type { ConnectorResult } from "./blogger";

const TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function basicAuth(loginId: string, appPassword: string): string {
  // 워드프레스 앱 비밀번호는 4자씩 공백으로 끊어 보여 준다 — 공백은 빼고 보낸다.
  return `Basic ${Buffer.from(`${loginId}:${String(appPassword).replace(/\s+/g, "")}`, "utf8").toString("base64")}`;
}

async function wpFetch(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
    const text = await r.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* HTML 에러 페이지 */ }
    return { status: r.status, json, text: text.slice(0, 400) };
  } finally { clearTimeout(t); }
}

function extOf(url: string, contentType: string): string {
  const fromCt = /image\/(png|jpeg|jpg|webp|gif)/i.exec(contentType)?.[1];
  if (fromCt) return fromCt === "jpeg" ? "jpg" : fromCt.toLowerCase();
  const m = /\.(png|jpe?g|webp|gif)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/** 이미지 1장 업로드 → 워드프레스 URL. 실패는 null(그 장만 원본 URL 로 남는다 — 발행을 막지 않는다). */
async function uploadMedia(site: string, auth: string, imageUrl: string, caption?: string, alt?: string): Promise<string | null> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let buf: ArrayBuffer; let ct: string;
    try {
      const src = await fetch(imageUrl, { signal: ctrl.signal });
      if (!src.ok) return null;
      ct = String(src.headers.get("content-type") ?? "image/jpeg");
      buf = await src.arrayBuffer();
    } finally { clearTimeout(t); }
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return null;
    const name = `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(imageUrl, ct)}`;
    const up = await wpFetch(`${site}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": ct.startsWith("image/") ? ct : "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
      body: Buffer.from(buf),
    });
    if (up.status < 200 || up.status >= 300) return null;
    const id = Number(up.json?.id ?? 0);
    const srcUrl = String(up.json?.source_url ?? "").trim();
    /* 🔴 alt 와 caption 을 **따로** 보낸다(§5C · B-1 84a2372 이후).
       종전엔 `alt_text: caption` 이었는데, 캡션이 «대부분 없다»로 바뀌면서 그대로 두면 **alt 가 통째로 빈다** —
       스크린리더에서 사진이 사라지고 이미지 검색에서도 빠진다. alt 는 없으면 캡션으로, 그것도 없으면 빈 값.
       🔴 캡션이 없어도 alt 만 있으면 보내야 하므로 조건도 «둘 중 하나라도 있으면» 으로 넓힌다
          (종전 `if (id && caption)` 은 캡션 없는 사진의 alt 를 **영영 안 보냈다**). */
    const altText = String(alt ?? caption ?? "").slice(0, 200);
    if (id && (caption || altText)) {
      // 실패해도 무시(이미지는 이미 올라갔다).
      await wpFetch(`${site}/wp-json/wp/v2/media/${id}`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ...(caption ? { caption } : {}), alt_text: altText }),
      }).catch(() => null);
    }
    return srcUrl || null;
  } catch { return null; }
}

/** 태그 이름 → term id(없으면 만든다). 실패한 이름은 건너뛴다. */
async function resolveTagIds(site: string, auth: string, names: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const raw of names.slice(0, 15)) {
    const name = String(raw).trim().replace(/^#/, "").slice(0, 40);
    if (!name) continue;
    try {
      const found = await wpFetch(`${site}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=10`, { headers: { Authorization: auth } });
      const hit = Array.isArray(found.json) ? found.json.find((t: any) => String(t?.name ?? "").toLowerCase() === name.toLowerCase()) : null;
      if (hit?.id) { out.push(Number(hit.id)); continue; }
      const made = await wpFetch(`${site}/wp-json/wp/v2/tags`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ name }),
      });
      // 이미 있으면 400 + data.term_id 로 돌려준다(워드프레스 관례).
      const id = Number(made.json?.id ?? made.json?.data?.term_id ?? 0);
      if (id) out.push(id);
    } catch { /* 이 태그만 건너뛴다 */ }
  }
  return out;
}

export async function publishToWordpress(piece: PublishPiece, account: PublishAccount): Promise<ConnectorResult> {
  const creds = await loadWpCreds(account.id);
  if (!creds) return { ok: false, reason: "no_creds", retriable: false, error: "워드프레스 로그인 정보가 없어요. 계정을 다시 연결해 주세요." };
  const site = creds.siteUrl;
  const auth = basicAuth(creds.loginId, creds.appPassword);

  // ① 이미지 → ② 본문 치환
  let html = piece.bodyHtml;
  for (const img of piece.images) {
    const url = String(img.url || "").trim();
    if (!url || !html.includes(url)) continue;
    const wpUrl = await uploadMedia(site, auth, url, img.caption, img.alt);
    if (wpUrl) html = html.split(url).join(wpUrl);
  }

  // ③ 태그(실패해도 글은 올린다)
  let tagIds: number[] = [];
  if (piece.tags.length) { try { tagIds = await resolveTagIds(site, auth, piece.tags); } catch { tagIds = []; } }

  const body: Record<string, unknown> = { title: String(piece.title || "").slice(0, 300), content: html, status: "publish" };
  if (tagIds.length) body.tags = tagIds;

  let res: Awaited<ReturnType<typeof wpFetch>>;
  try {
    res = await wpFetch(`${site}/wp-json/wp/v2/posts`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: "network", retriable: true, error: "워드프레스에 연결하지 못했어요. 잠시 후 다시 시도할게요.", detail: String((e as Error)?.message ?? e).slice(0, 160) };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "auth_failed", retriable: false, error: "워드프레스 로그인 정보를 확인해 주세요(앱 비밀번호).", detail: `http_${res.status}` };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, reason: "channel_error", retriable: true, error: "워드프레스가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `http_${res.status}` };
  }
  const link = String(res.json?.link ?? "").trim();
  const id = String(res.json?.id ?? "").trim();
  if (res.status < 200 || res.status >= 300 || !link) {
    return { ok: false, reason: "channel_error", retriable: false, error: "워드프레스가 글을 받지 않았어요.", detail: `http_${res.status} ${String(res.json?.message ?? res.text).slice(0, 160)}` };
  }
  return { ok: true, externalUrl: link, ...(id ? { channelRef: id } : {}) };
}
