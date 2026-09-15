/**
 * scripts/verify-server-words.mjs — 🔴 **고객이 읽는 «서버 문장»에 시스템 낱말이 없는지**(CLAUDE §3 · DESIGN §13.0 금지어).
 *   실행: `node scripts/verify-server-words.mjs`   · DB·네트워크 0.
 *
 *   ══ 왜 만들었나 ══
 *     A 가 화면에서 «발행할 때만 **러너**가 열어요»를 잡았다(2026-09-15). 🔴 그런데 **그 낱말의 출처가 서버인 경우가 있다** —
 *     화면에서 바꿔 쓰면 **두 곳이 갈리고**, 다음에 서버 문구를 고치면 화면이 다시 옛말을 한다.
 *     A 는 화면을 훑는 검사를 만들었다. 이건 **그 반쪽** — 서버가 내보내는 문장을 훑는다.
 *
 *   ══ 무엇을 보나 ══
 *     `error:` `message:` `title:` `body:` `desc:` `subject:` `note:` `risk:` `label:` 같은 **사람이 읽는 칸**에 실린 문자열.
 *     🔴 주석 줄은 안 본다(주석에는 시스템 낱말을 써야 한다 — 다음 사람이 읽을 글이다).
 *     🔴 운영자·러너만 보는 파일은 뺀다(`ops-*.ts` · 러너 규약 · 크론 내부) — 거기선 «러너»가 **정확한 말**이다.
 *
 *   ══ 못 하는 것(정직) ══
 *     «이 문장이 고객에게 가나»를 완벽히는 못 가른다 — 칸 이름으로 짐작한다. 그래서 **빠뜨릴 수는 있어도 거짓 경보는 적다.**
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/** 🔴 고객 화면에 나오면 안 되는 낱말 → 대신 쓸 말. */
const BANNED = [
  ["러너", "내 PC 프로그램"],
  ["테넌트", "고객(집)"],
  ["크론", "자동 실행"],
  ["piece", "글"],
  ["슬롯", "자리"],
];
/** 사람이 읽는 칸 이름. */
const HUMAN_FIELDS = /\b(error|message|title|body|desc|description|subject|note|risk|reason|label|text)\s*:/;
/** 운영자·러너만 보는 곳 — 거기선 그 낱말이 **정확한 말**이다. */
const SKIP = [
  /netlify[\\/]functions[\\/]ops-/, /lib[\\/]ops[\\/]/, /lib[\\/]runner-jobs\.ts$/, /lib[\\/]recipe/, /lib[\\/]cron[\\/]runner\.ts$/,
  /lib[\\/]cron[\\/](publish-port|managed-runner-watch|learn)\.ts$/, /lib[\\/]channel-registry\.ts$/, /lib[\\/]account-close\.ts$/,
  /lib[\\/]proxy-port\.ts$/, /lib[\\/]retract-port\.ts$/,
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "netlify", "functions"))];
const hits = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (SKIP.some((re) => re.test(rel))) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let inBlock = false;
  lines.forEach((raw, i) => {
    const line = raw;
    /* 주석은 건너뛴다 — 주석에는 시스템 낱말을 써야 한다. */
    if (inBlock) { if (line.includes("*/")) inBlock = false; return; }
    if (/^\s*\/\*/.test(line)) { if (!line.includes("*/")) inBlock = true; return; }
    if (/^\s*(\*|\/\/)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, "");
    if (!HUMAN_FIELDS.test(code)) return;
    for (const [word, better] of BANNED) {
      /* 낱말이 **문자열 안**에 있을 때만 — 변수명·키 이름은 아니다. */
      const re = new RegExp(`["'\`][^"'\`]*${word}[^"'\`]*["'\`]`);
      const m = re.exec(code);
      if (!m) continue;
      /* `piece`·`슬롯` 은 키 이름으로도 자주 쓰여 오탐이 많다 — 한글 문장 안에 있을 때만 잡는다. */
      if ((word === "piece" || word === "슬롯") && !/[가-힣]/.test(m[0])) continue;
      /* 🔴 `console.*("[이름] …")` 의 **로그 접두사**는 고객 문장이 아니다 — 파일 이름을 그대로 쓰는 게 맞다. */
      if (/^["'`]\[[^\]]+\]/.test(m[0])) continue;
      /* 🔴 [메인 2026-09-16] **감사 기록의 `detail`(note 등)은 운영자만 본다** — 고객 화면이 감사를 부르는 곳은 **0곳**이고
       *    보는 자리는 `public/ops/audit.html` 뿐이다(실측). 그래서 여기 낱말은 «러너»가 **맞다**.
       *    🔴 여기까지 고객 말투를 들이밀면 **우리 발등을 찍는다** — 운영자가 러너 문제를 쫓을 때 «러너»로 못 찾고
       *       «내 PC 프로그램»으로 grep 해야 한다. 이 하니스의 값은 «거짓 경보를 적게»이고(B 원칙),
       *       첫날부터 빨간 검사는 아무도 안 본다.
       *    ⚠️ **경계**: 감사 `detail` 중에서도 «고객 알림·메일 문구를 만들어 내는 칸»은 계속 재야 한다.
       *       그런 칸은 `detail` 안이 아니라 알림·메일을 만드는 자리에 두고, 그 자리는 이 검사가 그대로 본다. */
      if (/writeAudit|auditDetail|riskLevel/.test(code)) continue;
      hits.push({ rel, line: i + 1, word, better, text: m[0].slice(0, 90) });
    }
  });
}

const W = (s, n) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
console.log(`\n🔎 서버 문장 낱말 검사 — 파일 ${files.length}개 · 금지 낱말 ${BANNED.length}종\n`);
if (!hits.length) {
  console.log("✓ 고객이 읽는 서버 문장에 시스템 낱말이 없다.");
} else {
  for (const h of hits) console.log(`✗ ${W(`${h.rel}:${h.line}`, 44)} «${h.word}» → «${h.better}»   ${h.text}`);
  console.log(`\n🔴 ${hits.length}곳. 화면에서 바꿔 쓰지 말고 **서버에서** 고치세요 — 화면에서 바꾸면 두 곳이 갈립니다.`);
}
console.log("");
process.exit(hits.length ? 1 : 0);
