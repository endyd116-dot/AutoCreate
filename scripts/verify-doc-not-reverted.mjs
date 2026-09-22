/**
 * scripts/verify-doc-not-reverted.mjs — 🔴 **머지가 남의 수리를 조용히 되돌리지 않았나**(메인 · AC-175 · 2026-09-23).
 *
 * 왜 생겼나 — 2026-09-23, 하루에 **두 번** 났다.
 *   ① B 가 파일을 합치며 부르는 쪽 15곳을 다 고쳤는데, 내가 그 뒤에 B2 것을 머지하며
 *      부르는 쪽 셋이 더 들어와 죽어 있었다(AC-173).
 *   ② C 의 가지에 **B 의 정정이 빠진 옛 AC-173** 이 실려 있었다. 그대로 받았으면
 *      🔴 **B 의 정정이 소리 없이 사라졌을 것**이다(AC-239).
 *
 * 🔴 C 가 짚은 한 줄이 이 자의 존재 이유다 — **«문서가 되돌아가면 코드와 달리 아무 소리도 안 난다.»**
 *   그날 코드가 되돌아간 것은 **네 번 다 자가 울어서** 잡혔다. 규칙 문서는 **돌려 보는 자가 없다.**
 *   ⇒ 그래서 «충돌을 여는 그 순간»이 유일한 관문이었고, 그 관문을 **사람의 습관**에 맡기고 있었다.
 *
 * 무엇을 재나 — 규칙 문서의 **번호 붙은 항목 하나하나**를 견준다.
 *   · 옛 판에 있던 항목이 **사라졌나**
 *   · 같은 항목이 **짧아졌나**(오늘 일이 정확히 이 모양이다 — 고친 긴 판이 옛 짧은 판으로 덮일 뻔했다)
 *   · 같은 번호가 **두 번** 나오나(양쪽을 다 붙여 놓고 못 본 것)
 *
 * 견줄 상대(자동으로 고른다):
 *   · 머지 도중이면(`MERGE_HEAD` 가 있으면) **HEAD 와 들어오는 가지 전부** ⇒ 충돌을 풀고 **커밋하기 전에** 운다
 *   · 아니면 **origin/main** ⇒ 올리기 전에 운다
 *   · `REFS="a b"` 로 손수 줄 수도 있다.
 *
 * ⚠️ **짧아진 것이 늘 잘못은 아니다** — 일부러 줄인 것일 수 있다. 이 자는 **막지 않는다**(§9).
 *   사람에게 «여기를 보라»고 할 뿐이고, 일부러 줄였으면 그대로 커밋하면 된다.
 *
 * 실행: `node scripts/verify-doc-not-reverted.mjs`     (0 = 되돌아간 것 없다 · 1 = 볼 곳 있다 · 2 = 자가 못 쟀다)
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** 재는 문서와 «항목 머리»의 모양. 새 규칙 문서가 생기면 여기 한 줄 더한다. */
const DOCS = [
  { path: "docs/rules/PITFALLS.md", head: /^- \*\*(AC-[0-9]+[a-z]?)\*\*/ },
];

/** 문서 한 벌을 «번호 → 그 항목의 글»로 가른다. */
export function entriesOf(text, head) {
  const lines = text.split("\n");
  const out = new Map();
  const dup = [];
  let key = null, buf = [];
  const flush = () => {
    if (!key) return;
    // 🔴 끝의 빈 줄을 걷는다 — 안 걷으면 **파일 마지막 항목**이 뒤에 붙은 빈 줄까지 삼켜서,
    //    다음 판에 항목이 하나 더 붙는 순간 «1자 짧아졌다»는 거짓 빨강이 난다(실제로 AC-232 가 그랬다).
    if (out.has(key)) dup.push(key);
    else out.set(key, buf.join("\n").replace(/\s+$/, ""));
  };
  for (const line of lines) {
    const m = head.exec(line);
    if (m) { flush(); key = m[1]; buf = [line]; }
    else if (key) buf.push(line);
  }
  flush();
  return { entries: out, dup };
}

