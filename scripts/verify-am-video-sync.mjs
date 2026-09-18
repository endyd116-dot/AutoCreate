/**
 * scripts/verify-am-video-sync.mjs — 🔴 «AM 이 영상 쪽을 고쳤는데 우리가 아직 안 봤나»
 *
 *   왜 필요한가 (2026-09-19 실측):
 *   AM 이 **최근 2주에만 영상 파일을 8번** 고쳤다 — «소리 없는 영상» 잡는 축 · 자막을 «구절» 단위로 ·
 *   컷 칸 예산을 실측 계수로 · 영상 사고 재발 방지 4항. 🔴 **AC 는 그중 하나도 모르고 있었다.**
 *   두 제품은 같은 영상 엔진에서 갈라져 나왔다. 사람 기억으로 맞추면 **몇 주가 지나도 안 맞춰진다.**
 *
 *   🔴 이 자가 하는 일은 **«알려 주기»까지다. «가져오기»가 아니다.**
 *   AM 은 광고·세그, AC 는 콘텐츠·쇼핑 쇼츠다 — **배선이 다르므로 그대로 옮기면 안 되는 것이 섞여 있다.**
 *   무엇이 우리한테 해당하는지는 **사람이 본다.** 자동으로 받아 오면 AM 의 실수까지 조용히 들어온다.
 *
 *   쓰는 법:
 *     node scripts/verify-am-video-sync.mjs           — 안 본 것이 있으면 빨강(1)
 *     node scripts/verify-am-video-sync.mjs --seen "왜 이렇게 판단했는지 한 줄"
 *                                                     — 여기까지 봤다고 표시(초록으로 돌아간다)
 *   AM 이 옆에 없으면 **종료코드 2 = «못 쟀음»**(통과가 아니다 · AC-9).
 *   백슬래시 없는 검사만 쓴다(AC-100).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const AM = process.env.AM_DIR || "../AutoMarketing";
const MARK = "docs/rules/am-video-seen.json";
/** 🔴 «영상 파일»을 **이름으로 고르면 안 된다** — 2026-09-19 첫 판이 그래서 40건을 쏟아냈다.
 *  AM 은 **광고 소재를 «creative» 라고 부른다.** 그래서 `creative-launch`(랜딩) · `creative-studio`(화면) ·
 *  `admin-creatives`(운영 API) 가 전부 걸렸다 — 영상 엔진과 아무 상관이 없는 AM 의 제품 배선이다.
 *  🔴 **이름 대신 «지금 그 파일이 ffmpeg 를 만지나»로 고른다** — 레포에서 세는 것이지 내가 적는 것이 아니다.
 *  (`shorts-*` 는 대본·자막 계산이라 ffmpeg 를 직접 안 불러도 같은 층으로 본다.) */
function engineFiles() {
  const out = new Set();
  const dir = `${AM}/lib`;
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!/[.]ts$/.test(f)) continue;
    const p = `${dir}/${f}`;
    let body = ""; try { body = readFileSync(p, "utf8"); } catch { continue; }
    if (f.startsWith("shorts-") || body.includes("ffmpeg")) out.add(`lib/${f}`);
  }
  return out;
}

const ENGINE_LATE = null;
const git = (args) => execFileSync("git", ["-C", AM, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

if (!existsSync(`${AM}/.git`)) {
  console.log(`\u2298 못 쟀음 — AM 레포를 못 찾았다(${AM}).`);
  console.log(`   옆에 두거나 알려 달라:  AM_DIR=../AutoMarketing node scripts/verify-am-video-sync.mjs`);
  process.exit(2);
}

const ENGINE = engineFiles();
if (!ENGINE.size) { console.log("⊘ 못 쟀음 — AM lib 에서 영상 엔진 파일을 하나도 못 찾았다."); process.exit(2); }

const mark = existsSync(MARK) ? JSON.parse(readFileSync(MARK, "utf8")) : {};
const since = mark.seen || "";

/** since 이후 AM 커밋 가운데 **영상 파일을 건드린 것**만. since 가 없으면 최근 30일. */
function unseen() {
  const range = since ? [`${since}..HEAD`] : ["--since=30 days ago"];
  const raw = git(["log", ...range, "--name-only", "--format=%x01%H%x02%ad%x02%s", "--date=short"]);
  const out = [];
  for (const block of raw.split("\u0001").slice(1)) {
    const nl = block.indexOf("\n");
    const [sha, date, subj] = block.slice(0, nl < 0 ? undefined : nl).split("\u0002");
    const files = (nl < 0 ? "" : block.slice(nl + 1)).split("\n").map((s) => s.trim()).filter(Boolean);
    const touched = files.filter((f) => ENGINE.has(f));
    if (touched.length && !/^Merge branch/.test(subj || "")) out.push({ sha, date, subj, touched });
  }
  return out;
}

const list = unseen();

if (process.argv.includes("--seen")) {
  const i = process.argv.indexOf("--seen");
  const note = process.argv[i + 1] || "";
  const head = git(["rev-parse", "HEAD"]).trim();
  writeFileSync(MARK, JSON.stringify({ seen: head, at: new Date().toISOString().slice(0, 10), note, count: list.length }, null, 2) + "\n");
  console.log(`\u2713 여기까지 봤다고 적었다 — AM ${head.slice(0, 9)} (${list.length}건)`);
  if (note) console.log(`  적어 둔 판단: ${note}`);
  else console.log(`  \u26a0 판단을 안 적었다. 다음 사람이 «왜 안 가져왔지»를 다시 묻게 된다.`);
  process.exit(0);
}

console.log(`\u25a0 AM 이 영상 쪽을 고쳤는데 우리가 아직 안 본 것\n`);
if (!list.length) {
  console.log(`\u2713 없다. ${since ? `마지막으로 본 곳 = AM ${since.slice(0, 9)}` : "(최근 30일 기준)"}`);
  if (mark.note) console.log(`  그때 적어 둔 판단: ${mark.note}`);
  process.exit(0);
}

for (const c of list) {
  console.log(`\u2717 ${c.date}  ${c.subj}`);
  console.log(`     ${c.touched.slice(0, 4).join(" \u00b7 ")}${c.touched.length > 4 ? ` \u00b7 +${c.touched.length - 4}개` : ""}`);
}
console.log(`\n\u25a0 안 본 것 ${list.length}건`);
console.log(`\u2298 🔴 이 자는 **«가져와라»가 아니라 «봐라»**다 — AM 은 광고, 우리는 콘텐츠라 **그대로 옮기면 안 되는 것이 섞여 있다.**`);
console.log(`   해당 없으면 그것도 답이다. 보고 나서:`);
console.log(`   node scripts/verify-am-video-sync.mjs --seen "예: 자막 구절 단위는 우리도 받음 · 광고 CTA 축은 해당 없음"`);
process.exit(1);
