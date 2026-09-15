/**
 * scripts/verify-r9-blocks-to-ops.mts — 🔴 **우리 블록 전종이 러너 op 로 내려가거나 «못 냈어요»로 적히나**(C · R9-5/6 · 2026-09-16 · 순수 · IO 0).
 *   사용: npx --yes tsx scripts/verify-r9-blocks-to-ops.mts
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   B2 는 자기가 고친 블록을 지킨다. 이 자는 **블록 어휘를 `lib/blocks.ts` 의 타입 줄에서 읽어**(손으로 들지 않는다 · AC-82)
 *   **전종**을 하나씩 러너 `planEditorOps` 에 넣고 부등호 하나만 본다 — 🔴 **op 0개이면서 note 0개인 타입 = 0**(조용히 사라지는 블록 0 · AC-9).
 *   두 경로(블록 정본 · bodyHtml 폴백) 모두 잰다 — 검수창에서 본문을 고친 글은 폴백으로 간다.
 *
 *   그리고 채널별 꾸밈(R9-1/4): 서버 렌더가 **못 내는 채널**에 서식을 밀어 넣지 않나 · 채널 표가 «모르면 null» 로 전 채널에 있나.
 *   `formatUnused`(R9-5)의 field 어휘가 화면(A)이 그리는 닫힌 목록과 같나.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { out.push({ step, ok, note }); return ok; };

/* ═══ 블록 어휘를 타입 줄에서 읽는다 ═══ */
const blocksSrc = readFileSync(join(ROOT, "lib", "blocks.ts"), "utf8");
const typeLine = /export type BlockType\s*=\s*([^;]+);/.exec(blocksSrc)?.[1] ?? "";
const TYPES = [...typeLine.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);

/** 타입마다 «채워진» 대표 블록 하나 — 빈 블록은 원래 아무것도 안 내는 게 맞다(그건 조용한 삭제가 아니다). */
function sample(type: string): Record<string, unknown> {
  const text = `${type} 블록의 본문입니다. 러너가 이걸 어디에 넣나 봅니다.`;
  switch (type) {
    case "list": case "checklist": case "toc": case "tip": case "summary": return { type, text: type === "tip" || type === "summary" ? text : undefined, items: ["첫째 항목", "둘째 항목"] };
    case "faq": return { type, items: ["Q. 효과가 바로 나오나요? | A. 두 달째부터 체감됐어요."] };
    case "table": return { type, rows: [["항목", "값"], ["전기", "1만 원"]] };
    case "image": return { type, imageIndex: 0, caption: "캡션 한 줄" };
    case "hashtags": return { type, items: ["전기요금", "절약"] };
    case "affiliate": return { type, text, affiliate: { productName: "멀티탭", url: "https://link.coupang.com/x" } };
    case "place": return { type, place: { name: "한전 고객센터", url: "https://map.naver.com/x", address: "서울" } };
    case "divider": case "adsense": return { type };
    default: return { type, text };
  }
}

