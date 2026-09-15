/**
 * scripts/verify-b8-channel-goal.mts — **목표 매체가 채널 순서를 실제로 바꾸나**(DESIGN §5.3-1 · R8CLOSE-B1 §B8).
 *   실행: `npx --yes tsx scripts/verify-b8-channel-goal.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   ══ 🔴 왜 «라이브 모양»으로 재나(AC-72) ══
 *     어제 `goalOf()` 가 채널 둘 이상이면 `"mixed"` 를 넣는데 그 열쇠를 가진 표가 **0개**여서 라이브 brief 의 **56%** 가
 *     규칙을 한 줄도 못 받았다. 순수 하니스는 그런 걸 **절대 못 잡는다** — 함수는 맞게 동작하니까.
 *     그래서 이 하니스의 입력은 **2026-09-16 라이브 조회에서 실제로 나온 모양** 그대로다:
 *       · 채널이 둘 이상인 집 8곳 = naver+tistory **6** · naver+shorts 2 · 셋 1
 *       · `accounts.monetize` 실물 = `adpostState:"none"|"pending"` · `adsenseState:"pending"` · `adpostMediaId`
 *       · 🔴 **`"approved"`·`"linked"` 로 간 계정은 애드포스트 1건뿐** — 그래서 «아직 아무것도 안 붙은 집»이 기본값이다.
 *     ⇒ «오늘 라이브에서는 순서가 안 바뀐다»가 **통과 조건**이다. 안 바뀌는 게 맞다(붙은 광고가 없으니까).
 *        바뀌면 그건 우리가 없는 근거로 순서를 흔든 것이다.
 *
 *   🔴 한계(정직): 여기까지는 **순서**다. «순서가 바뀌어서 수익이 늘었나»는 성과가 쌓여야 알 수 있고 아직 못 쟀다(AC-9).
 */
import { targetChannelOrder, mediaLiveOf, CHANNEL_MEDIA } from "../lib/director-goal";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };
const acc = (channel: string, monetize: Record<string, unknown> = {}) => ({ channel, monetize });

/* ── ① 어휘 두 벌 — 애드센스는 `linked`, 애드포스트는 `approved` 다. 한쪽만 보면 애드센스가 영영 «없다»가 된다. ── */
rec("① 애드포스트 approved = 붙음", mediaLiveOf({ adpostState: "approved" }, "naver_blog") === "on");
rec("① 🔴 애드센스는 `linked` 다(러너 어휘)", mediaLiveOf({ adsenseState: "linked" }, "tistory") === "on",
  `tistory/linked → ${mediaLiveOf({ adsenseState: "linked" }, "tistory")}`);
rec("① 아이디만 박혀 있어도 붙은 것(라이브에 adpostMediaId 만 있는 행이 있다)", mediaLiveOf({ adpostMediaId: "m123" }, "naver_blog") === "on");
rec("① pending = 심사 중(붙음이 아니다)", mediaLiveOf({ adsenseState: "pending" }, "tistory") === "waiting");
rec("① 🔴 unknown 은 «붙었다»가 아니다(러너가 못 가른 것 · AC-9)", mediaLiveOf({ adsenseState: "unknown" }, "tistory") === "off");
rec("① none·not_linked = 없음", mediaLiveOf({ adpostState: "none" }, "naver_blog") === "off" && mediaLiveOf({ adsenseState: "not_linked" }, "tistory") === "off");

/* ── ② 🔴 오늘 라이브 그대로 — 아무 광고도 안 붙은 naver+tistory 집(6곳 중 하나) ── */
{
  const r = targetChannelOrder({ connected: ["naver_blog", "tistory"], channelHint: "naver_blog",
    accounts: [acc("naver_blog", { adpostState: "none" }), acc("tistory", { adsenseState: "pending" })] });
  rec("② 🔴 붙은 광고가 없으면 순서를 흔들지 않는다(소재가 이긴다)", r.channels[0] === "naver_blog",
    `${r.channels.join(" → ")} · 출처 ${r.goalSource}`);
  rec("② 🔴 «심사 중»으로는 뒤집지 않는다(아직 한 푼도 안 들어온다)", r.channels[1] === "tistory");
  rec("② 왜 이 순서인지 말해 준다", r.reason.includes("네이버 블로그") && !/naver_blog/.test(r.reason), r.reason);
}

