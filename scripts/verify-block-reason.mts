/**
 * scripts/verify-block-reason.mts — 🔴 «막힌 까닭»을 바르게 가르나(AC-203 · B2 · 2026-09-23).
 *   사용: `npx --yes tsx scripts/verify-block-reason.mts` · 네트워크 0 · 브라우저 0 · DB 0
 *
 *   ══ 왜 이 자가 필요한가 ══
 *     막히는 것은 어쩔 수 없다. 🔴 **틀린 까닭을 적는 것**이 문제다 —
 *     다음 사람이 엉뚱한 데를 파고, 손님은 «IP 문제예요»를 듣고 **프록시를 사러 간다.**
 *
 *   ══ 재는 것 ══
 *     ① 신호표 — 계약 7종 어휘만 쓰나 · 좁은 것이 먼저인가
 *     ② 판정 — 판정표 그대로
 *     ③ 🔴 **«모름»을 지어내지 않나** — 아무 신호도 못 보면 까닭을 고르지 않고 본 것만 적나
 *     ④ 🔴 **죽은 가지가 되살아나지 않나** — `text=A, text=B` 꼴이 코드에 다시 생기면 빨강
 *     ⑤ 사람말 — 위협·책임 전가 0(CLAUDE §3) · «IP» 를 근거 없이 지목하지 않나
 *     ⑥ 🔴 변이 — 판정을 일부러 어긋낸 것들이 전부 잡히나
 *
 *   🔴 실측(2026-09-23 · 브라우저로 쟀다 · `scripts/probe-text-selector.mjs`):
 *     `locator("text=이용이 제한, text=제재")` → 「이 블로그는 이용이 제한된 상태입니다」 **0** ·
 *     「운영원칙 위반으로 제재되었습니다」 **0** · 통째로 적힌 화면에서만 1.
 *     ⇒ **제재 가지는 한 번도 안 걸렸다.**
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/block.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { judgeBlockReason, NAVER_PUBLISH_SIGNALS } = await import(
  pathToFileURL(path.join(ROOT, "runner", "lib", "block-reason.mjs")).href
) as {
  judgeBlockReason: (o: { seen?: string; url?: string }) => { kind: string; key: string; sure: boolean; message: string; matched: boolean; seenSample: string };
  NAVER_PUBLISH_SIGNALS: readonly { key: string; re: RegExp; kind: string; sure: boolean; say: string }[];
};

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };

/** 계약 7종 — `lib/account-health.ts` 가 정본. 여기서 어휘를 늘리면 B·A·DB 가 같이 흔들린다. */
const CONTRACT = ["suspended", "captcha", "login_fail", "rate_limited", "selector_changed", "network", "unknown"];

console.log("① 신호표");
{
  ok("🔴 계약 7종 어휘만 쓴다(새 어휘 0)", NAVER_PUBLISH_SIGNALS.every((s) => CONTRACT.includes(s.kind)),
    NAVER_PUBLISH_SIGNALS.map((s) => s.kind).filter((k) => !CONTRACT.includes(k)).join(","));
  ok("신호가 비지 않았다", NAVER_PUBLISH_SIGNALS.length >= 5, String(NAVER_PUBLISH_SIGNALS.length));
  /* 🔴 좁은 것이 먼저 — 「제재」가 「오류 화면」보다 앞이어야 한다(뒤면 제재를 오류로 뭉갠다). */
  const iSus = NAVER_PUBLISH_SIGNALS.findIndex((s) => s.key === "suspended");
  const iErr = NAVER_PUBLISH_SIGNALS.findIndex((s) => s.key === "error_page");
  ok("🔴 좁은 신호(제재)가 넓은 신호(오류 화면)보다 앞이다", iSus >= 0 && iErr >= 0 && iSus < iErr, `sus=${iSus} err=${iErr}`);
  ok("🔴 «오류 화면»만 `sure:false` 다(까닭을 못 짚는 유일한 신호)",
    NAVER_PUBLISH_SIGNALS.filter((s) => !s.sure).map((s) => s.key).join(",") === "error_page",
    NAVER_PUBLISH_SIGNALS.filter((s) => !s.sure).map((s) => s.key).join(","));
}

