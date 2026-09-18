/**
 * scripts/verify-key-contract-mutants.mjs — 🔴 **«그 자가 정말 우는가»를 잰다**(C · 수리 라운드 2026-09-19).
 *   사용: node scripts/verify-key-contract-mutants.mjs
 *
 *   ══ 왜 ══
 *   AC-108: **«자를 냈다»는 값이 아니다. «그 자에 변이를 넣으면 우는가»가 값이다.**
 *   2026-09-19 메인이 만든 «막는 손 ↔ 푸는 손» 자가 태어나자마자 19/0 초록이었는데,
 *   정작 제일 중요한 변이(**푸는 문에 담을 새로 세움**)에 **안 울었다** — 손으로 박은 목록 밖이라 아예 안 봤기 때문이다.
 *   🔴 그래서 이 리포의 규율은 «**만든 사람이 자기 자에 변이를 한 번은 넣어 본다**»이고, 이 파일이 그 몫이다.
 *
 *   ══ 어떻게 ══
 *   리포의 `public/` · `netlify/functions/` 를 임시 폴더로 **복사**해 거기서만 망가뜨린다.
 *   🔴 **진짜 소스는 한 글자도 안 고친다**(AC-34 «실행 중 소스 편집 금지»).
 *   그 다음 `verify-key-contract.mjs` 를 `KEY_CONTRACT_ROOT` 로 그 폴더에 겨눠 돌리고 **빨강/초록이 뒤집히는지** 본다.
 *
 *   ══ 넣는 변이 넷 ══
 *   ① **고친다** — 실제 버그(`ops-tenant-note` 의 `text`)를 `note` 로 고치면 **그 빨강이 사라져야** 한다.
 *      🔴 이게 없으면 그 자는 «늘 빨간 자»다 — 늘 빨간 자는 고쳐도 안 바뀌니 아무도 안 본다.
 *   ② **새로 망가뜨린다** — 멀쩡한 짝(`pieces-approve` 의 `id`)을 `pieceId` 로 바꾸면 **새 빨강이 나야** 한다.
 *   ③ **주석으로 숨긴다** — 서버가 읽는 줄을 통째로 주석 처리하면 **빨강이 나야** 한다(주석을 코드로 세면 안 운다 · AC-109 ①).
 *   ④ **경로를 변수로 바꾼다** — 그러면 이 자가 그 짝을 **아예 못 본다.** 🔴 조용히 초록이 되면 안 되고
 *      «경로를 글자로 적는다» 축이 **대신 울어야** 한다(자가 안 보는 자리를 자가 말하게 한다).
 *
 *   종료코드: 0 = 네 변이가 다 뜻대로 울었다 · 1 = 안 운 변이가 있다(그 자는 그만큼 무력하다) · 2 = 못 쟀다.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = path.join(ROOT, "scripts", "verify-key-contract.mjs");
if (!existsSync(RULER)) { console.error("⊘ 못 쟀어요 — 잴 자(verify-key-contract.mjs)가 없습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

/** 임시 뿌리를 하나 만든다(복사본). */
function freshRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-keycontract-"));
  cpSync(path.join(ROOT, "public"), path.join(dir, "public"), { recursive: true });
  cpSync(path.join(ROOT, "netlify", "functions"), path.join(dir, "netlify", "functions"), { recursive: true });
  return dir;
}
/** 그 뿌리에 대고 자를 돌리고 **찍힌 글자와 종료코드**를 돌려준다. */
function runRuler(dir) {
  try {
    const stdout = execFileSync(process.execPath, [RULER], { env: { ...process.env, KEY_CONTRACT_ROOT: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (e) { return { code: e.status ?? 1, stdout: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
}
/** 파일 한 곳을 바꾼다 — 못 바꾸면 **거짓 초록을 막으려고 던진다**(닻이 낡았다는 뜻이다). */
function patch(dir, relPath, from, to) {
  const p = path.join(dir, relPath);
  const src = readFileSync(p, "utf8");
  if (!src.includes(from)) throw new Error(`닻을 못 찾았다 — ${relPath} 안에 «${from.slice(0, 60)}» 가 없다(자가 아니라 이 변이표가 낡았다)`);
  writeFileSync(p, src.replace(from, to));
}

console.log(`\n«같은 이름으로 부르나» — 🔴 이 자가 정말 우는가(변이 넷) · ${new Date().toISOString()}`);
console.log("─".repeat(112));

/* ── 대조군: 손 안 댄 그대로 ── */
const base = freshRoot();
const b0 = runRuler(base);
const baseHasNote = /ops-tenant-note/.test(b0.stdout);
rec("대조군 — 손 안 댄 리포에서 **실제 버그**(ops-tenant-note 의 `text`)가 빨강이다", baseHasNote && b0.code === 1,
  `종료코드 ${b0.code} · ops-tenant-note 빨강 ${baseHasNote ? "있다" : "없다"}`);

/* ── ① 고치면 그 빨강이 사라지나 ── */
try {
  const d = freshRoot();
  patch(d, "public/ops/tenant.html", "text: d.text }", "note: d.text }");
  const r = runRuler(d);
  const gone = !/ops-tenant-note/.test(r.stdout);
  rec("① **고치면 그 빨강이 사라진다**(늘 빨간 자가 아니다)", gone, gone ? "ops-tenant-note 빨강이 사라졌다" : "🔴 고쳤는데도 그대로 빨갛다 — 이 자는 무력하다");
  rmSync(d, { recursive: true, force: true });
} catch (e) { rec("① 고치면 빨강이 사라진다", false, String(e.message).slice(0, 160)); }

/* ── ② 멀쩡한 짝을 망가뜨리면 새 빨강이 나나 ── */
try {
  const d = freshRoot();
  patch(d, "public/app/piece.html", `UI.api("/api/pieces-approve", { body: { id`, `UI.api("/api/pieces-approve", { body: { pieceId`);
  const r = runRuler(d);
  const cried = /pieces-approve/.test(r.stdout) && r.code === 1;
  rec("② **멀쩡한 짝을 망가뜨리면 운다**(`pieces-approve` 의 `id` → `pieceId`)", cried,
    cried ? "새 빨강이 났다" : "🔴 안 울었다 — 이 자는 새로 생기는 어긋남을 못 본다");
  rmSync(d, { recursive: true, force: true });
} catch (e) { rec("② 멀쩡한 짝을 망가뜨리면 운다", false, String(e.message).slice(0, 160)); }

/* ── ③ 서버가 읽는 줄을 주석으로 숨기면 우나 ── */
try {
  const d = freshRoot();
  /* 🔴 변이를 **제대로** 넣는다 — 처음엔 주석을 닫은 뒤 `const note = ""` 를 그대로 남겼더니
     «서버가 같은 이름을 스스로 만든다» 갈래로 새서 안 울었다. **그건 자의 잘못이 아니라 내 변이의 잘못이었다.**
     ⇒ 이름을 `memo` 로 바꿔 `note` 가 **주석 안에만** 남게 한다. 그래야 «주석을 코드로 세나»를 진짜로 잰다. */
  /* 🔴 `note` 가 **주석 말고는 아무 데도 안 남게** 지운다 — 타입 선언까지 바꿔야 한다.
     (두 번째 판에서 `readJson<{ note?: string }>` 를 안 바꿔서 안 울었다. 그건 자가 **옳게** 센 것이다 —
      타입에 적혀 있으면 «읽을 뜻이 있다»가 맞다. 변이가 덜 된 것이었다.) */
  patch(d, "netlify/functions/ops-tenants.ts", `readJson<{ id?: number; note?: string }>(req)`, `readJson<{ id?: number; memo?: string }>(req)`);
  patch(d, "netlify/functions/ops-tenants.ts", `const note = String(b.note ?? "").slice(0, 2000);`,
    `/* 옛 코드: const note = String(b.note ?? "").slice(0, 2000); */ const memo = String(b.memo ?? "").slice(0, 2000);`);
  patch(d, "netlify/functions/ops-tenants.ts", `SET ops_note = ${"${note}"}`, `SET ops_note = ${"${memo}"}`);
  patch(d, "netlify/functions/ops-tenants.ts", `detail: { length: note.length }`, `detail: { length: memo.length }`);
  patch(d, "netlify/functions/ops-tenants.ts", `return json({ ok: true, note });`, `return json({ ok: true, memo });`);
  const r = runRuler(d);
  /* 화면은 `text` 를 보내니 원래도 빨갛다 — 여기서 보는 것은 «`note` 가 주석으로 가도 읽는 것으로 세지 않나»다.
     그래서 화면도 같이 고쳐 `note` 를 보내게 해 놓고, 그래도 빨간지 본다. */
  patch(d, "public/ops/tenant.html", "text: d.text }", "note: d.text }");
  const r2 = runRuler(d);
  const cried = /ops-tenant-note/.test(r2.stdout);
  rec("③ **주석 안의 키는 «읽는다»로 세지 않는다**(주석을 코드로 세면 이 병을 못 본다 · AC-109 ①)", cried,
    cried ? "주석으로 숨기니 빨개졌다" : "🔴 주석을 코드로 세고 있다 — 이 자가 AC-109 의 병에 걸렸다");
  void r;
  rmSync(d, { recursive: true, force: true });
} catch (e) { rec("③ 주석 안의 키는 읽는 것으로 안 센다", false, String(e.message).slice(0, 160)); }

/* ── ④ 경로를 변수로 바꾸면 «못 본다»고 말하나 ── */
try {
  const d = freshRoot();
  patch(d, "public/ops/tenant.html", `UI.api("/api/ops-tenant-note"`, "UI.api(NOTE_PATH");
  const r = runRuler(d);
  const noteGone = !/ops-tenant-note/.test(r.stdout);
  const saidSo = /변수 경로 [1-9]/.test(r.stdout);
  rec("④ **자가 안 보는 자리를 자가 말한다**(경로를 변수로 바꾸면 «변수 경로» 축이 운다)", noteGone && saidSo,
    `그 짝은 ${noteGone ? "안 보인다" : "아직 보인다"} · «변수 경로» 축이 ${saidSo ? "울었다" : "🔴 조용하다 — 조용한 초록이다"}`);
  rmSync(d, { recursive: true, force: true });
} catch (e) { rec("④ 자가 안 보는 자리를 자가 말한다", false, String(e.message).slice(0, 160)); }

rmSync(base, { recursive: true, force: true });

console.log("─".repeat(112));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length}`);
console.log("🔴 이 자가 초록이라야 `verify-key-contract.mjs` 의 초록을 믿을 수 있다(AC-108).\n");
process.exit(fails.length ? 1 : 0);
