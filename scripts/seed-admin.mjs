// scripts/seed-admin.mjs — 초기 운영자 admin/admin1234 (super_admin · must_change_password=true). 멱등(있으면 건너뜀).
//   사용: node scripts/seed-admin.mjs   (.env 의 NETLIFY_DATABASE_URL 사용)
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
if (!url) { console.error("NETLIFY_DATABASE_URL 없음"); process.exit(1); }
const sql = postgres(url, { ssl: "require", max: 1 });

const email = "admin@ops.local";
const [exists] = await sql`SELECT id FROM operators WHERE email = ${email}`;
if (exists) { console.log("이미 있음:", email, "(id", exists.id + ")"); }
else {
  const hash = await bcrypt.hash("admin1234", 12);
  const [row] = await sql`INSERT INTO operators (email, password_hash, name, role, active, must_change_password)
    VALUES (${email}, ${hash}, ${"관리자"}, ${"super_admin"}, true, true) RETURNING id`;
  console.log("생성:", email, "id", row.id, "— 로그인 아이디 admin · 비밀번호 admin1234 · 첫 로그인에 변경 강제");
}
await sql.end();
