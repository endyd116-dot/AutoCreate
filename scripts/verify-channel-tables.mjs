/**
 * scripts/verify-channel-tables.mjs — 채널 표 두 벌이 어긋나지 않는지 본다(읽기 전용 · P1R8 §5.2).
 *   `node scripts/verify-channel-tables.mjs`
 *
 *   ══ 무엇을 보나 ══
 *     ① `lib/channel-registry.ts` 의 `textGen: true` 채널에 **글 계약**(`lib/writing-contracts.ts WRITING_CONTRACTS`)이 있나
 *        — 없으면 «글을 만들어 준다»고 해 놓고 못 만든다.
 *     ② 글 계약에만 있고 표에 없는 채널(오타·유령 채널)
 *     ③ `publishVia: "runner"` 인데 `jobKind` 가 없는 채널 — «러너로 간다»는데 적재할 잡 이름이 없다.
 *   🔴 두 파일을 **합치지 않고** 검사만 하는 이유: 성격이 다르고(성질 vs 글 계약), R8 §2 에서 다른 세션이 계약 파일을 고치는 중이다.
 *   🔴 읽기 전용 — 고치지 않는다. 어긋나면 종료코드 1.
 *   🔎 출처: AC 신규(계약 P1R8 §5.2 · 생성 2026-09-15) — AM 원본 없음.
 */
import { readFileSync } from "node:fs";

const reg = readFileSync("lib/channel-registry.ts", "utf8");
const con = readFileSync("lib/writing-contracts.ts", "utf8");

/* 표 파싱 — 정규식으로 «key: "…"» 와 그 행의 칸들을 뽑는다(모듈을 import 하면 DB·타입 의존이 딸려 온다). */
const rows = [...reg.matchAll(/\{\s*key:\s*"([^"]+)"[^}]*\}/g)].map((m) => {
  const body = m[0];
  /* 값 그대로 뽑는다(따옴표는 벗긴다) — 한 행이 한 줄이라 줄 단위 정규식으로 충분하다. */
  const pick = (name) => {
    const m2 = body.match(new RegExp(name + ":\\s*(\"[^\"]*\"|null|true|false)"));
    if (!m2) return null;
    const v = m2[1];
    if (v === "null") return null;
    return v.startsWith("\"") ? v.slice(1, -1) : v;
  };
  return { key: m[1], publishVia: pick("publishVia"), jobKind: pick("jobKind"), textGen: pick("textGen") === "true" };
});
/** 글 계약에 있는 채널 키 — `WRITING_CONTRACTS` 의 최상위 키(`naver_blog: {` 꼴). */
const contractKeys = new Set([...con.matchAll(/^\s{2}([a-z_]+):\s*\{$/gm)].map((m) => m[1]));

const problems = [];
for (const r of rows) {
  if (r.textGen && !contractKeys.has(r.key)) problems.push(`🔴 ${r.key}: textGen=true 인데 글 계약이 없다 — «글을 만들어 준다»고 해 놓고 못 만든다`);
  if (r.publishVia === "runner" && !r.jobKind) problems.push(`🔴 ${r.key}: 러너 발행인데 jobKind 가 없다 — 적재할 잡 이름이 없다`);
}
for (const k of contractKeys) if (!rows.some((r) => r.key === k)) problems.push(`🟡 ${k}: 글 계약에는 있는데 채널 표에 없다(유령 채널·오타?)`);

console.log(`채널 표 ${rows.length}행 · 글 계약 ${contractKeys.size}채널`);
console.log(`  textGen=true: ${rows.filter((r) => r.textGen).map((r) => r.key).join(" ") || "(없음)"}`);
console.log(`  publishVia=null(아직 못 올림): ${rows.filter((r) => !r.publishVia).map((r) => r.key).join(" ") || "(없음)"}`);
if (!rows.length || !contractKeys.size) { console.log("🔴 표를 못 읽었다 — 파일 모양이 바뀌었나 본다(검사 자체가 조용히 통과하지 않게 실패로 둔다)"); process.exit(1); }
if (problems.length) { console.log("\n" + problems.join("\n")); process.exit(1); }
console.log("\n✅ 두 표가 어긋나지 않는다");