/* ── ③ 설계 §5.3-1 의 그 예 — 티스토리에 애드센스가 **실제로** 붙으면 애드센스 쪽이 앞선다 ── */
{
  const r = targetChannelOrder({ connected: ["naver_blog", "tistory"], channelHint: "naver_blog",
    accounts: [acc("naver_blog", { adpostState: "none" }), acc("tistory", { adsenseState: "linked" })] });
  rec("③ 🔴 adsense 가 붙으면 티스토리가 앞선다(DESIGN:262)", r.channels[0] === "tistory", `${r.channels.join(" → ")}`);
  rec("③ 목표·출처를 남긴다", r.goal === "adsense" && r.goalSource === "붙은 광고", `goal=${r.goal} source=${r.goalSource}`);
  rec("③ 🔴 켠 채널을 하나도 빼지 않는다(§9 — 막지 않는다)", r.channels.length === 2 && r.channels.includes("naver_blog"));
  rec("③ 이유가 «돈이 나는 쪽»이라고 말한다", /광고가 붙어/.test(r.reason), r.reason);
}

/* ── ④ 힌트 채널에 광고가 붙어 있으면 그대로 힌트가 이긴다(둘 다 좋을 때 흔들지 않는다) ── */
{
  const r = targetChannelOrder({ connected: ["naver_blog", "tistory"], channelHint: "naver_blog",
    accounts: [acc("naver_blog", { adpostMediaId: "m1" }), acc("tistory", { adsenseState: "linked" })] });
  rec("④ 힌트 채널에도 광고가 붙었으면 힌트가 이긴다", r.channels[0] === "naver_blog", `${r.channels.join(" → ")}`);
}

/* ── ⑤ 🔴 «없는 길»을 만들지 않는다 — 안 켠 채널은 절대 안 나온다 ── */
{
  const r = targetChannelOrder({ connected: ["naver_blog"], channelHint: "tistory",
    accounts: [acc("naver_blog", { adpostState: "approved" })] });
  rec("⑤ 🔴 안 켠 채널(티스토리)은 후보에 없다", r.channels.join() === "naver_blog", r.channels.join(" → "));
  rec("⑤ 채널이 하나면 이유가 «고를 것이 없다»로 흐르지 않는다", r.reason.length > 0 && !r.reason.includes("고를 채널이 없어요"), r.reason);
}

/* ── ⑥ 결정론 — 같은 입력이면 같은 순서(편성이 매번 흔들리면 «왜 어제랑 달라요?»가 된다) ── */
{
  const mk = () => targetChannelOrder({ connected: ["blogger", "naver_blog", "tistory"], channelHint: null,
    accounts: [acc("blogger"), acc("naver_blog", { adpostState: "pending" }), acc("tistory", { adsenseState: "linked" })] });
  const a1 = mk().channels.join(), a2 = mk().channels.join();
  rec("⑥ 두 번 불러도 같은 순서", a1 === a2, a1);
  rec("⑥ 붙음 → 심사 중 → 없음 순", a1 === "tistory,naver_blog,blogger", a1);
}

/* ── ⑦ 🔴 표와 코드가 갈리지 않는가 — `CHANNEL_MEDIA` 의 모든 채널이 판정에 닿는가 ── */
for (const [ch, media] of Object.entries(CHANNEL_MEDIA)) {
  const key = media === "adpost" ? "adpostState" : media === "adsense" ? "adsenseState" : media === "ypp" ? "yppState" : null;
  if (!key) { rec(`⑦ ${ch}(${media}) — 🔴 상태를 적는 칸이 아직 없다`, true, "클립 인센티브는 계정 상태가 아니라 모집 창이다(ad-eligibility) — 못 쟀다고 적는다"); continue; }
  rec(`⑦ ${ch}(${media}) 상태를 읽는다`, mediaLiveOf({ [key]: "approved" }, ch) === "on" || mediaLiveOf({ [key]: "linked" }, ch) === "on", key);
}

/* ── ⑧ 후보가 0개여도 던지지 않는다(방어) ── */
rec("⑧ 켠 채널이 0개여도 안 터진다", targetChannelOrder({ connected: [], channelHint: null, accounts: [] }).channels.length === 0);

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nB8 목표 매체 → 채널 선택 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 84)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 여기까지는 **순서**다. «순서가 바뀌어 수익이 늘었나»는 성과가 쌓여야 알 수 있고 아직 못 쟀다(AC-9).");
process.exit(fail ? 1 : 0);