/* ═══ ② 판정표 — 돌리기 전에 먼저 적었다 ═══ */
interface C { name: string; seen: string; url?: string; kind: string; key: string; sure: boolean }
const TABLE: C[] = [
  { name: "🔴 제재 — 실제 문구(종전엔 이 가지가 죽어 있었다)", seen: "이 블로그는 이용이 제한된 상태입니다", kind: "suspended", key: "suspended", sure: true },
  { name: "🔴 제재 — «운영원칙 위반으로 제재»(종전 셀렉터로는 0이었다)", seen: "운영원칙 위반으로 제재되었습니다", kind: "suspended", key: "suspended", sure: true },
  { name: "로그인이 풀렸다(글자)", seen: "로그인이 필요합니다", kind: "login_fail", key: "relogin", sure: true },
  { name: "🔴 로그인이 풀렸다(주소) — 글자보다 주소가 세다", seen: "아무 글자", url: "https://nid.naver.com/nidlogin.login?mode=form", kind: "login_fail", key: "relogin", sure: true },
  { name: "자동입력 방지", seen: "자동입력 방지 문자를 입력해 주세요", kind: "captcha", key: "captcha", sure: true },
  { name: "너무 잦다", seen: "글을 너무 많이 등록하셨습니다. 잠시 후 이용해 주세요", kind: "rate_limited", key: "too_often", sure: true },
  { name: "그 블로그가 없다", seen: "해당 블로그가 없습니다", kind: "login_fail", key: "no_blog", sure: true },
  { name: "🔴 오류 화면 — 까닭을 **못 짚는다**(종전엔 «해외 IP 차단»으로 단정했다)", seen: "페이지를 찾을 수 없습니다", kind: "network", key: "error_page", sure: false },
  { name: "🔴 아무 신호도 없다 → 까닭을 **고르지 않는다**", seen: "글을 등록하는 중입니다", kind: "unknown", key: "unmeasured", sure: false },
  { name: "🔴 화면을 아예 못 읽었다 → 그것도 «못 쟀음»", seen: "", kind: "unknown", key: "unmeasured", sure: false },
];

console.log("\n② judgeBlockReason — 판정표 10줄");
for (const c of TABLE) {
  const r = judgeBlockReason({ seen: c.seen, ...(c.url ? { url: c.url } : {}) });
  ok(c.name, r.kind === c.kind && r.key === c.key && r.sure === c.sure, `kind=${r.kind} key=${r.key} sure=${r.sure}`);
}

console.log("\n③ 🔴 «모름»을 지어내지 않는다");
{
  const r = judgeBlockReason({ seen: "글을 등록하는 중입니다" });
  ok("못 가르면 `matched:false`", r.matched === false);
  ok("🔴 못 가르면 사람말이 «못 쟀어요»라고 말한다", r.message.includes("못 쟀"), r.message);
  ok("🔴 못 가르면 **본 것을 적는다**(다음 사람이 되짚을 재료)", r.message.includes("글을 등록하는 중") || r.seenSample.includes("글을 등록하는 중"), r.message);
  ok("🔴 못 가르면 까닭을 **하나도 고르지 않는다**(IP·세션 같은 말이 없다)",
    !/IP|세션|차단|제재|비밀번호/.test(r.message), r.message);
  const empty = judgeBlockReason({ seen: "" });
  ok("화면을 못 읽어도 «못 쟀어요»(빈 문자열을 «깨끗»으로 읽지 않는다)", empty.matched === false && empty.message.includes("못 쟀"));
}

