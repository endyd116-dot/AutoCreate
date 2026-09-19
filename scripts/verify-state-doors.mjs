/**
 * scripts/verify-state-doors.mjs — 🔴 **같은 상태인데 문이 한쪽에만 있나** (B · 2026-09-20)
 *
 *   ══ 왜 ══
 *   2026-09-20 하루에 **세 번** 같은 모양이 났다(메인이 셋을 나란히 놓아 줬다):
 *     ① 발행엔 «그래도 올릴래요» 문이 있는데 **글쓰기엔 없다**(B2)
 *     ② 워밍업이 쓰기/발행에서 갈렸다
 *     ③ 🔴 같은 `awaiting_manual` 인데 **내보내기는 열렸고 버리기·수정·다시 만들기는 없었다**
 *   ③ 의 아픔이 컸다: «확인 필요» 글이 **못 나가고 못 버려져 편성표 자리를 영원히 먹었다.**
 *   하루 한도가 있는 손님에게는 그게 곧 «오늘 못 올린다»다(하루 몫은 `rejected` 를 안 세니 버리면 풀린다).
 *
 *   🔴 **뿌리는 «손으로 적은 허용 목록»이다.** 문마다 목록을 따로 적으니 한 상태가 어떤 문엔 있고 어떤 문엔 없다.
 *      실제로 세 목록이 다 `draft` 를 허용했는데 **라이브 0건 · 쓰는 코드 0곳**이었다 —
 *      **없는 상태는 허용하고 있는 상태는 빠뜨렸다.**
 *   ⇒ 고친 모양: 문은 **«되돌릴 수 없나»** 로만 막는다(§9 — 우리 판단으로 길을 막지 않는다).
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 글 상태 문(버리기·수정·다시 만들기)이 **손으로 적은 허용 목록**으로 돌아가지 않았나.
 *     ② 🔴 **막는 상태가 셋뿐인가** — `published`·`publishing`·`generating`(되돌릴 수 없는 순간).
 *     ③ 🔴 막을 때 **다음 수**를 말하나(§3 — 사실만 있고 다음 수가 없으면 반쪽).
 *     ④ 🔴 **발행이 받는 상태를 문들도 받나** — 발행이 `awaiting_manual` 을 받는데 버리기가 안 받으면 그게 ③의 모양이다.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · 글 상태 문만 본다. 발행·글쓰기의 «그래도 할래요» 문(B2 축)은 **안 본다** — 겹치면 한쪽으로 모은다.
 *     · 화면에 그 단추가 **보이나**는 안 본다(서버가 여나까지).
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const PIECES = "netlify/functions/pieces.ts";
const PUB = "lib/publish/index.ts";
const src = codeOnly(read(PIECES));

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

/** 되돌릴 수 없는 순간 — 여기만 막는다. */
const BUSY = ["published", "publishing", "generating"];
const DOORS = ["버리기", "수정", "다시 만들기"];

console.log(`\n«같은 상태인데 문이 한쪽에만 있나» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 글 상태 문 ${DOORS.length}개(${DOORS.join(" · ")}) · 막아야 할 상태 ${BUSY.length}개(${BUSY.join(" · ")})`);
console.log("─".repeat(120));

/* ① 손으로 적은 허용 목록으로 돌아가지 않았나 */
{
  /* 옛 모양: `if (!["in_review", "edited", …].includes(st)) return … step:"state"` */
  const handLists = [...src.matchAll(/!\[[^\]]*"(?:in_review|edited|draft|approved|scheduled)"[^\]]*\]\.includes\(st\)/g)];
  rec("① 🔴 글 상태 문이 **손으로 적은 허용 목록**으로 돌아가지 않았다", handLists.length === 0,
    handLists.length ? `🔴 손 목록 ${handLists.length}곳이 되살아났다 — 그러면 한 상태가 어떤 문엔 있고 어떤 문엔 없게 된다`
      : `문 ${DOORS.length}개가 «되돌릴 수 없나» 한 규칙(\`busyReason\`)을 같이 쓴다`);
}

