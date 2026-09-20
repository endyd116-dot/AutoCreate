/**
 * scripts/verify-regen-note-reaches.mjs — 🔴 **«다시 만들기»에 적은 한 마디가 모델 앞까지 가나** (B · 2026-09-21)
 *
 *   ══ 왜 ══
 *   계약은 `POST /api/pieces-regenerate { id, note? }` 다. 그런데 **세 겹이 다 죽어 있었다**:
 *     · 화면은 `{ id }` 만 보내고 · 생성기는 그 칸을 안 읽었다.
 *   🔴 **한 겹은 트리아지가 틀렸었다**(2026-09-21 · C 정정 `f9df8dee`): «서버가 `note` 를 **안 받는다**»고 넘어왔는데
 *      **서버는 처음부터 받고 있었다**(`pieces.ts:412`). C 의 자가 같은 이름 블록 둘 중 **첫 것만** 보고 있었던 것이다.
 *      내가 실제로 찾은 고장은 그게 아니라 — 🔴 **받아서 `meta.angle` 뒤에 몰래 붙여 보내고 있었고, 다시 만들 때마다 쌓였다.**
 *      ⇒ 여기 ①축이 «서버가 받나»를 재는 것은 **회귀 방지**이지 그날의 고장이 아니었다. 고장은 ②③이다.
 *   손님이 «이번엔 담백하게 써 주세요» 라고 적을 **자리조차** 없었고, 적었어도 **아무 데도 안 닿았다**.
 *
 *   🔴 이 자는 **세 겹을 따로 잰다.** 한 겹만 고치면 «초록인데 고장»이 된다 —
 *      서버가 읽어도 화면이 안 보내면 늘 비고, 화면이 보내도 생성기가 안 읽으면 그냥 버려진다.
 *
 *   🔴 **한 겹은 일부러 빨강이다**(2026-09-21): ④ 화면 보내기는 **A 몫**이다. 지우지 않고 빨간 채로 둔다 —
 *      «A 가 하면 넣자»가 잊히는 길이다(`docs/rules/pending-red.json` 에 등록).
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 서버가 `note` 를 받아 `meta.regenNote` 로 **저장**한다.
 *     ② 생성기가 그 칸을 **제 이름으로 읽어 프롬프트에 싣는다**(글·영상 둘 다).
 *     ③ 🔴 **앵글에 몰래 붙이지 않는다** — 앵글은 «이 글의 관점»이라는 다른 뜻이고, 그 방식은 **다시 만들 때마다 쌓였다**.
 *     ④ 🔴 **화면이 그 한 마디를 보낸다**(A 몫 · 지금 빨강).
 *     대조군 — 이웃 `pieces-reject { reason? }` 는 세 겹이 이어져 있다(이 모양이 정답이다).
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · 모델이 그 말을 **따르는지**는 안 본다(프롬프트에 실리는 데까지다 · `_smoke/regen-note-smoke.mts` 가 문자열로 잰다).
 *     · 화면에 **입력칸이 보이는지**도 안 본다(보내는 코드가 있나까지).
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-regen-note-reaches.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const noHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

const API = codeOnly(read("netlify/functions/pieces.ts"));
const TEXT = codeOnly(read("lib/content-gen.ts"));
const VIDEO_SCRIPT = codeOnly(read("lib/video/script.ts"));
const VIDEO_GEN = codeOnly(read("lib/video/gen.ts"));
const TPL = noHtmlComments(read("public/app/_tpl.txt"));

const out = [];
const rec = (step, ok, note) => { out.push({ ok, step }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«다시 만들기의 한 마디가 모델 앞까지 가나» · ${new Date().toISOString()}`);
console.log("■ 내가 세는 모수 — 세 겹(화면 보내기 · 서버 저장 · 생성기 읽기) × 두 길(글 · 영상)");
console.log("─".repeat(120));

/* ① 서버가 받아서 저장하나 */
{
  const reads = /const note = String\(b\.note \?\? ""\)/.test(API);
  const stores = (API.match(/regenNote:\s*note \|\| null/g) || []).length;
  rec("① 서버가 `note` 를 받아 `meta.regenNote` 로 저장한다", reads && stores >= 2,
    reads ? `받는다 · 저장하는 자리 ${stores}곳(글·영상)` : "🔴 `note` 를 아예 안 받는다");
}

