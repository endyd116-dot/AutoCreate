/**
 * lib/publish/retract-api.ts — **API 채널에서 글을 지운다**(DESIGN §5E · R8 §3).
 *   지금 길이 있는 곳은 둘뿐이다: **워드프레스**·**블로거**. 나머지는 `channel-registry.retractVia` 가 `null` 이라 여기 오지 않는다.
 *
 *   🔴 **«올릴 수 있다»가 «내릴 수 있다»가 아니다**(2026-09-15 실측):
 *     · `wordpress` — 앱 비밀번호 그대로 `DELETE /wp-json/wp/v2/posts/{id}?force=true`. **추가 권한 없음.**
 *     · `blogger`   — OAuth 스코프가 `auth/blogger`(전체)라 `posts.delete` 가 된다.
 *     · 🔴 `youtube_shorts` — 스코프가 `youtube.upload`·`youtube.readonly`·`yt-analytics-monetary.readonly` 뿐이라
 *       **`videos.delete` 권한이 없다**. 늘리면 **연결된 계정이 전부 재동의**해야 해서 조용히 켜지 않았다.
 *
 *   🔴 **«없음»이 성공이다**(§5E.3 · AC-9 의 반대 얼굴). 404 는 실패가 아니라 `alreadyGone` 이다 —
 *      고객이 방금 직접 지웠을 수도 있고, 우리가 아까 지웠는데 응답을 못 받았을 수도 있다. 둘 다 **원하는 상태**다.
 *
 *   🔴 **force 삭제**를 쓴다(휴지통에 남기지 않는다). 고객이 «내려 줘»를 누른 뜻은 «안 보이게 해 줘»이고,
 *      휴지통에 있는 글은 «내려갔다»고 확인할 때 404 를 주므로 우리 확인은 통과하지만 고객 관리화면엔 남는다 —
 *      그 어긋남이 나중에 «내렸다면서 왜 있냐»가 된다.
 */
import { loadWpCreds, ensureFreshToken } from "./tokens";

const TIMEOUT_MS = 20_000;

export type RetractApiResult =
  | { ok: true; alreadyGone: boolean; detail?: string }
  | { ok: false; error: string; detail?: string };

interface Ctx { channel: string; accountId: number | null; externalUrl: string; channelRef: string }

async function call(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text().catch(() => "");
    return { status: r.status, text: text.slice(0, 400) };
  } finally { clearTimeout(t); }
}

/** 글 주소에서 숫자 id 를 건진다 — `channelRef` 가 비었을 때의 예비(발행이 옛 판이라 안 적힌 행이 있다). */
function idFromUrl(url: string): string {
  const m = /[?&]p=(\d+)\b/.exec(String(url ?? "")) ?? /\/(\d+)(?:\/|$)/.exec(String(url ?? ""));
  return m ? m[1] : "";
}

export async function retractViaApi(tid: number, ctx: Ctx): Promise<RetractApiResult> {
  if (!ctx.accountId) return { ok: false, error: "어느 계정으로 올린 글인지 몰라서 내리지 못했어요." };

  if (ctx.channel === "wordpress") {
    const creds = await loadWpCreds(ctx.accountId);
    if (!creds) return { ok: false, error: "워드프레스 연결이 풀렸어요. 다시 연결한 뒤 내려 주세요." };
    const id = String(ctx.channelRef || idFromUrl(ctx.externalUrl)).trim();
    if (!id) return { ok: false, error: "그 글의 번호를 몰라서 내리지 못했어요. 직접 내려 주세요." };
    const auth = `Basic ${Buffer.from(`${creds.loginId}:${String(creds.appPassword).replace(/\s+/g, "")}`, "utf8").toString("base64")}`;
    const r = await call(`${creds.siteUrl}/wp-json/wp/v2/posts/${encodeURIComponent(id)}?force=true`, {
      method: "DELETE", headers: { Authorization: auth, Accept: "application/json" },
    }).catch((e) => ({ status: 0, text: String((e as Error)?.message ?? e).slice(0, 200) }));
    if (r.status === 404 || r.status === 410) return { ok: true, alreadyGone: true };   // 🔴 «없음»이 성공
    if (r.status === 401 || r.status === 403) return { ok: false, error: "워드프레스가 권한을 거절했어요. 앱 비밀번호를 다시 확인해 주세요.", detail: r.text };
    if (r.status >= 200 && r.status < 300) return { ok: true, alreadyGone: false };
    return { ok: false, error: "워드프레스에서 글을 내리지 못했어요.", detail: `HTTP ${r.status} ${r.text}` };
  }

  if (ctx.channel === "blogger") {
    const tok = await ensureFreshToken(tid, ctx.accountId, "blogger", "");
    if (!tok.ok) return { ok: false, error: "블로거 연결이 풀렸어요. 다시 연결한 뒤 내려 주세요." };
    const blogId = String((tok.token.extra as Record<string, unknown> | undefined)?.blogId ?? tok.token.externalId ?? "").trim();
    const postId = String(ctx.channelRef || "").trim();
    if (!blogId || !postId) return { ok: false, error: "그 글의 번호를 몰라서 내리지 못했어요. 직접 내려 주세요." };
    const r = await call(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${tok.token.accessToken}` },
    }).catch((e) => ({ status: 0, text: String((e as Error)?.message ?? e).slice(0, 200) }));
    if (r.status === 404 || r.status === 410) return { ok: true, alreadyGone: true };   // 🔴 «없음»이 성공
    if (r.status === 401 || r.status === 403) return { ok: false, error: "블로거가 권한을 거절했어요. 블로거를 다시 연결해 주세요.", detail: r.text };
    if (r.status >= 200 && r.status < 300) return { ok: true, alreadyGone: false };
    return { ok: false, error: "블로거에서 글을 내리지 못했어요.", detail: `HTTP ${r.status} ${r.text}` };
  }

  /* 🔴 여기 오면 표(`channel-registry.retractVia`)와 이 파일이 **갈라진 것**이다 — 조용히 성공시키지 않는다. */
  return { ok: false, error: `«${ctx.channel}» 은 우리가 대신 내려 드릴 수 없어요. 직접 내려 주세요.`, detail: "retractVia 는 api 인데 이 파일에 길이 없다(표와 코드가 갈라졌다)" };
}
