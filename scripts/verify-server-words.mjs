/**
 * scripts/verify-server-words.mjs — 🔴 **고객이 읽는 «서버 문장»**이 규칙을 지키는지(CLAUDE §3 · DESIGN §13.0).
 *   실행: `node scripts/verify-server-words.mjs`   · DB·네트워크 0.
 *
 *   ══ 왜 만들었나 ══
 *     A 가 화면에서 «발행할 때만 **러너**가 열어요»를 잡았다(2026-09-15). 🔴 그런데 **그 낱말의 출처가 서버인 경우가 있다** —
 *     화면에서 바꿔 쓰면 **두 곳이 갈리고**, 다음에 서버 문구를 고치면 화면이 다시 옛말을 한다.
 *     A 는 화면을 훑는 검사를 만들었다. 이건 **그 반쪽** — 서버가 내보내는 문장을 훑는다.
 *
 *   ══ 두 가지를 본다 ══
 *     ① **시스템 낱말**(§13.0 금지어) — «러너»·«테넌트»·«piece»·«슬롯»·«크론»
 *     ② 🔴 **겁주는 말**(§3 · 사장님 2026-09-15) — 위협(«정지됩니다»)·책임 전가(«알려만 드렸습니다»)
 *        §9 로 게이트를 0개로 내렸는데 말투가 겁주는 것이면 **게이트보다 나쁘다**(막지도 않으면서 불안만 준다).
 *
 *   ══ 어디를 보나 ══
 *     `error:` `message:` `title:` `body:` `desc:` `subject:` `note:` `risk:` `label:` `text:` 같은 **사람이 읽는 칸**의 문자열.
 *     🔴 주석 줄은 안 본다(주석에는 시스템 낱말을 써야 한다 — 다음 사람이 읽을 글이다) · 로그 접두사(`"[이름] …"`)도 뺀다.
 *     🔴 운영자·러너만 보는 파일은 뺀다(`ops-*.ts` · 러너 규약 · 크론 내부) — 거기선 «러너»가 **정확한 말**이다.
 *
 *   ══ 못 하는 것(정직) ══
 *     «이 문장이 고객에게 가나»를 완벽히는 못 가른다 — 칸 이름으로 짐작한다. 그래서 **빠뜨릴 수는 있어도 거짓 경보는 적다.**
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** ① 🔴 고객 화면에 나오면 안 되는 시스템 낱말 → 대신 쓸 말. */
const BANNED = [
  ["러너", "내 PC 프로그램"],
  ["테넌트", "고객(집)"],
  ["크론", "자동 실행"],
  ["piece", "글"],
  ["슬롯", "자리"],
];

/**
 * ② 🔴 겁주는 말 — §3.
 *   고치는 법은 늘 같다: **①사실 한 줄 ②어떻게 하면 되는지 ③우리가 대신 해 주는 것.**
 *   위험은 **재료**로 주고 **고르는 것은 고객**이다.
 */
const SCARY = [
  [/정지(됩니다|될 수|돼요|될지)/, "위협", "«천천히 늘릴수록 오래 잘 돌아요» 처럼 우리가 왜 그렇게 권하는지로"],
  [/차단(됩니다|될 수|돼요)/, "위협", "무엇이 막히는지 사실만 + 푸는 길"],
  [/삭제(됩니다|될 수)/, "위협", "언제·무엇이 지워지는지 사실 + 되돌릴 길"],
  [/불이익/, "위협", "구체적으로 무엇이 달라지는지"],
  [/알려만/, "책임 전가", "«바로 알려 드릴게요» 처럼 우리가 하는 일로"],
  [/책임(입니다|이에요|집니다|지지 않)/, "책임 전가", "우리가 대신 해 주는 것부터"],
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

/** 그 줄에서 «사람이 읽는 칸에 실린 한글 문장»을 꺼낸다. 없으면 null. */
function humanStringOf(code) {
  if (!HUMAN_FIELDS.test(code)) return null;
  const m = /["'`][^"'`]*[가-힣][^"'`]*["'`]/.exec(code);
  if (!m) return null;
  if (/^["'`]\[[^\]]+\]/.test(m[0])) return null;   // 로그 접두사는 고객 문장이 아니다
  return m[0];
}

const files = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "netlify", "functions"))];
const hits = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (SKIP.some((re) => re.test(rel))) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let inBlock = false;
  lines.forEach((line, i) => {
    /* 주석은 건너뛴다. */
    if (inBlock) { if (line.includes("*/")) inBlock = false; return; }
    if (/^\s*\/\*/.test(line)) { if (!line.includes("*/")) inBlock = true; return; }
    if (/^\s*(\*|\/\/)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, "");

    /* ① 시스템 낱말 — 키 이름 문자열도 봐야 해서 따로 훑는다. */
    if (HUMAN_FIELDS.test(code)) {
      for (const [word, better] of BANNED) {
        const m = new RegExp(`["'\`][^"'\`]*${word}[^"'\`]*["'\`]`).exec(code);
        if (!m) continue;
        if ((word === "piece" || word === "슬롯") && !/[가-힣]/.test(m[0])) continue;
        if (/^["'`]\[[^\]]+\]/.test(m[0])) continue;
        hits.push({ rel, line: i + 1, kind: `«${word}»`, better, text: m[0].slice(0, 80) });
      }
    }

    /* ② 겁주는 말 — 한글 문장에만 해당. */
    const str = humanStringOf(code);
    if (!str) return;
    for (const [re, kind, better] of SCARY) {
      if (re.test(str)) hits.push({ rel, line: i + 1, kind, better, text: str.slice(0, 80) });
    }
  });
}

const W = (s, n) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
console.log(`\n🔎 서버 문장 검사 — 파일 ${files.length}개 · 시스템 낱말 ${BANNED.length}종 · 겁주는 말 ${SCARY.length}종\n`);
if (!hits.length) {
  console.log("✓ 고객이 읽는 서버 문장에 시스템 낱말도, 겁주는 말도 없다.");
} else {
  for (const h of hits) console.log(`✗ ${W(`${h.rel}:${h.line}`, 42)} ${W(h.kind, 10)} ${h.text}\n   → ${h.better}`);
  console.log(`\n🔴 ${hits.length}곳. 화면에서 바꿔 쓰지 말고 **서버에서** 고치세요 — 화면에서 바꾸면 두 곳이 갈립니다.`);
}
console.log("");
process.exit(hits.length ? 1 : 0);
