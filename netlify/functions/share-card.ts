/**
 * GET /api/share-card?month=YYYY-MM&handles=0|1&channels=0|1 → { ok:true, imageUrl, expiresAt, amountKrw, month }
 *   결과 공유 카드(계약 P1R6 §2.2) — **서버 렌더**(화면 canvas 합성 금지 · `lib/share-card/render.ts`).
 *
 *   🔴 파일명이 `share-card` 여야 한다 — `netlify.toml` 의 `[functions."share-card"] included_files` 가
 *      **이 이름에** 폰트를 매달아 놨다(이름을 바꾸면 리눅스에서 한글이 네모로 나온다).
 *   🔴 **수익 0원이면 만들지 않는다**(«아직 자랑할 게 없어요») — 0원 카드를 올리게 하는 건 서비스가 할 일이 아니다.
 *   🔴 **핸들·채널은 꺼짐이 기본** — `handles=1`·`channels=1` 을 **명시**해야 들어간다(§2.2 · DESIGN §16·§7.3).
 *   이미지 = R2 `autocreate/{tid}/share/{month}-{옵션}.png` · presigned **24시간**.
 *   같은 달·같은 옵션이면 **다시 굽지 않는다**(키가 같다 · R2 HEAD 로 확인 후 서명만 새로 준다).
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { r2Put, r2Head, r2PresignGet, r2Configured } from "../../lib/r2";
import { summary } from "../../lib/revenue/aggregate";
import { listAccounts } from "../../lib/accounts";
import { renderCard } from "../../lib/share-card/render";

export const config = { path: "/api/share-card" };
/** presigned 유효기간(계약 §2.2 «24h»). */
export const CARD_URL_TTL_SEC = 24 * 3600;
const MONTH_RE = /^\d{4}-\d{2}$/;
/** «2026-09» 기본값 = 이번 달(KST). */
function thisMonthKst(): string {
  const k = new Date(Date.now() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    const url = new URL(req.url);
    const month = MONTH_RE.test(url.searchParams.get("month") ?? "") ? String(url.searchParams.get("month")) : thisMonthKst();
    const wantHandles = url.searchParams.get("handles") === "1";
    const wantChannels = url.searchParams.get("channels") === "1";

    const s = await summary(tid, month);
    const amountKrw = Math.max(0, Math.round(Number(s.monthKrw ?? 0)));
    // 🔴 0원이면 만들지 않는다 — 화면이 이 문장을 그대로 띄운다.
    if (amountKrw <= 0) return json({ ok: false, step: "empty", error: "아직 자랑할 게 없어요. 수익이 들어오면 카드를 만들어 드릴게요." }, 200);

    if (!r2Configured()) return json({ ok: false, step: "not_configured", error: "이미지 저장소가 아직 준비 중이에요. 곧 열려요." }, 200);

    let handles: string[] | undefined;
    let channels: string[] | undefined;
    if (wantHandles || wantChannels) {
      const accounts = await listAccounts(tid);
      if (wantChannels) channels = [...new Set(accounts.map((a) => a.channel))].slice(0, 4);
      if (wantHandles) handles = [...new Set(accounts.map((a) => a.handle).filter(Boolean))].slice(0, 4);
    }

    // 키에 옵션을 녹인다 — 같은 달이라도 «핸들 켠 카드»와 «끈 카드»는 다른 그림이다.
    const key = `autocreate/${tid}/share/${month}-h${wantHandles ? 1 : 0}c${wantChannels ? 1 : 0}.png`;
    const have = await r2Head(key);
    if (!have) {
      const prevKrw = Math.round(Number(s.prevMonthKrw ?? 0));
      const card = await renderCard({ month, amountKrw, deltaKrw: prevKrw > 0 ? amountKrw - prevKrw : 0, handles, channels });
      await r2Put(key, card.bytes, card.contentType);
      // 🔴 감사는 await(`void writeAudit` 금지 · 계약 §0). 무엇을 **노출했는지**가 남아야 한다(핸들 공개는 되돌릴 수 없다).
      await writeAudit({ tenantId: tid, action: "share_card_render", actorType: "user", actorId: auth.user.uid, detail: { month, amountKrw, handles: wantHandles, channels: wantChannels, bytes: card.bytes.length } });
    }
    const imageUrl = await r2PresignGet(key, CARD_URL_TTL_SEC);
    return json({ ok: true, imageUrl, expiresAt: new Date(Date.now() + CARD_URL_TTL_SEC * 1000).toISOString(), month, amountKrw,
      shows: { handles: wantHandles, channels: wantChannels } });
  } catch (err) {
    return jsonError("share_card", err);
  }
};