console.log("\n④ 🔴 죽은 가지가 되살아나지 않나(소스에 못 박는다)");
{
  const rv = stripComments(readFileSync(path.join(ROOT, "runner", "channels", "naver-blog.mjs"), "utf8"));
  /* 🔴 `text=A, text=B` 는 **한 문자열로 읽힌다** — 브라우저로 쟀다(0/0). 다시 생기면 빨강. */
  ok("🔴 `text=…, text=…` 꼴이 없다(콤마는 CSS 목록 문법이라 한 문자열이 된다)",
    !/text=[^"']*,\s*text=/.test(rv), "🔴 죽은 가지가 되살아났다 — 브라우저로 재 보면 0 이다");
  ok("🔴 «해외 IP 차단» 을 근거 없이 지목하지 않는다", !/해외\s*IP|IP\s*차단/.test(rv),
    "🔴 그 문자열은 우리 코드 다른 세 곳에서 «그 글이 없다»로 읽힌다 — IP 를 지목할 근거가 아니다");
  ok("판정기를 실제로 부른다", rv.includes("judgeBlockReason"));
  ok("🔴 **주소를 못 얻었을 때도** 까닭을 본다(종전엔 곧바로 unknown 이었다)",
    /if \(!found\) \{[\s\S]{0,400}judgeBlockReason/.test(rv));
}

console.log("\n⑤ 사람말 — CLAUDE §3(겁주지 않는다 · 책임 전가 0)");
{
  const all = NAVER_PUBLISH_SIGNALS.map((s) => s.say).join(" ") + " " + judgeBlockReason({ seen: "x" }).message;
  const BAD = ["정지됩니다", "불이익", "고객님 책임", "알려만", "경고", "위반하셨", "삭제됩니다"];
  ok("겁주는 말 0", BAD.every((b) => !all.includes(b)), BAD.filter((b) => all.includes(b)).join(","));
  ok("시스템 용어 0(테넌트·piece·러너 잡·selector)", !/테넌트|piece|러너 잡|selector|errorKind/i.test(all), all.slice(0, 100));
  /* 🔴 §3 — ②어떻게 하면 되는지가 있어야 한다. 「막혔다」만 말하면 손님은 할 게 없다.
     ⚠️ **처음에 이 줄이 거짓 빨강을 냈다**(2026-09-23): 과녁을 `해 주세요|눌러 주|확인해 주|드릴게요|줄이고`
        라는 **내가 떠올린 어구 목록**으로 잡아서, 멀쩡한 「한 번만 직접 **풀어 주세요**」를 낙제시켰다.
        🔴 **좁은 과녁이 멀쩡한 제품을 빨갛게 만든 것**이고, 그게 오늘 B 가 가르쳐 준 「거짓 빨강은 조용한 초록만큼
        나쁘다」의 내 판이다. ⇒ 어구 목록이 아니라 **성질**로 잰다: 손님에게 청하는 말(`주세요`·`주시면`)이나
        우리가 해 주는 말(`드릴`)이 있나. 어구를 늘리는 게 아니라 **과녁을 성질로 바꾼** 것이다. */
  /* 🔴 **그리고 두 번째로 또 좁았다**(같은 실행에서 연달아): 이번엔 「너무 잦다」가 걸렸다 —
     「하루 올리는 수를 한 건 줄이고 잠시 쉬었다가 이어서 올릴게요」. 🔴 **그 경우엔 손님이 할 일이 없다.**
     §3 은 ②어떻게 하면 되는지 **와** ③우리가 대신 해 주는 것을 나란히 두는데, 잦은 발행은 **③이 답**이다.
     ⇒ 재야 할 성질은 「손님에게 시킬 말이 있나」가 아니라 **「다음 걸음이 있나」**다.
     두 번 다 같은 실수였다 — **내가 떠올린 답만 정답으로 두면 멀쩡한 답이 낙제한다.** */
  const NEXT_STEP = /주세요|주시면|드릴|올릴게요|할게요|옮겨/;
  ok("🔴 `sure` 인 신호는 **다음 걸음**을 같이 말한다(손님이 할 일이거나 **우리가 할 일**이거나)",
    NAVER_PUBLISH_SIGNALS.filter((s) => s.sure).every((s) => NEXT_STEP.test(s.say)),
    NAVER_PUBLISH_SIGNALS.filter((s) => s.sure && !NEXT_STEP.test(s.say)).map((s) => s.key).join(","));
  /* 🔴 대조군 — 과녁이 **아무 문장이나 통과시키는 것은 아닌지**(안 그러면 이 검사도 있으나 마나다). */
  ok("🔴 그 과녁이 «막혔어요»만 있는 문장은 떨어뜨린다(대조군)", !NEXT_STEP.test("네이버가 막았어요."));
  ok("🔴 우리가 대신 해 주는 것을 말한다(승계·재시도 같은 것)",
    NAVER_PUBLISH_SIGNALS.some((s) => /옮겨 드릴게요|저희가 확인할게요|줄이고/.test(s.say)));
}

console.log("\n⑥ 🔴 변이 — 판정을 어긋내면 잡히나");
{
  type J = (c: C) => string;
  const real: J = (c) => judgeBlockReason({ seen: c.seen, ...(c.url ? { url: c.url } : {}) }).key;
  const MUT: { name: string; f: J }[] = [
    { name: "🔴 V1 못 가른 것을 «오류 화면»으로 뭉갠다(종전 병 그대로)", f: (c) => (real(c) === "unmeasured" ? "error_page" : real(c)) },
    { name: "🔴 V2 오류 화면을 «IP 차단»이라 단정한다(sure 를 켠다)",
      f: (c) => real(c) },   // key 는 같고 sure 만 다르다 — 아래에서 따로 본다
    { name: "V3 제재를 오류 화면 뒤로 민다(넓은 것이 먼저)",
      f: (c) => (c.key === "suspended" ? "error_page" : real(c)) },
    { name: "V4 주소(nidlogin)를 안 본다", f: (c) => (c.url ? "unmeasured" : real(c)) },
    { name: "🔴 V5 아예 안 가른다(늘 unknown)", f: () => "unmeasured" },
  ];
  for (const m of MUT) {
    if (m.name.includes("V2")) continue;   // 아래에서 sure 로 잰다
    const caught = TABLE.filter((c) => m.f(c) !== c.key);
    ok(`${m.name} — 잡힘(${caught.length}줄)`, caught.length > 0, "🔴 아무 줄도 못 잡는다 = 그 규칙은 아무도 안 지킨다");
  }
  /* 🔴 V2 는 `key` 가 같고 `sure` 만 다르다 — **판정표가 `sure` 를 못 박고 있나**를 따로 본다. */
  const errRow = TABLE.find((c) => c.key === "error_page")!;
  ok("🔴 V2 오류 화면에 `sure` 를 켜면 잡힌다(표가 sure 를 못 박고 있다)", errRow.sure === false);
}

/* ═══ ⑦ [AC-204] 🔴 **쉬는 틈이 정말 흔들리나** — 「넣었다」를 말이 아니라 셈으로 ═══
 *   실측(2026-09-23 · `scripts/probe-human-rhythm.mjs` · 러너 전수): `settle(page, min)` **고정 90곳** · 흔들림 12곳.
 *   도우미 주석은 「기계적 등간격 클릭을 피한다」인데 **88%가 등간격이었다** — 주석과 코드가 갈라져 있었다.
 *   ⇒ `settle` 기본을 흔들리게 고쳤다. 여기서 **정말 흔들리는지**·**절대 짧아지지 않는지**를 못 박는다.
 */
console.log("\n⑦ 🔴 쉬는 틈(settle) — 정말 흔들리나 · 짧아지지는 않나");
{
  const bro = await import(pathToFileURL(path.join(ROOT, "runner", "lib", "browser.mjs")).href) as {
    settle: (page: unknown, min?: number, max?: number) => Promise<void>;
  };
  /* 브라우저 없이 잰다 — `waitForTimeout` 에 온 숫자를 그대로 받아 적는 가짜 page. */
  const seen: number[] = [];
  const fake = { waitForTimeout: (ms: number) => { seen.push(ms); return Promise.resolve(); } };
  for (let i = 0; i < 400; i++) await bro.settle(fake, 600);
  const uniq = new Set(seen).size;
  ok("🔴 인자 하나로 불러도 **흔들린다**(종전엔 90곳이 전부 같은 값이었다)", uniq > 20, `서로 다른 값 ${uniq}가지`);
  ok("🔴 **절대 짧아지지 않는다**(min 이 바닥 · 짧아지면 안 그려진 화면을 잰다)", Math.min(...seen) >= 600, `가장 짧은 값 ${Math.min(...seen)}`);
  ok("🔴 흔들림이 묶여 있다(잡마다 몇 초씩 더 먹지 않게)", Math.max(...seen) <= 1000, `가장 긴 값 ${Math.max(...seen)}`);
  /* 🔴 대조군 — **이 검사가 아무것이나 통과시키는 것은 아닌지.** 고정으로 쉬면 떨어져야 한다. */
  const fixed = Array.from({ length: 50 }, () => 600);
  ok("🔴 (대조군) 고정으로 쉬는 것은 이 검사에 떨어진다", new Set(fixed).size === 1);
  /* 두 인자로 부르던 12곳은 **종전과 같아야** 한다(무회귀). */
  const two: number[] = [];
  const p2 = { waitForTimeout: (ms: number) => { two.push(ms); return Promise.resolve(); } };
  for (let i = 0; i < 200; i++) await bro.settle(p2, 300, 900);
  ok("두 인자(min,max)로 부르던 자리는 종전 그대로 [min,max)", Math.min(...two) >= 300 && Math.max(...two) < 900,
    `${Math.min(...two)}~${Math.max(...two)}`);
}

console.log(`\n${fail === 0 ? "🟢" : "🔴"} pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
