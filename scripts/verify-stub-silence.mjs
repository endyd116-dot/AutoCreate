/**
 * scripts/verify-stub-silence.mjs — 🔴 **«가짜를 돌려줬으면 반드시 말해야 한다»**(C · 수리 라운드 2026-09-19 · AC-111 을 자로).
 *   사용: node scripts/verify-stub-silence.mjs
 *         node scripts/verify-stub-silence.mjs --list   (찾은 스텁 자리를 전부 찍는다)
 *
 *   ══ 왜 이 자가 있나 — AC-111 ══
 *   2026-09-19 전 구간 리허설에서, 사장님이 승인한 «쇼츠 **대본** 실호출»을 하려고 `AI_STUB` 을 껐는데
 *   **`ai_usage` 에 `video_script` 행이 안 남았다.** 파 보니 `lib/video/script.ts:115` 가 첫 줄에서
 *   `if (videoStub()) { const s = stubScript(inp); return { ok:true, ...s, model:"stub" }; }` 로
 *   **대본을 통째로 템플릿으로 바꿔치기**하고 있었다. `VIDEO_PROVIDER_STUB` 은 이름도 문서도
 *   «Veo 컷·TTS»(건당 수 달러)를 끄는 손잡이인데 **$0.033짜리 대본까지** 가져간 것이다.
 *
 *   🔴 **제일 나쁜 것은 «조용하다»는 것이었다.** `lib/ai.ts:252` 는 스텁을 탈 때마다
 *   `[ai-stub] video_script — 고정 응답(실호출 0 · 원가 0)` 을 **반드시 찍는다.**
 *   그런데 `script.ts:115` 는 **한 줄도 안 찍고** `model:"stub"` 을 **반환값 안에만** 넣는다 —
 *   그 값을 아무도 안 읽으면 «스텁이었다»는 사실이 **세상 어디에도 안 남는다.**
 *   ⇒ 그 위에서 도는 검사는 **템플릿을 보고 초록**을 낸다. 이게 «초록인데 고장»의 제일 조용한 얼굴이다.
 *
 *   ══ 무엇을 재는가 ══
 *   `lib/**` 에서 **스텁 손잡이**(`aiStubActive()`·`aiStubImagesActive()`·`videoStub()`)가 지키는 자리를 **폴더째** 찾아,
 *   그 자리가 **가짜를 만들어 돌려주면**(스텁 공장 호출 또는 `model:"stub"` 반환) —
 *   🔴 **그 사실이 프로세스 밖에서 보여야 한다.** 받아들이는 통로는 둘뿐이다:
 *     ① `console.*` 로 찍는다(`lib/ai.ts` 관례) · ② `recordAiUsage(… model:"stub" …)` 로 **DB 에 자국**을 남긴다.
 *   둘 다 없으면 빨강. **값으로만 말하는 것은 «말했다»가 아니다.**
 *
 *   ══ 🔴 손 목록이 없다(AC-108) ══
 *   손잡이 이름 셋만 알고, 자리는 폴더에서 찾는다. 새 스텁이 생기면 **자동으로 재는 대상이 된다.**
 *   🔴 **주석은 걷고 센다**(AC-109 ①) — 주석 속 `console.log` 를 «찍는다»로 세면 이 자가 그 병에 걸린다.
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · «찍는다»가 **정말 눈에 띄나**는 안 본다(로그 수준·문구). 찍기만 하면 통과다.
 *   · 손잡이가 **갈래만 고르는** 자리(`const ttsProvider = videoStub() ? "stub" : …`)는 «가짜를 돌려주는 자리»가
 *     아니라 안 센다 — 진짜 가짜는 그 갈래 끝(`lib/video/tts.ts`)에 있고 거기는 잰다.
 *   · `runner/**` 는 안 본다(고객 PC 에서 도는 판 · 그쪽 스텁은 B2 몫).
 *
 *   종료코드: 0 = 전부 말한다 · 1 = 조용한 스텁이 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.STUB_SILENCE_ROOT ? path.resolve(process.env.STUB_SILENCE_ROOT) : path.resolve(import.meta.dirname, "..");
const LIB = path.join(ROOT, "lib");
const LIST = process.argv.includes("--list");
if (!existsSync(LIB)) { console.error("⊘ 못 쟀어요 — lib/ 이 없습니다."); process.exit(2); }

/** 스텁 손잡이 — 🔴 이름 셋만 안다. 자리는 폴더에서 찾는다. */
const SWITCHES = ["aiStubActive", "aiStubImagesActive", "videoStub"];
/** 손잡이를 **정의하는** 파일은 재지 않는다(자기 자신을 세면 늘 빨갛다). */
const DEFINERS = new Set(["lib/ai-stub.ts", "lib/video/types.ts"]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

/** 손잡이가 지키는 «결과» 구간을 잘라 온다 — `if (SW()) { … }` 면 중괄호 균형, 아니면 그 문장 끝까지. */
function consequenceAt(src, idx) {
  const after = src.indexOf(")", idx);           // 손잡이 호출의 닫는 괄호
  if (after < 0) return src.slice(idx, idx + 200);
  /* `if (SW())` 의 바깥 `)` 를 찾는다 — `if (` 부터 균형을 센다. */
  const ifAt = src.lastIndexOf("if", idx);
  let start = after + 1;
  if (ifAt >= 0 && idx - ifAt < 40) {
    const open = src.indexOf("(", ifAt);
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") d++;
      else if (src[i] === ")") { d--; if (!d) { start = i + 1; break; } }
    }
  }
  const brace = src.indexOf("{", start);
  const semi = src.indexOf(";", start);
  const nl = src.indexOf("\n", start);
  if (brace >= 0 && (brace < semi || semi < 0) && (nl < 0 || brace < nl + 2)) {
    let d = 0;
    for (let i = brace; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) return src.slice(start, i + 1); }
    }
  }
  return src.slice(start, semi > 0 ? semi + 1 : (nl > 0 ? nl : start + 200));
}

