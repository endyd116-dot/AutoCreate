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
/* 🔴 **대조군도 «그 버그가 아직 있다»에 매이면 안 된다**(2026-09-19 · AC-112 ⑥).
   옛 판은 「손 안 댄 리포에서 `ops-tenant-note` 가 빨갛다」였는데, **B 가 그걸 고치자 대조군이 빨개졌다** —
   제품이 좋아졌는데 자가 우는 것은 **대조군이 낡은 것**이다.
   ⇒ 이제 «**자가 살아서 무언가는 재고 있다**»만 본다: 짝을 실제로 세었나(0쌍이면 이 자는 아무것도 안 본 것이다). */
const basePairs = Number((b0.stdout.match(/대조한 짝 (\d+)쌍/) ?? [])[1] ?? 0);
rec("대조군 — 손 안 댄 리포에서 **자가 살아서 짝을 센다**(0쌍이면 아무것도 안 보고 있는 것이다)", basePairs > 0,
  `대조한 짝 ${basePairs}쌍 · 종료코드 ${b0.code}`);

/* ── ① 🔴 **망가뜨리면 우나** ── (2026-09-19 · AC-112 ⑥ 으로 뒤집었다)
   옛 판은 「메모의 `text` 를 `note` 로 **고치면** 빨강이 사라지나」였다. **B 가 그 자리를 고치자 닻을 잃고 빨개졌다** —
   자가 무력해서가 아니라 **이미 고쳐졌기 때문에** 못 도는 변이다.
   ⇒ **망가뜨리는 쪽**으로 짠다: 서버가 읽는 키를 **딴 이름으로 바꿔** 놓고 그 짝이 빨개지는지 본다.
   이 방향은 **고쳐진 뒤에도 늘 돈다.** 닻도 «지금 서버가 실제로 읽는 이름»에서 **찾아서** 쓴다(글자를 못 박지 않는다). */
try {
  const d = freshRoot();
  const srv = readFileSync(path.join(d, "netlify", "functions", "ops-tenants.ts"), "utf8");
  const blk = srv.slice(srv.indexOf('endsWith("/ops-tenant-note")'));
  /* 그 블록이 몸통에서 읽는 키를 한 개 집어 온다(`b.xxx`). */
  /* 🔴 **읽는 키를 «전부» 바꿔야 한다** — 하나만 바꾸면 안 운다.
     B 가 이 라우트를 `text` **와** `note` 둘 다 받게 고쳐서, `text` 만 바꾸니 `note` 가 받아 줬다.
     («하나만 지워서 안 운» AC-112 ② 의 또 한 판 — 오늘만 다섯 번째다.) */
  const keys = [...new Set((blk.match(/\bb\.([A-Za-z_$][\w$]*)/g) ?? []).map((s) => s.slice(2)))].filter((k) => k !== "id");
  if (!keys.length) throw new Error("그 라우트가 `b.…` 로 읽는 키를 못 찾았다(이 변이표가 낡았다)");
  const key = keys.join("·");
  const before = runRuler(d);
  const wasClean = !/ops-tenant-note/.test(before.stdout);
  /* 서버 쪽 그 키들을 전부 딴 이름으로 — 화면은 그대로 보낸다 ⇒ «보내는데 안 읽는다»가 되어야 한다. */
  let mutated = srv;
  for (const k of keys) mutated = mutated.replace(new RegExp(`\\bb\\.${k}\\b`, "g"), `b.__${k}__`).replace(new RegExp(`\\b${k}\\?:`, "g"), `__${k}__?:`);
  writeFileSync(path.join(d, "netlify", "functions", "ops-tenants.ts"), mutated);
  const after = runRuler(d);
  const cried = /ops-tenant-note/.test(after.stdout);
  rec("① 🔴 **서버가 읽는 키를 딴 이름으로 바꾸면 운다**(고쳐진 뒤에도 도는 변이 · AC-112 ⑥)", wasClean && cried,
    `바꾸기 전 ${wasClean ? "깨끗" : "🔴 이미 빨강"} → 바꾼 뒤 ${cried ? "빨개졌다" : "🔴 조용하다"} (건드린 키 «${key}»)`);
  rmSync(d, { recursive: true, force: true });
} catch (e) { rec("① 서버 키를 바꾸면 운다", false, String(e.message).slice(0, 160)); }

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

/* ── ③ 주석을 코드로 세나 ──
   🔴 **제품 글자에 안 매이게 다시 짠다**(2026-09-19 · AC-112 ⑥).
   옆 판은 `ops-tenants.ts` 의 줄을 통째로 밖아 넣었는데, B 가 그 파일을 고치자 **닻을 잃고 빨개졌다.**
   ⇒ 이제는 **내가 지어 넣은 가짜 한 쌍**(화면 + 핸들러)에 변이를 넣는다 —
   제품이 어떻게 바뀜도 **이 변이는 영원히 돈다.** */
try {
  const d = freshRoot();
  const fnDir = path.join(d, "netlify", "functions");
  const pubDir = path.join(d, "public", "app");
  /* 가짜 핸들러 — `zzprobe` 를 **주석 안에서만** 읽는다. */
  writeFileSync(path.join(fnDir, "zz-probe.ts"), [
    'export const config = { path: ["/api/zz-probe"] };',
    "export default async (req: Request): Promise<Response> => {",
    "  const b = await readJson<{ id?: number }>(req);",
    "  /* 예전엔 const v = String(b.zzprobe ?? \"\"); 를 익었다 */",
    "  return new Response(JSON.stringify({ ok: true, id: b.id }));",
    "};",
  ].join(String.fromCharCode(10)));
  writeFileSync(path.join(pubDir, "zz-probe.html"),
    '<script>const r = await UI.api("/api/zz-probe", { body: { id: 1, zzprobe: "x" } });</script>');
  const r = runRuler(d);
  const cried = /zz-probe/.test(r.stdout);
  rec("③ 🔴 **주석 안의 키는 «읽는다»로 세지 않는다**(주석을 코드로 세면 이 병을 못 본다 · AC-109 ①)", cried,
    cried ? "지어 넣은 짝에서 «주석으로만 읽는 키»가 빨개졌다" : "🔴 주석을 코드로 세고 있다 — 이 자가 AC-109 의 병에 걸렸다");
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