(async () => {
  rec("⓪ 블록 어휘를 lib/blocks.ts 타입 줄에서 읽었다", TYPES.length >= 18, `${TYPES.length}종: ${TYPES.join(" ")}`);

  const planMod = await import(pathToFileURL(join(ROOT, "runner", "lib", "plan.mjs")).href);
  const blocksMod = await import(pathToFileURL(join(ROOT, "lib", "blocks.ts")).href);
  const images = [{ url: "https://example.invalid/1.png", caption: "" }];

  /* ① 블록 정본 경로 */
  {
    const silent: string[] = [], noted: string[] = [];
    for (const t of TYPES) {
      const plan = planMod.planEditorOps({ blocks: [sample(t)], images, tags: [] });
      const real = plan.ops.filter((o: { op: string }) => o.op !== "note" && o.op !== "tags");
      /* «못 냈어요»는 두 그릇 중 어디에 적혀도 된다 — 보고용 `stats.notes` · 화면용 `stats.demoted[{kind,why}]`(B2 R9-5). */
      const notes = ([...(plan.stats?.notes ?? []), ...((plan.stats?.demoted ?? []) as { kind: string; why: string }[]).map((d) => `${d.kind}:${d.why}`)]) as string[];
      if (!real.length && !notes.length && !(t === "hashtags" && plan.tags?.length)) silent.push(t);
      if (!real.length && notes.length) noted.push(`${t}(«${notes[0].slice(0, 24)}»)`);
    }
    rec("① 🔴 블록 정본 경로 — op 도 note 도 없이 사라지는 타입 0(조용한 삭제 0 · AC-9)", silent.length === 0,
      silent.length ? `🔴 조용히 사라짐: ${silent.join(", ")}` : `전종 op 또는 note · «못 냈어요»로 적힌 것: ${noted.join(", ") || "없음"}`);
  }
  /* ② bodyHtml 폴백 경로 — 검수창에서 고친 글은 이 길로 간다 */
  {
    const silent: string[] = [];
    for (const t of TYPES) {
      const html = blocksMod.renderBlocksHtml([sample(t)], "naver_blog", images);
      if (!html.trim()) continue;   // 서버가 아무것도 안 그린 타입은 폴백에 넣을 것이 없다
      const plan = planMod.planEditorOps({ blocks: [], bodyHtml: html, images, tags: [] });
      const real = plan.ops.filter((o: { op: string }) => o.op !== "note" && o.op !== "tags");
      const notes = ([...(plan.stats?.notes ?? []), ...((plan.stats?.demoted ?? []) as { kind: string; why: string }[]).map((d) => `${d.kind}:${d.why}`)]) as string[];
      if (!real.length && !notes.length && !(t === "hashtags" && plan.tags?.length)) silent.push(`${t}[${html.slice(0, 30).replace(/\s+/g, " ")}…]`);
    }
    rec("② 🔴 bodyHtml 폴백 경로 — 서버가 그린 HTML 이 러너에서 op·note 없이 사라지는 타입 0", silent.length === 0,
      silent.length ? `🔴 사라짐: ${silent.join(" · ")}` : "전종 op 또는 note");
  }

  /* ③ 채널 꾸밈 표(R9-4) — 전 채널에 칸이 있고(모르면 null) 값은 boolean 만 */
  {
    const reg = await import(pathToFileURL(join(ROOT, "lib", "channel-registry.ts")).href);
    const CH = reg.CHANNELS as Record<string, unknown>[];
    const key = ["formatCaps", "formatting", "format", "marks", "decor", "inlineCaps"].find((k) => CH.some((c) => k in c));
    if (!key) rec("③ 채널 꾸밈 표(R9-4)가 channel-registry 에 있다", false, "🔴 어느 채널에도 꾸밈 칸이 없다 — R9-4 미착(열림)");
    else {
      const missing = CH.filter((c) => !(key in c)).map((c) => c.key);
      /* B 의 모양: FormatCaps = Record<key, boolean|null> · 표 자체가 null 이면 «채널을 모른다» */
      const badVal = CH.filter((c) => c[key] !== null && (typeof c[key] !== "object" || Object.values(c[key] as object).some((v) => typeof v !== "boolean" && v !== null))).map((c) => c.key);
      rec(`③ 채널 꾸밈 표 «${key}» — 전 채널에 칸이 있다(모르면 null · 값은 boolean|null 만)`, missing.length === 0 && badVal.length === 0,
        `${missing.length ? `🔴 칸 없음: ${missing.join(",")} ` : ""}${badVal.length ? `🔴 boolean 아님: ${badVal.join(",")}` : ""}${!missing.length && !badVal.length ? `${CH.length}채널 전부 · null=${CH.filter((c) => c[key] === null).length}` : ""}`);
      /* 🔴 쓰레드·당근처럼 «글자뿐»인 채널은 밑줄·형광펜이 true 면 안 된다(추측으로 켠 것) */
      const textOnly = CH.filter((c) => ["threads", "daangn", "x", "instagram"].includes(String(c.key)) && c[key] && typeof c[key] === "object");
      const pushed = textOnly.filter((c) => { const f = c[key] as Record<string, boolean | null>; return f.underline === true || f.line === true || f.highlight === true || f.color === true; }).map((c) => c.key);
      rec("③ 글자뿐인 채널(쓰레드·인스타·X)에 밑줄·형광펜·색을 «된다»로 적지 않았다", pushed.length === 0, pushed.length ? `🔴 ${pushed.join(",")}` : `본 채널: ${textOnly.map((c) => c.key).join(",") || "(표에 없음)"}`);
    }
  }

  /* ④ 서버 렌더가 «못 내는 채널»에 서식을 밀어 넣지 않나(R9-1 × R9-4) */
  {
    /* B 어휘(R9-1): `block.marks[{kind:"value|line|row|bold|underline|italic", s, e}]` — 원문 인덱스. HTML 태그를 본문에 넣는 것이 아니다. */
    const text = "여기 밑줄 한 토막 과 형광펜 문장 하나 와 핵심값 12,400원 이 있어요 ✅";
    const at = (sub: string) => ({ s: text.indexOf(sub), e: text.indexOf(sub) + sub.length });
    const marked = [{ type: "para", text, marks: [{ kind: "underline", ...at("밑줄 한 토막") }, { kind: "line", ...at("형광펜 문장 하나") }, { kind: "value", ...at("12,400원") }] }];
    const naver = blocksMod.renderBlocksHtml(marked as never, "naver_blog", []);
    const threads = blocksMod.renderBlocksHtml(marked as never, "threads", []);
    const naverHas = /<u\b|<mark\b/.test(naver);
    const threadsHas = /<u\b|<mark\b|<strong\b/.test(threads);
    rec("④ 네이버 렌더에 밑줄·형광펜이 실린다(R9-1 인라인 꾸밈 · marks 어휘)", naverHas, naverHas ? naver.slice(0, 140) : `🔴 <u>·<mark> 가 안 실린다 — ${naver.slice(0, 120)}`);
    rec("④ 쓰레드(글자뿐) 렌더에는 밑줄·형광펜·굵게 태그를 밀어 넣지 않는다(못 내는 채널 · formatCaps false)", !threadsHas, threadsHas ? `🔴 쓰레드에 태그가 간다 — ${threads.slice(0, 120)}` : "없다(글자만)");
    /* 🔴 벗긴 마크가 «못 냈어요»로 남나 — 렌더가 태그만 벗기고 조용하면 화면은 «다 나갔다»고 믿는다(AC-9) */
    const unusedFn = (blocksMod as Record<string, unknown>).renderBlocksHtmlWithUnused ?? (blocksMod as Record<string, unknown>).marksDroppedFor ?? null;
    if (typeof unusedFn !== "function") {
      const fm = existsSync(join(ROOT, "lib", "format-marks.ts")) ? readFileSync(join(ROOT, "lib", "format-marks.ts"), "utf8") : "";
      rec("④ 채널이 못 내서 벗긴 마크가 formatMarks.demoted 로 적힌다(렌더가 조용히 벗기지 않는다)", /channel_unsupported|caps?_false|formatCaps/.test(fm), fm ? "format-marks.ts 가 channel_unsupported 를 적는다(정적 확인 · 호출 사슬은 deadends 몫)" : "🔴 format-marks.ts 없음");
    }
  }

  /* ⑤ formatUnused(R9-5) — 서버가 내는 field 어휘 ⊆ 화면(A)이 사람말로 그리는 닫힌 목록 */
  {
    const libFiles = walk(join(ROOT, "lib")).concat(walk(join(ROOT, "netlify", "functions")));
    const producers = libFiles.filter((p) => /formatUnused/.test(readFileSync(p, "utf8")));
    if (!producers.length) rec("⑤ meta.formatUnused 를 만드는 서버 코드가 있다(R9-5)", false, "🔴 없음 — 열림");
    else {
      const tpl = join(ROOT, "public", "app", "_tpl.txt");
      const tplSrc = existsSync(tpl) ? readFileSync(tpl, "utf8") : "";
      const uiSrc = existsSync(join(ROOT, "public", "js", "ui.js")) ? readFileSync(join(ROOT, "public", "js", "ui.js"), "utf8") : "";
      /* 서버 어휘 = `lib/format-marks.ts FIELD_LABEL` 의 열쇠(B) · 서버가 `label` 을 실어 보내므로 화면은 **label 을 그대로 그려야** 한다(AC-52).
         A 가 화면 상수 FMT_FIELD_SAY 를 들고 있으면 두 벌이다 — 있으면 서버 열쇠와 대조하고, 없으면 «서버 label 을 쓴다»로 본다. */
      let serverFields = new Set<string>();
      try { const fm = await import(pathToFileURL(join(ROOT, "lib", "format-marks.ts")).href); serverFields = new Set(Object.keys(fm.FIELD_LABEL ?? {})); } catch { /* 아래 빨강 */ }
      const sayBlock = /FMT_FIELD_SAY\s*=\s*\{([^}]*)\}/.exec(tplSrc + uiSrc)?.[1] ?? "";
      const screenFields = new Set([...sayBlock.matchAll(/([a-z0-9_]+)\s*:/g)].map((m) => m[1]));
      const unknown = [...serverFields].filter((f) => !screenFields.has(f));
      const usesServerLabel = /formatUnused[^\n]*\.label|\.label\b[^\n]*formatUnused|fmtunused[\s\S]{0,400}\.label/.test(tplSrc + uiSrc);
      rec("⑤ formatUnused.field 어휘 — 서버 FIELD_LABEL 열쇠가 있고, 화면은 서버 label 을 그리거나(AC-52) 자기 표가 서버 열쇠를 전부 덮는다", serverFields.size > 0 && (usesServerLabel || (screenFields.size > 0 && unknown.length === 0)),
        `서버 열쇠 ${serverFields.size}개(${[...serverFields].slice(0, 6).join(",")}…) · 화면: ${usesServerLabel ? "서버 label 사용" : screenFields.size ? `자기 표 ${screenFields.size}개${unknown.length ? ` · 🔴 빠짐: ${unknown.join(",")}` : ""}` : "🔴 아직 없음(A 미착)"}`);
      rec("⑤ formatUnused 를 읽는 화면이 있다(#fmtunused · AC-69 «정의가 아니라 부르나»)", /fmtunused|formatUnused/.test(tplSrc + uiSrc), /fmtunused|formatUnused/.test(tplSrc + uiSrc) ? "있다" : "🔴 화면 0곳(A 미착)");
    }
  }

  /* ⑥ 티스토리 폴백 «깎였다» 규칙(B2 `degradedFieldOf` · 순수) — 행동으로 잰다(«줄이 있나»가 아니라).
     🔴 대조군 둘: para 는 원래 평문이라 null · image 는 폴백에서도 진짜로 들어가니 null. 그리고 formatMarks 는 깎인 게 없으면 아예 안 보낸다(정적). */
  {
    const tPath = join(ROOT, "runner", "channels", "tistory.mjs");
    let fn: ((op: Record<string, unknown>) => string | null) | null = null;
    try { const t = await import(pathToFileURL(tPath).href); fn = typeof t.degradedFieldOf === "function" ? t.degradedFieldOf : null; } catch (e) { rec("⑥ tistory.mjs 를 playwright 없이 불러온다", false, String((e as Error).message).slice(0, 100)); }
    if (!fn) rec("⑥ tistory.mjs 가 degradedFieldOf 를 export 한다(티스토리 폴백 «깎였다» 규칙)", false, "🔴 없음 — 티스토리 폴백의 «못 냈어요»는 meta 에 안 닿는다(R9-5 열림)");
    else {
      const GRID: [Record<string, unknown>, string | null][] = [
        [{ op: "quote" }, "quote"], [{ op: "divider" }, "divider"], [{ op: "heading", level: 2 }, "h2"], [{ op: "heading", level: 3 }, "h3"],
        [{ op: "list" }, "list"], [{ op: "check" }, "checklist"], [{ op: "faq" }, "faq"], [{ op: "link" }, "affiliate"],
        [{ op: "para" }, null], [{ op: "image" }, null], [{ op: "note" }, null], [{ op: "tags" }, null], [{ op: "zzz" }, null], [{} as Record<string, unknown>, null],
      ];
      const bad = GRID.filter(([op, want]) => { try { return fn!(op) !== want; } catch { return true; } }).map(([op, want]) => `${JSON.stringify(op)}→${String(want)} 이어야`);
      const blockVocab = new Set(TYPES);
      const outOfVocab = GRID.map(([op]) => { try { return fn!(op); } catch { return null; } }).filter((v): v is string => !!v && !blockVocab.has(v));
      rec(`⑥ 티스토리 폴백 «깎였다» 규칙 — ${GRID.length}op 격자(quote·divider·h2/h3·list·checklist·faq·affiliate 는 블록 이름 · para·image·note·tags·모르는 op 는 null)`, bad.length === 0 && outOfVocab.length === 0,
        bad.length ? `🔴 ${bad.slice(0, 4).join(" · ")}` : outOfVocab.length ? `🔴 블록 어휘 밖 이름: ${outOfVocab.join(",")}` : "전부 일치 · 이름은 전부 BlockType 어휘");
      const src = readFileSync(tPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      rec("⑥ 티스토리는 깎인 게 없으면 formatMarks 를 안 보낸다(안 깎였는데 칩이 뜨면 더 나쁜 거짓말) · 깎였으면 demoted 로 보낸다", /formatMarks/.test(src) && /demoted/.test(src) && /no_editor_op/.test(src) && /degraded\.length|demoted\.length|\.length\s*\?/.test(src),
        /formatMarks/.test(src) ? "formatMarks·demoted·no_editor_op·길이 분기 있음(정적)" : "🔴 formatMarks 를 안 보낸다");
    }
  }

  const w = (x: unknown, n: number) => String(x).padEnd(n);
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\n블록 → 러너 op · 채널 꾸밈 표 · «못 냈어요» · ${new Date().toISOString()}\n${"─".repeat(126)}`);
  for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 86)} ${r.note}`);
  console.log(`${"─".repeat(126)}`);
  console.log(fail ? `🔴 실패 ${fail}개` : `✅ ${out.length}축 통과`);
  process.exit(fail ? 1 : 0);
})();

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(ts|mts)$/.test(f)) acc.push(p);
  }
  return acc;
}