/* ② 막는 상태가 셋뿐인가 — 더 막으면 «우리 판단으로 길을 막는 것»이다(§9) */
{
  const m = src.match(/const BUSY_SAY[\s\S]*?\n\};/);
  const body = m ? m[0] : "";
  const doors = DOORS.filter((d) => body.includes(d));
  /* 🔴 [변이 M2 가 고치게 했다] 첫 판은 «셋이 다 있나»만 셌다 — 그래서 **넷째를 더해도 안 울었다**
     (`awaiting_manual` 을 막는 줄을 끼워 넣었는데 통과했다). «모자란 것»과 «넘치는 것»을 **둘 다** 센다. */
  const perDoor = DOORS.map((d) => {
    /* 🔴 키에 **따옴표가 붙을 수 있다**(`"다시 만들기": {` — 공백이 든 이름이라 TS 가 그렇게 쓴다).
       첫 판은 `다시 만들기: {` 만 찾아 그 문을 «0개»로 읽고 **거짓 빨강**을 냈다. 따옴표를 받아 준다. */
    const at = body.indexOf(`"${d}": {`) >= 0 ? body.indexOf(`"${d}": {`) + `"${d}": {`.length : body.indexOf(`${d}: {`) + `${d}: {`.length;
    const seg = (at > 0 ? body.slice(at) : "").split("},")[0];
    const keys = [...seg.matchAll(/(\w+):\s*"/g)].map((x) => x[1]);
    return { have: BUSY.filter((b) => keys.includes(b)).length, extra: keys.filter((k) => !BUSY.includes(k)) };
  });
  const extras = perDoor.flatMap((x) => x.extra);
  const ok = !!body && doors.length === DOORS.length && perDoor.every((x) => x.have === BUSY.length) && extras.length === 0;
  rec("② 🔴 막는 상태가 **되돌릴 수 없는 셋**뿐이다", ok,
    !body ? "🔴 `BUSY_SAY` 표를 못 찾았다 — 이 자를 고쳐라(조용히 통과시키지 않는다)"
      : ok ? `문 ${doors.length}개가 각각 ${BUSY.length}개 상태만 막는다(넘치는 것 0)`
        : extras.length ? `🔴 되돌릴 수 있는 상태까지 막는다: ${[...new Set(extras)].join(", ")} — 우리 판단으로 길을 막는 것이다(§9)`
          : `🔴 문마다 막는 상태가 다르다 — ${DOORS.map((d, i) => `${d}:${perDoor[i].have}`).join(" · ")}`);
}

/* ③ 막을 때 «다음 수»를 말하나 */
{
  const m = src.match(/const BUSY_SAY[\s\S]*?\n\};/);
  const says = m ? [...m[0].matchAll(/:\s*"([^"]+)"/g)].map((x) => x[1]) : [];
  /* «— » 뒤에 할 일이 오거나, «~하면 돼요/~할 수 있어요/기다려» 로 끝난다. 사실만 있고 끝나면 반쪽이다(§3). */
  /* 🔴 [변이 M3 가 고치게 했다] 첫 판은 «버릴 수» 를 «다음 수»로 셌다 — 그런데 **«버릴 수 없어요»** 도 거기 걸린다.
     ⇒ **할 수 있다는 말**만 «다음 수»로 센다(«…없어요» 는 빼고 본다). 부분일치가 또 속인 자리다(AC-108). */
  const noNext = says.filter((t) => {
    const canDo = /(내리기|다시 만들|고칠 수 있|버릴 수 있|기다려|잠깐만요|새 자리|채널에서 직접)/.test(t);
    const onlyFact = /^지금 상태에서는/.test(t);
    return !canDo || onlyFact;
  });
  rec("③ 🔴 막는 자리가 **다음 수**를 같이 말한다(§3)", says.length > 0 && noNext.length === 0,
    !says.length ? "🔴 막는 문구를 못 찾았다"
      : noNext.length ? `🔴 사실만 있고 다음 수가 없는 문구 ${noNext.length}개: ${noNext.join(" / ")}`
        : `문구 ${says.length}개가 전부 «그럼 어떻게 하는지»로 끝난다`);
}

/* ④ 🔴 발행이 받는 상태를 문들도 받나 — 이번 고장의 바로 그 모양 */
{
  const pm = codeOnly(read(PUB)).match(/PUBLISHABLE[^=]*=\s*new Set\(\[([^\]]*)\]/);
  const publishable = pm ? [...pm[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
  /* 발행이 받는데 문이 막는 상태 = 한쪽에만 있는 문 */
  const blockedByDoor = publishable.filter((st) => BUSY.includes(st) && st !== "publishing");
  const ok = publishable.length > 0 && blockedByDoor.length === 0;
  rec("④ 🔴 **발행이 받는 상태를 문들도 받는다**(한쪽에만 열려 있지 않다)", ok,
    !publishable.length ? "🔴 `PUBLISHABLE` 을 못 읽었다"
      : ok ? `발행이 받는 ${publishable.length}개(${publishable.join(", ")}) 중 문이 막는 것은 «지금 나가는 중»뿐이다`
        : `🔴 발행은 받는데 문이 막는 상태: ${blockedByDoor.join(", ")} — «나갈 수는 있는데 그만둘 수는 없다»가 된다`);
}

/* 대조군 — 정말 막아야 하는 것은 막고 있나(이 자가 «다 열어라»가 아니다) */
{
  const m = src.match(/const BUSY_SAY[\s\S]*?\n\};/);
  const guards = m ? m[0] : "";
  /* 🔴 [변이 M4 가 고치게 했다] 첫 판은 **호출**(`busyReason(`)만 봤다 — 선언 이름을 `busyReasonX` 로 바꿔도
     호출 글자는 남아 있어 통과했다(컴파일은 깨지는데 자는 조용했다). **선언과 호출을 둘 다** 본다. */
  const declared = /const busyReason\s*=/.test(src);
  const called = /\bbusyReason\(/.test(src);
  const ok = guards.includes("published:") && declared && called;
  rec("대조군 — **이 자는 «다 열어라»가 아니다**(이미 나간 글은 막는다)", ok,
    ok ? "`published` 는 세 문에서 다 막히고 «내리기»로 안내한다 — 되돌릴 수 없는 것은 그대로 막는다"
      : "🔴 이미 나간 글도 열려 있다 — 그건 고친 게 아니라 부순 것이다");
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 **글 상태 문**만 본다 — 발행·글쓰기의 «그래도 할래요» 문은 B2 의 축이다(두 벌 금지).");
process.exit(bad ? 1 : 0);