function atRef(ref, path) {
  try {
    return execFileSync("git", ["show", ref + ":" + path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;   // 그 판에 그 파일이 없다 — 견줄 것이 없다
  }
}

function pickRefs() {
  if (process.env.REFS) return process.env.REFS.trim().split(/\s+/);
  const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim();
  const mh = gitDir + "/MERGE_HEAD";
  if (existsSync(mh)) {
    const incoming = readFileSync(mh, "utf8").trim().split("\n").filter(Boolean);
    return ["HEAD", ...incoming];
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { encoding: "utf8" });
    return ["origin/main"];
  } catch { return []; }
}

/* ───────── 🔴 자가 무나 — 제품을 재기 전에 확인한다 ───────── */
function selfTest() {
  const head = DOCS[0].head;
  const fails = [];
  const mk = (...ls) => ls.join("\n");

  const A = mk("- **AC-1** 옛 판 · 긴 글 · 여기에 남의 정정이 들어 있다", "- **AC-2** 둘째");
  const B_short = mk("- **AC-1** 옛 판", "- **AC-2** 둘째");
  const B_gone = mk("- **AC-2** 둘째");
  const B_same = A;
  const B_grew = mk("- **AC-1** 옛 판 · 긴 글 · 여기에 남의 정정이 들어 있다 · 게다가 더 붙였다", "- **AC-2** 둘째");
  const B_dup = mk("- **AC-1** 옛 판 · 긴 글 · 여기에 남의 정정이 들어 있다", "- **AC-2** 둘째", "- **AC-1** 또 나온다");

  const ea = entriesOf(A, head).entries;
  //  물어야 할 것 셋
  if (compare(entriesOf(B_short, head), ea, "옛").length !== 1) fails.push("짧아진 항목을 못 물었다");
  if (compare(entriesOf(B_gone, head), ea, "옛").length !== 1) fails.push("사라진 항목을 못 물었다");
  if (entriesOf(B_dup, head).dup.length !== 1) fails.push("같은 번호가 두 번 나온 것을 못 물었다");
  //  🔴 무해 변이 둘 — 물면 안 된다
  if (compare(entriesOf(B_same, head), ea, "옛").length !== 0) fails.push("안 바뀐 항목을 물었다");
  if (compare(entriesOf(B_grew, head), ea, "옛").length !== 0) fails.push("길어진 항목을 물었다(그건 수리다)");
  //  모수 지킴이 — 옛 판이 비면 «볼 것 0» 이 아니라 «못 쟀다»여야 한다
  if (entriesOf("", head).entries.size !== 0) fails.push("빈 문서에서 항목을 만들어 냈다");

  return fails;
}

/** 지금 판 vs 옛 판. 반환: 사람이 볼 곳들. */
function compare(now, oldEntries, refName) {
  const hits = [];
  for (const [key, oldText] of oldEntries) {
    const cur = now.entries.get(key);
    if (cur === undefined) { hits.push({ key, refName, why: "사라졌다", was: oldText.length, is: 0 }); continue; }
    if (cur === oldText) continue;
    if (cur.length < oldText.length) hits.push({ key, refName, why: "짧아졌다", was: oldText.length, is: cur.length });
  }
  return hits;
}

const selfFails = selfTest();
if (selfFails.length) {
  console.error("🔴 자가 못 쟀다(자기시험 실패) — 제품을 재지 않고 멈춘다:");
  for (const f of selfFails) console.error("   · " + f);
  process.exit(2);
}

/* ───────── 제품을 잰다 ───────── */
const refs = pickRefs();
if (!refs.length) {
  console.error("🔴 자가 못 쟀다 — 견줄 판이 없다(머지 중도 아니고 origin/main 도 없다). `REFS=\"...\"` 로 줘라.");
  process.exit(2);
}

const midMerge = refs[0] === "HEAD" && refs.length > 1;
console.log("■ 견주는 판: " + refs.join(" · ") + (midMerge ? "   (머지 도중 — 커밋 전 관문이다)" : ""));

let hits = [], compared = 0, dupNew = [], dupOld = [];
for (const doc of DOCS) {
  const nowText = readFileSync(doc.path, "utf8");
  const now = entriesOf(nowText, doc.head);
  console.log("   " + doc.path + " — 지금 항목 " + now.entries.size + "개");

  //  🔴 이미 옛 판에도 있던 겹침은 **오늘 낸 것이 아니다** — 갈라서 말한다.
  //     안 가르면 «늘 빨강»이 되고, 늘 빨강인 자는 사람이 곧 무시한다(AC-112 ⑤).
  const wasDup = new Set();
  for (const ref of refs) {
    const old = atRef(ref, doc.path);
    if (old === null) { console.log("     ⊘ " + ref + " 에는 이 파일이 없다"); continue; }
    const o = entriesOf(old, doc.head);
    for (const k of o.dup) wasDup.add(k);
    if (o.entries.size === 0) { console.log("     ⊘ " + ref + " 에서 항목 0개 — 🔴 못 쟀다(모양이 바뀌었나)"); continue; }
    compared++;
    console.log("     " + ref + " — 옛 항목 " + o.entries.size + "개" + (o.dup.length ? " · 그때도 겹친 번호 " + o.dup.length + "개" : ""));
    hits.push(...compare(now, o.entries, ref));
  }
  for (const k of now.dup) (wasDup.has(k) ? dupOld : dupNew).push({ path: doc.path, key: k });
}

if (!compared) {
  console.error("🔴 자가 못 쟀다 — 실제로 견준 판이 0개다.");
  process.exit(2);
}

for (const d of dupNew) console.log("🔴 " + d.path + " — " + d.key + " 가 **두 번** 나온다(이번 판에서 생겼다 · 양쪽을 다 붙여 놓고 못 본 것)");
for (const h of hits) console.log("🔴 " + h.key + " 가 " + h.refName + " 보다 " + h.why + " (" + h.was + "자 → " + h.is + "자)");

if (dupOld.length) {
  console.log("");
  console.log("⚠️ **옛날부터 겹쳐 있던 번호 " + dupOld.length + "개** — 오늘 난 것이 아니라 종료코드에 안 넣는다. 다만 **말은 한다**:");
  console.log("   " + dupOld.map(d => d.key).join(" · "));
  console.log("   🔴 서로 **다른 내용**이 같은 번호를 쓰고 있다 ⇒ «AC-219 를 봐라»가 어느 쪽인지 안 가려진다.");
  console.log("   창을 병렬로 돌리던 시절 같은 칸을 둘이 쓴 자국이다. 고치려면 **가리키는 곳까지** 같이 고쳐야 한다.");
}

const bad = hits.length + dupNew.length;
console.log("■ 볼 곳 " + bad + "곳");
if (bad) {
  console.log("");
  console.log("🔴 막지 않는다 — **보라는 것**이다. 일부러 줄였으면 그대로 커밋하면 된다.");
  console.log("   견주려면: git show <판>:docs/rules/PITFALLS.md | grep '^- \\*\\*AC-<번호>'");
}
process.exit(bad ? 1 : 0);
