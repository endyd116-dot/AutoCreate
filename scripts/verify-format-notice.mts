/**
 * scripts/verify-format-notice.mts — 🔴 **«깎였다»가 사람이 안 보는 경로에서도 닿나**(R9-11 · CLAUDE §9-②).
 *   npx --yes tsx scripts/verify-format-notice.mts
 *
 * ══ 왜 이 파일이 따로 있나 ══
 *   R9-11 의 값은 **«닿는다»**이지 «기록이 있다»가 아니다.
 *   · 닿는 길 ① **검수 화면 칩** — 🔴 **사람이 그 글을 열어 봐야** 보인다.
 *   · 닿는 길 ② **알림** — 자동 승인이면 아무도 글을 안 연다. **이 길이 없으면 아무에게도 안 닿는다.**
 *   §9 는 «막지 않는다»의 대가로 «**사람이 안 보는 경로(자동 승인)에서도 닿게 한다**»를 못 박았다.
 *   ⇒ **화면 하나로는 §9 를 못 지킨다.** 그래서 이 파일은 «알림이 실제로 나오나»를 **돌려서** 잰다.
 *
 * ══ 왜 `.mts` 인가 ══
 *   문구 정본이 `lib/format-marks.ts`(TS)이고, 🔴 `node` 는 확장자 없는 TS import 를 못 푼다 —
 *   `npx --yes tsx` 로 돌려야 한다(트리거가 경고한 그 자리). 사슬 검사(`verify-block-demote.mjs`)는 `node` 로 싸게 돌고,
 *   **행동 검사는 여기서 진짜로** 돈다(AC-87: 싸고 넓게 / 좁고 진짜로 — 둘 다 둔다).
 */
import { formatDemotionNotice } from "../lib/format-marks";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, x?: unknown) => {
  if (c) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (x !== undefined ? " — " + String(x).slice(0, 220) : "")); }
};

const demoted = (...kinds: string[]) => ({ demoted: kinds.map((kind) => ({ kind, why: "no_editor_op" })) });

console.log("\n[① 깎인 글 — 알림이 나오나]");
{
  const say = formatDemotionNotice(demoted("quote", "divider"), "전기요금 줄이는 법");
  ok(!!say, "N-01 🔴 깎인 글에는 **알림 문구가 나온다**(자동 승인이면 이게 유일하게 닿는 길이다)", JSON.stringify(say));
  ok(!!say && /인용/.test(say.body) && /구분선/.test(say.body),
    "N-02 무엇이 깎였는지 **사람말 이름**으로 말한다(내부어가 아니라 · AC-91)", say?.body);
  ok(!!say && say.body.includes("전기요금 줄이는 법"),
    "N-03 **어느 글인지** 말한다(글이 여러 편이면 제목이 없으면 못 찾는다)");
  ok(!!say && say.title.length > 0 && say.title.length <= 40, "N-04 제목이 알림 한 줄에 들어간다", say?.title);
}

console.log("\n[② 🔴 겁주지 않는다(§3) · 되돌릴 길(§9-3)]");
{
  const say = formatDemotionNotice(demoted("quote"), "제목");
  const body = String(say?.body ?? "");
  ok(!/정지|불이익|책임은|알려만|위반|주의하세요|될 수 있습니다\.?$/.test(body),
    "N-05 🔴 위협·책임 전가·겁주는 조건절 **0**(§3 — «주요 안내는 사전에 알려드려요» 쪽)", body);
  ok(/그대로 실렸|글자는/.test(body),
    "N-06 🔴 **사실 한 줄이 먼저다** — «글자는 그대로 실렸다»(무엇이 그런가 · §3 ①)", body);
  ok(/바꾸실 수 있어요|다시 올릴 수 있어요|고쳐서/.test(body),
    "N-07 🔴 **되돌릴 길을 함께 준다**(§9-3) — 말해 주기는 되돌릴 길이 있어야 정직하다", body);
}

console.log("\n[③ 🔴 대조군 짝 — 안 깎였으면 **안 간다**]");
{
  /* 🔴 안 깎였는데 «깎였어요»가 가면 **더 나쁜 거짓말**이다 — 고객은 멀쩡한 글을 의심하게 된다(AC-68·AC-92). */
  ok(formatDemotionNotice({ demoted: [] }, "제목") === null,
    "N-08 🔴 깎인 게 **없으면 알림이 안 간다**(안 깎였는데 «깎였어요»는 더 나쁜 거짓말이다)");
  ok(formatDemotionNotice(null, "제목") === null && formatDemotionNotice(undefined, "제목") === null,
    "N-09 잴 것이 아예 없으면 **안 간다**(«못 쟀다»를 «깎였다»로 바꾸지 않는다 · AC-92)");
  ok(formatDemotionNotice({}, "제목") === null, "N-10 빈 기록도 «깎였다»가 아니다");
}

console.log("\n[④ 여러 개일 때 — 읽을 수 있게]");
{
  const many = formatDemotionNotice(demoted("quote", "divider", "list", "checklist", "faq", "h2"), "제목");
  ok(!!many && many.body.length < 300, "N-11 많이 깎여도 알림 한 줄이 **안 길어진다**(앞 몇 개 + «외 n가지»)", String(many?.body.length));
  ok(!!many && /외 \d+가지/.test(many.body), "N-12 나머지는 **수로** 말한다(다 나열하면 아무도 안 읽는다)", many?.body);
}

console.log(`\nverify-format-notice: ${pass}/${fail} (통과/실패)`);
process.exit(fail ? 1 : 0);