/* ② 생성기가 제 이름으로 읽어 프롬프트에 싣나 */
{
  const textReads = /meta\.regenNote/.test(TEXT) && /regenNote\s*\}\)/.test(TEXT);
  /* 🔴 [변이 M2 가 고치게 했다] 첫 판은 `/a\.regenNote \?/` 였다 — 그런데 **`meta.regenNote ??` 안에 그 글자가 들어 있다**
     (met**a.regenNote ?**?). 그래서 프롬프트 줄을 통째로 들어내도 **안 울었다.** 앞 글자를 막는다(부분일치가 또 속인 자리). */
  const textPrompt = /(?:^|[^A-Za-z0-9_.])a[.]regenNote\s*\?[^?]/.test(TEXT);
  const videoReads = /meta\.regenNote/.test(VIDEO_GEN);
  const videoPrompt = /inp\.regenNote \?/.test(VIDEO_SCRIPT);
  const ok = textReads && textPrompt && videoReads && videoPrompt;
  rec("② 생성기가 그 칸을 **제 이름으로 읽어 프롬프트에 싣는다**(글·영상)", ok,
    ok ? "글: `meta.regenNote` → `buildPrompt({ regenNote })` → 프롬프트 한 줄 · 영상: `meta.regenNote` → `buildVideoScript({ regenNote })` → 프롬프트 한 줄"
      : `🔴 글 읽기=${textReads} 글 프롬프트=${textPrompt} · 영상 읽기=${videoReads} 영상 프롬프트=${videoPrompt}`);
}

/* ③ 앵글에 몰래 붙이지 않나 */
{
  const smuggle = [...API.matchAll(/angle:\s*note \?/g)];
  rec("③ 🔴 **앵글에 몰래 붙이지 않는다**(그 방식은 다시 만들 때마다 쌓였다)", smuggle.length === 0,
    smuggle.length ? `🔴 ${smuggle.length}곳이 앵글 뒤에 붙인다 — 세 번째 재생성이면 앞의 두 요청까지 앵글에 매달려 간다`
      : "앵글은 «이 글의 관점» 그대로 두고, 한 마디는 제 줄로 간다");
}

