/**
 * 수익 매체 신청 조건 API(계약 P1R3 §1.4·§1.4b · DESIGN §9.0):
 *   GET  /api/ad-eligibility → { ok, accounts:[{ accountId, handle, channel, adpost:{state,posts,visitors,ready}, ypp?:{...}, clip?:{open,deadline?} }], thresholds, links }
 *   POST /api/ad-eligibility { action:"applied"|"approved", source:"adpost"|"ypp", accountId } → { ok:true, accounts:[...] }  // 갱신 목록을 그대로 돌려준다(화면 재조회 0)
 *   POST /api/ad-eligibility { action:"connect_ads"|"disconnect_ads", accountId } → { ok, connect:{ way, state, detail } , accounts:[...] }
 *   🔴 thresholds·links 는 `lib/ad-eligibility.ts` 상수 그대로 — 화면은 분모·주소를 갖지 않는다(§1.4b(1)(2)).
 *
 *   ══ 🔴 `connect_ads` 를 왜 여기 붙였나 (R8 §3.2 · 2026-09-15 B2) ══
 *     «광고를 실제로 붙이는 길»이 **통째로 문이 없었다.** 부품은 다 있었는데 아무도 시작할 수 없었다:
 *       · `lib/publish/ads.ts`(WP 사이드바 위젯 삽입·되돌리기 · 128줄) — `index.ts` 에서 **export 만 되고 호출 0건**
 *       · `ads.setup_tistory` · `ads.setup_blogger` · `ads.revert_blogger` · `ads.status_blogger`
 *         — 잡 종류·우선순위·**보고 처리**·러너 채널 4개가 전부 있는데 **적재하는 코드 0건**
 *       · 화면(`ad-media.html`)에는 «신청까지 했어요 / 이미 승인됐어요» **자기신고 단추만** 있고 연결 단추가 없다
 *     즉 `verify.post_alive` 와 **똑같은 모양**이다(R7 에서 잡은 그것) — 만들어는 뒀는데 부르는 사람이 없다.
 *     새 엔드포인트를 만들지 않고 **화면이 이미 부르는 이 문**에 얹는다(표면을 덜 늘린다 · A 는 단추만 붙이면 된다).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { judgeAccounts, claimMediaState, THRESHOLDS, LINKS } from "../../lib/ad-eligibility";
import { connectAds, type AdsConnectResult } from "../../lib/ads-connect";

export const config = { path: "/api/ad-eligibility" };
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    if (req.method === "GET") return json({ ok: true, accounts: await judgeAccounts(tid), thresholds: THRESHOLDS, links: LINKS });
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<{ action?: string; source?: string; accountId?: number }>(req);

    /* ── 광고 실제로 붙이기·떼기(R8 §3.2) ── */
    if (b.action === "connect_ads" || b.action === "disconnect_ads") {
      const w = await requireWritable(tid); if (!w.ok) return w.res;   // 체험 끝·정지 상태에서 남의 사이트를 건드리지 않는다
      const accountId = n(b.accountId);
      if (!accountId) return badRequest("accountId 가 필요해요.");
      const r: AdsConnectResult = await connectAds(tid, accountId, b.action === "connect_ads" ? "connect" : "disconnect");
      /* 🔴 실패해도 갱신된 목록을 같이 돌려준다 — 화면이 «무엇이 달라졌나»를 다시 물으러 가지 않게(§1.4b 관례).
         그리고 실패를 200 으로 숨기지 않는다: `ok:false` + 사람말 사유. */
      return json({ ...r, connect: r, accounts: await judgeAccounts(tid), thresholds: THRESHOLDS, links: LINKS }, r.ok ? 200 : 409);
    }

    const action = b.action === "applied" || b.action === "approved" ? b.action : null;
    const source = (["adpost", "ypp", "adsense", "clip"] as const).find((x) => x === b.source) ?? null;
    const accountId = n(b.accountId);
    if (!action || !source || !accountId) return badRequest("action(applied|approved)·source(adpost|ypp|adsense|clip)·accountId 가 필요해요.");
    const ok = await claimMediaState(tid, auth.user.uid, source, accountId, action);
    if (!ok) return json({ ok: false, step: "not_found", error: "계정을 찾을 수 없어요." }, 404);
    return json({ ok: true, accounts: await judgeAccounts(tid), thresholds: THRESHOLDS, links: LINKS });
  } catch (err) { return jsonError("ad_eligibility", err); }
};