/** 이 구간이 **가짜를 만들어 돌려주는** 자리인가. */
const FAKE_FACTORY = /\b(?:stub[A-Z]\w*|aiStub[A-Z]\w*)\s*\(/;       // stubScript( · stubRaw( · aiStubAnswer( · aiStubImage(
const FAKE_MODEL = /model\s*:\s*(?:["'`]stub["'`]|AI_STUB_MODEL)/;    // model: "stub"
const isFake = (c) => FAKE_FACTORY.test(c) || FAKE_MODEL.test(c);
/** «말해 주는 자리» — 찍거나(console) DB 에 자국을 남기거나(recordAiUsage). 둘 다 없으면 조용한 것이다. */
const TELLS_LOG = /\bconsole\.\w+\s*\(/;
const TELLS_DB = /\brecordAiUsage\s*\(/;

/** 🔴 **글자만 받아서 재는 함수** — 파일에서 떼어 둔다. 그래야 ⓪ 가 **글자를 망가뜨려** 즉석에서 변이를 넣을 수 있다
    (진짜 소스는 한 글자도 안 고친다 · AC-34). 본 판정도 ⓪ 도 **이 한 함수**를 쓴다 — 잣대는 한 곳이다(AC-109 ㉱). */
function scanSource(relPath, raw) {
  const src = codeOnly(raw);                    // 🔴 주석을 걷는다(AC-109 ①)
  const found = [];
  for (const sw of SWITCHES) {
    for (const m of src.matchAll(new RegExp(`\\b${sw}\\s*\\(\\s*\\)`, "g"))) {
      const c = consequenceAt(src, m.index);
      found.push({
        file: relPath, line: lineOf(src, m.index), sw,
        fake: isFake(c), log: TELLS_LOG.test(c), db: TELLS_DB.test(c),
        snip: c.replace(/\s+/g, " ").trim().slice(0, 90),
      });
    }
  }
  return found;
}

const sites = [];
for (const f of walk(LIB)) {
  if (DEFINERS.has(rel(f))) continue;
  sites.push(...scanSource(rel(f), readFileSync(f, "utf8")));
}

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«가짜를 돌려줬으면 반드시 말해야 한다» — 조용한 스텁 찾기(AC-111) · ${new Date().toISOString()}`);
console.log(`스텁 손잡이 ${SWITCHES.join(" · ")} 가 지키는 자리 ${sites.length}곳(폴더에서 스스로 찾았다 · 손 목록 0)`);
console.log("─".repeat(120));
if (LIST) for (const s of sites) console.log(`  ${s.fake ? "가짜" : "갈래"}  ${s.file}:${s.line}  ${s.sw}  log=${s.log ? "O" : "-"} db=${s.db ? "O" : "-"}  ${s.snip}`);

const fakes = sites.filter((s) => s.fake);
const silent = fakes.filter((s) => !s.log && !s.db);

rec("🔴 가짜를 돌려주는 스텁은 **말한다**(찍거나 `ai_usage` 에 자국을 남긴다)", silent.length === 0,
  silent.length ? `조용한 스텁 ${silent.length}곳 / 가짜를 돌려주는 자리 ${fakes.length}곳` : `가짜를 돌려주는 자리 ${fakes.length}곳 전부 말한다`);
for (const s of silent) {
  console.log(`   🔴 ${s.file}:${s.line}  (${s.sw})`);
  console.log(`      ${s.snip}`);
  console.log(`      ⇒ 값으로만 «model:"stub"» 이라 말한다. 아무도 그 값을 안 읽으면 **스텁이었다는 사실이 어디에도 안 남는다.**`);
}

/* ═══ ⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «우는가»다(AC-108) ═══
   진짜 소스는 안 건드린다 — **글자를 받아 재는 `scanSource`** 에 망가뜨린 글자를 먹여 본다. */
{
  const scriptSrc = readFileSync(path.join(LIB, "video", "script.ts"), "utf8");
  const aiSrc = readFileSync(path.join(LIB, "ai.ts"), "utf8");

  /* ⓪a **고치면 빨강이 사라진다** — 조용한 자리에 `console.info` 한 줄을 넣어 본다. */
  const fixed = scriptSrc.replace(
    "if (videoStub()) { const s = stubScript(inp); return { ok: true, ...s, model: \"stub\" }; }",
    "if (videoStub()) { console.info(\"[video-stub] script\"); const s = stubScript(inp); return { ok: true, ...s, model: \"stub\" }; }");
  const fixedSilent = scanSource("lib/video/script.ts", fixed).filter((s) => s.fake && !s.log && !s.db);
  rec("⓪a 자기 찌르기 — **한 줄 찍어 주면 그 빨강이 사라진다**(늘 빨간 자가 아니다)",
    fixed !== scriptSrc && fixedSilent.length === 0,
    fixed === scriptSrc ? "🔴 닻을 못 찾았다 — 이 변이표가 낡았다" : `고친 뒤 조용한 자리 ${fixedSilent.length}곳`);

  /* ⓪b **말하는 자리의 입을 막으면 운다** — `lib/ai-image.ts` 의 한 줄뿐인 `console.info` 를 지워 본다.
     🔴 처음엔 `lib/ai.ts` 를 골랐다가 실패했다 — 그 블록엔 `console.info` **와** `console.warn` **둘**이 있어서
     하나만 지워도 여전히 «말한다»였다. **자가 옳았고 내 변이가 덜 된 것이다.** ⇒ 로그가 하나뿐인 자리로 바꿨다. */
  const imgSrc = readFileSync(path.join(LIB, "ai-image.ts"), "utf8");
  const muted = imgSrc.replace(/console\.info\("\[ai-stub\] image[^"]*"\);/, "");
  const mutedSilent = scanSource("lib/ai-image.ts", muted).filter((s) => s.fake && !s.log && !s.db);
  rec("⓪b 자기 찌르기 — **말하던 자리의 입을 막으면 운다**(새 조용한 스텁을 본다)",
    muted !== imgSrc && mutedSilent.length > 0,
    muted === imgSrc ? "🔴 닻을 못 찾았다 — 이 변이표가 낡았다" : `입을 막으니 조용한 자리 ${mutedSilent.length}곳이 됐다`);
  void aiSrc;

  /* ⓪c 🔴 **주석 속 `console.log` 를 «찍는다»로 세지 않는다**(AC-109 ① — 이 자가 그 병에 안 걸렸나). */
  const commented = scriptSrc.replace(
    "if (videoStub()) { const s = stubScript(inp); return { ok: true, ...s, model: \"stub\" }; }",
    "if (videoStub()) { /* 옛날엔 console.info(\"[video-stub] script\") 를 찍었다 */ const s = stubScript(inp); return { ok: true, ...s, model: \"stub\" }; }");
  const commentedSilent = scanSource("lib/video/script.ts", commented).filter((s) => s.fake && !s.log && !s.db);
  rec("⓪c 자기 찌르기 — **주석 속 `console.log` 는 «찍는다»로 안 센다**(AC-109 ①)",
    commented !== scriptSrc && commentedSilent.length > 0,
    commented === scriptSrc ? "🔴 닻을 못 찾았다" : `주석만 남기니 여전히 조용하다(${commentedSilent.length}곳) — 주석을 코드로 세지 않는다`);
}

/* 🔴 대조군 — «말하는 스텁»이 실제로 있어야 이 자가 «둘을 가른다»는 뜻이다.
   전부 조용하거나 전부 말하면, 이 자는 그냥 한쪽으로만 기울어 있는 것이고 가른 적이 없다. */
const loud = fakes.filter((s) => s.log || s.db);
rec("대조군 — **말하는 스텁**도 실제로 있다(이 자가 둘을 가른다)", loud.length > 0,
  loud.length ? `말하는 자리 ${loud.length}곳 (예: ${loud.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(", ")})` : "🔴 하나도 없다 — 이 자는 가른 적이 없다");
rec("갈래만 고르는 자리는 빨강으로 세지 않는다(거짓 빨강 방지)", true,
  `갈래 ${sites.length - fakes.length}곳은 «가짜를 돌려주는 자리»가 아니라 뺐다`);

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 스텁 자리 ${sites.length}곳(가짜 ${fakes.length} · 갈래 ${sites.length - fakes.length})`);
console.log("🔴 이 자는 «말하나»만 잰다 — 그 말이 **눈에 띄나**(문구·수준)는 안 본다(머리말 «아직 못 하는 것»).\n");
process.exit(fails.length ? 1 : 0);