/**
 * ④ 🔴 **한 마디를 실을 수 있는 자리가 전부 싣나.**
 *
 *   🔴 [2026-09-21 메인이 손으로 밟아 고치게 했다] 첫 판은 «부르는 자리 전부»를 셌고 **거짓 빨강**이었다.
 *      `pieces-regenerate` 를 부르는 자리는 **뜻이 다른 둘**이다:
 *        · 목록의 «다시 시작» = **멈춘 글 복구**(무료 · 무제한 · `regenCount` 안 오름) — 20분 넘게 갇힌 글에만 단추가 뜬다
 *        · 상세의 «다시 만들기» = **다시 쓰기**(1회 · 손님이 고른 것)
 *      서버는 복구 갈래(`st === "generating"`)를 **`note` 를 읽기 전에 반환한다**(`pieces.ts:405`·`:407` → `:412`).
 *      ⇒ 거기에 입력칸을 만들면 **손님이 적은 걸 서버가 조용히 버린다** — 이 판 내내 잡던 그 고장을 새로 만드는 셈이다.
 *
 *   🔴 **손으로 «이 자리는 빼 준다»고 적지 않는다.** 그러면 서버가 그 갈래를 고쳐 `note` 를 읽게 되는 날에도 자가 계속 봐 준다.
 *      대신 **두 사실에서 파생**한다:
 *        ㉮ 서버가 그 갈래에서 `note` 를 **읽기 전에 반환하나**(읽게 바뀌면 ㉮가 거짓 → 그 자리도 **저절로 다시 센다**)
 *        ㉯ 그 호출이 **«멈춘 글» 안내에서 나온 단추**인가(`data-stuck` 과 같은 `return` 안에서 그려진다)
 *      둘 다 참일 때만 «실을 수 없는 자리»로 빼고, **이름과 까닭을 찍는다.**
 */
{
  /* ㉮ 서버: 복구 갈래가 `note` 읽기 **앞에서** 끝나나 */
  const handler = (API.match(/if \(path\.endsWith\("\/pieces-regenerate"\)\) \{[\s\S]*?\n    \}/g) || []).join("\n");
  const noteIdx = handler.indexOf("const note = String(b.note");
  const genIdx = handler.indexOf('if (st === "generating")');
  const genBlock = genIdx >= 0 && noteIdx > genIdx ? handler.slice(genIdx, noteIdx) : "";
  const serverDropsNoteOnRecovery = !!genBlock && /return json\(/.test(genBlock);

  /* ㉯ 화면: 그 호출이 «멈춘 글» 안내의 단추에서 나오나 */
  const calls = [...TPL.matchAll(/UI\.api\("\/api\/pieces-regenerate",\s*\{\s*body(?::\s*\{([^}]*)\}|\s*\})/g)]
    .map((m) => ({ body: (m[1] ?? "").trim(), at: m.index }));
  const fromStuckBanner = (bodyText) => {
    const attr = (bodyText.match(/dataset\.([A-Za-z0-9_]+)/) || [])[1];
    if (!attr) return false;
    const render = TPL.indexOf(`data-${attr}="`);
    if (render < 0) return false;
    const start = TPL.lastIndexOf("return ", render);          // 그 단추를 그리는 한 문장
    const span = start >= 0 ? TPL.slice(start, render) : "";
    return /data-stuck|stuckMin\(/.test(span);
  };

  const skipped = [], counted = [];
  for (const c of calls) {
    /* `{ body }` 처럼 변수로 넘기는 자리는 **그 변수를 만드는 줄**에서 note 를 보는지 본다. */
    const sendsNote = c.body ? /\bnote\b/.test(c.body) : /body\.note\s*=/.test(TPL.slice(Math.max(0, c.at - 400), c.at));
    if (serverDropsNoteOnRecovery && fromStuckBanner(c.body)) skipped.push(c);
    else counted.push({ ...c, sendsNote });
  }
  const missing = counted.filter((c) => !c.sendsNote);
  const say = (c) => `«${(c.body || "body 변수").slice(0, 40)}»`;
  rec("④ 🔴 **한 마디를 실을 수 있는 자리가 전부 싣는다**", counted.length > 0 && missing.length === 0,
    !calls.length ? "🔴 화면이 `pieces-regenerate` 를 부르는 자리를 못 찾았다 — 이 자를 고쳐라(조용히 통과시키지 않는다)"
      : !counted.length ? "🔴 셀 자리가 하나도 안 남았다 — 파생 규칙이 너무 넓다(이 자를 고쳐라)"
        : missing.length ? `🔴 실을 수 있는데 안 싣는 자리 ${missing.length}곳: ${missing.map(say).join(" · ")}`
          : `실을 수 있는 ${counted.length}곳이 전부 싣는다` + (skipped.length ? ` · 세지 않은 ${skipped.length}곳: ${skipped.map(say).join(",")} = **멈춘 글 복구**(서버가 \`pieces.ts\` 의 \`generating\` 갈래에서 note 를 읽기 전에 반환한다 — 실을 수 없다)` : ""));
  if (!serverDropsNoteOnRecovery) console.log("       └ 🔴 서버가 복구 갈래에서도 `note` 를 읽게 바뀌었다 — **그 자리도 이제 센다**(자가 저절로 따라갔다).");
}

/* 대조군 — 이웃 `pieces-reject { reason }` 는 세 겹이 이어져 있다 */
{
  const srv = /rejectReason:\s*reason \|\| null/.test(API);
  const screen = /pieces-reject/.test(TPL) && /reason/.test(TPL);
  rec("대조군 — 이웃 «버리기»는 세 겹이 이어져 있다(이 모양이 정답이다)", srv && screen,
    srv && screen ? "`pieces-reject { reason? }` 는 받아서 저장하고 슬롯 note 로 **보여 주기까지** 간다"
      : `🔴 대조군이 무너졌다 — 서버=${srv} 화면=${screen}`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok);
console.log(bad.length ? `🔴 FAIL ${bad.length} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
if (bad.length && bad.every((x) => x.step.startsWith("④"))) {
  console.log("⏳ 남은 빨강은 **④ 화면 보내기 하나**다 — A 몫으로 `docs/rules/pending-red.json` 에 등록돼 있다(고장이 아니라 할 일).");
}
process.exit(bad.length ? 1 : 0);
