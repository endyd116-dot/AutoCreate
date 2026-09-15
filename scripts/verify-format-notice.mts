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
  const say = formatDemotionNotice(demoted("quote"), "제목", "tistory");
  const body = String(say?.body ?? "");
  ok(!/정지|불이익|책임은|알려만|위반|주의하세요|될 수 있습니다\.?$/.test(body),
    "N-05 🔴 위협·책임 전가·겁주는 조건절 **0**(§3 — «주요 안내는 사전에 알려드려요» 쪽)", body);
  ok(/그대로 실렸|글자는/.test(body),
    "N-06 🔴 **사실 한 줄이 먼저다** — «글자는 그대로 실렸다»(무엇이 그런가 · §3 ①)", body);
  ok(/바꾸실 수 있어요|다시 올릴 수 있어요|고쳐서/.test(body),
    "N-07 🔴 **되돌릴 길을 함께 준다**(§9-3) — 말해 주기는 되돌릴 길이 있어야 정직하다", body);
}

/* ═══ 🔴 ②b 되돌릴 길은 **채널마다 다르다**(§5E) — 세 갈래를 다 잰다 ═══
 *   §9-3 의 조건은 «**우리가 실제로 해 줄 수 있는 길**»이다. 못 내리는 채널에 «내려 드릴게요»라고 하면
 *   그건 **없는 길을 약속하는 것**이고, §9-4(«대신 해 줄 수 있는 것은 대신 해 준다»)의 반대다.
 *   ⚠️ 이 셋을 다 안 재면 «한 갈래만 맞는 문장»이 세 갈래에 다 나가도 초록이다. */
console.log("\n[②b 🔴 되돌릴 길 — 채널 세 갈래]");
{
  const say = (ch?: string) => String(formatDemotionNotice(demoted("quote"), "제목", ch)?.body ?? "");
  const canRetract = say("tistory");
  ok(/내렸다가|다시 올릴 수 있어요/.test(canRetract),
    "N-13 🔴 **내릴 수 있는 채널**(티스토리·네이버 = 러너가 내려 준다)에는 «내렸다가 고쳐서 다시 올릴 수 있어요»", canRetract);
  ok(/내렸다가|다시 올릴 수 있어요/.test(say("naver_blog")), "N-13b 네이버도 같다");

  const cannot = say("instagram");
  ok(/채널에서 직접/.test(cannot) && !/내렸다가|다시 올릴 수 있어요/.test(cannot),
    "N-14 🔴 **못 내리는 채널**(인스타 = 삭제 API 가 없다)에는 «내려 드릴게요»라고 **안 한다** — 없는 길을 약속하지 않는다", cannot);
  ok(/채널에서 직접/.test(say("threads")), "N-14b 쓰레드도 같다(삭제 엔드포인트를 확인 못 했다)");

  /* 🔴 **채널을 모를 때** — 되돌릴 길 문장을 **아예 안 낸다**. «모른다»를 «이 길이 있다»로 바꾸지 않는다(AC-92). */
  const unknown = say(undefined);
  ok(!/바꾸실 수 있어요|다시 올릴 수 있어요|내렸다가/.test(unknown),
    "N-15 🔴 **채널을 모르면 되돌릴 길을 지어내지 않는다**(«모른다»를 «이 길이 있다»로 바꾸지 않는다 · AC-92)", unknown);
  ok(unknown.length > 0 && /그대로 실렸|글자는/.test(unknown),
    "N-15b 그래도 **무엇이 깎였는지는 말한다**(모르는 한 칸 때문에 아는 것까지 입을 닫지 않는다)", unknown);
  ok(say("") === unknown, "N-15c 빈 채널도 «모름»과 같게 다룬다");
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
