// AM 원본: ../AutoMarketing/scripts/neon-migrate.mjs (복사 2026-09-14 · 무수정)
/**
 * Neon 추가형(additive) 마이그 러너 — AutoCreate 라이브 DB(old-tree-90235056·us-east-2).
 * 사용: node scripts/neon-migrate.mjs <ddl-file.sql>
 *   - Neon API 키는 리포 밖 C:/Users/Administrator/.neon-am-key 에서 읽음(git 미추적).
 *   - direct(pooled=false) 접속으로 멱등 DDL 적용. 각 문장 독립 try/catch·JSON 보고.
 * ★ 안전: DROP/TRUNCATE/DELETE/RENAME/ADD ... DROP 등 파괴적 문장은 거부(추가형만).
 *   파괴적 변경이 필요하면 이 러너 쓰지 말고 사람이 백업 후 수동(메모리 neon-netlify-remote 규칙).
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

// 키 경로: 현 사용자 홈 우선 → 집 PC(Administrator) 폴백(사무실/집 양쪽 동작·2026-07-03).
import { homedir } from "node:os";
import { existsSync } from "node:fs";
const KEY_PATH = [`${homedir()}/.neon-am-key`, "C:/Users/Administrator/.neon-am-key"].find(existsSync) || `${homedir()}/.neon-am-key`;
const PROJECT = process.env.NEON_PROJECT_ID || "old-tree-90235056"; // AutoCreate (us-east-2 · 2026-09-14 신설)
const file = process.argv[2];
if (!file) { console.error("사용: node scripts/neon-migrate.mjs <ddl-file.sql>"); process.exit(2); }

const raw = readFileSync(file, "utf8");
// 문장 분리(단순 세미콜론 — 함수정의 등 복잡 DDL은 이 러너 대상 아님). 주석/빈 줄 제거.
const stmts = raw.split(/;\s*(?:\r?\n|$)/).map(s => s.replace(/--[^\n]*/g, "").trim()).filter(Boolean);

// 안전 가드: 추가형만 허용. 파괴적 키워드 거부.
const DESTRUCTIVE = /\b(drop|truncate|delete|rename|alter\s+\w+\s+.*\bdrop\b)\b/i;
const bad = stmts.filter(s => DESTRUCTIVE.test(s));
if (bad.length) {
  console.error(JSON.stringify({ ok: false, refused: "파괴적 문장 거부(추가형 러너)", samples: bad.map(s => s.slice(0, 80)) }, null, 2));
  process.exit(3);
}

const key = readFileSync(KEY_PATH, "utf8").trim();
const res = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}/connection_uri?database_name=neondb&role_name=neondb_owner&pooled=false`,
  { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) { console.error(JSON.stringify({ ok: false, step: "fetch_uri", status: res.status })); process.exit(4); }
const uri = (await res.json()).uri;

const sql = postgres(uri, { max: 1, ssl: "require", connect_timeout: 20 });
const applied = [], fails = [];
for (const s of stmts) {
  try { await sql.unsafe(s); applied.push(s.slice(0, 70)); }
  catch (e) { fails.push({ stmt: s.slice(0, 70), err: String(e?.message || e).slice(0, 160) }); }
}
console.log(JSON.stringify({ ok: fails.length === 0, applied: applied.length, total: stmts.length, fails }, null, 2));
await sql.end();
