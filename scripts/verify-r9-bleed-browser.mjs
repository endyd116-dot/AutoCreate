/**
 * scripts/verify-r9-bleed-browser.mjs — 🔴 **«번짐»을 진짜 Chromium 에서 잰다**(C · R9 · 2026-09-16 · 네이버 접속 0 · 라이브 0).
 *   사용: node scripts/verify-r9-bleed-browser.mjs [--mutate=break|dirty|measure] [--headed] [--keep]
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   AM 하니스(`verify-runner-format.mjs`)와 B2 의 `scripts/verify-runner-format.mjs` 는 **소스 글자**(«끊는 줄이 있나»)와
 *   **jsdom 위의 측정 함수**를 잰다. 그 자는 «방어 코드가 있나»를 지키지만 **contenteditable 이 실제로 번지는지**는 못 본다.
 *   여기서는 ①**진짜 Chromium** 을 띄우고 ②**가짜 스마트에디터**(contenteditable · se-* 클래스 · 툴바 · «본문 추가» 버튼)에
 *   ③러너의 **`playOps` 그 함수**를 그대로 연주시킨 뒤 ④**문단마다 «계획이 안 시킨 서식이 붙었나»를 DOM 과 대조**한다.
 *   AM 의 «빨간 문단 %»가 아니라 **계획 대 실물의 차이**를 센다 — 부등호 하나: 🔴 **계획에 없는 통문단 서식 = 0**.
 *
 *   ══ 자를 먼저 찌른다(트리거 규율) ══
 *     ⓪ 러너 없이 가짜 에디터를 손으로 몰아 «색 → 타자 → Enter → 타자»가 **정말 번지는지** 본다.
 *        번지지 않으면 이 자는 아무것도 못 잰다 — 그때는 아래 축 전부를 믿지 마라(종료코드 1).
 *     `--mutate=break`  : `breakFormatBeforePara` 를 «아무 일도 안 함»으로 → 서식 글에서 빨강이 나와야 한다
 *     `--mutate=dirty`  : `markFormatDirty` 를 빈 함수로 → 같은 곳이 빨개져야 한다
 *     `--mutate=measure`: `measureFormatBleedIn` 이 항상 0 을 내게 → 러너 자가검사(bleedVerdict)가 잡던 것을 못 잡아야 한다
 *   🔴 리포 파일은 안 건드린다 — `runner/` 를 스크래치에 복사해 거기서 변이한다(node_modules 는 정션).
 *
 *   ══ 정직한 한계 ══
 *     · 가짜 에디터는 네이버가 아니다. 여기서 초록이어도 «네이버에서 안 번진다»가 아니라 **«러너 논리가 contenteditable 위에서 안 번진다»**다.
 *     · B2 가 `playOps` 를 export 하기 전에는 러너 축이 **열림**이다(⓪ 자기 찌르기만 돈다).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, symlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const MUT = (ARGS.find((a) => a.startsWith("--mutate=")) || "").split("=")[1] || "";
const HEADED = ARGS.includes("--headed");
const KEEP = ARGS.includes("--keep");

const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

/* ═══ 러너 사본(변이는 여기서만) ═══ */
const SCRATCH = process.env.CLAUDE_SCRATCHPAD || join(tmpdir(), "ac-c-bleed");
const COPY = join(SCRATCH, `runner-copy-${MUT || "plain"}`);
function makeCopy() {
  rmSync(COPY, { recursive: true, force: true });
  mkdirSync(COPY, { recursive: true });
  for (const f of readdirSync(join(ROOT, "runner"))) {
    if (["node_modules", "profiles", "_shots", "tmp"].includes(f)) continue;
    const src = join(ROOT, "runner", f);
    if (statSync(src).isDirectory()) cpSync(src, join(COPY, f), { recursive: true }); else cpSync(src, join(COPY, f));
  }
  try { symlinkSync(join(ROOT, "runner", "node_modules"), join(COPY, "node_modules"), "junction"); }
  catch (e) { throw new Error("node_modules 정션 실패 — " + e.message); }
  mkdirSync(join(COPY, "_shots"), { recursive: true });
  mkdirSync(join(COPY, "tmp"), { recursive: true });
}
/** 변이 — 심을 자리를 못 찾으면 **종료코드 3**(«변이가 안 심겼는데 통과»는 거짓 초록이다 · AM 규율). */
const MUTATIONS = {
  break: { file: "lib/format-bleed.mjs", re: /export\s+async\s+function\s+breakFormatBeforePara\s*\([^)]*\)\s*\{/, to: (m) => `${m} return false; /* 변이 break */`,
    expect: "서식 글에서 «계획에 없는 통문단 서식» > 0 (끊기가 사라진 병)" },
  dirty: { file: "lib/format-bleed.mjs", re: /export\s+function\s+markFormatDirty\s*\([^)]*\)\s*\{/, to: (m) => `${m} return; /* 변이 dirty */`,
    expect: "같은 곳 — 더럽다고 안 적으니 끊지 않는다" },
  measure: { file: "lib/format-bleed.mjs", re: /export\s+function\s+measureFormatBleedIn\s*\([^)]*\)\s*\{/, to: (m) => `${m} return { total: 0, bad: 0, pct: 0, samples: [] }; /* 변이 measure */`,
    expect: "러너 자가검사가 번진 판을 «깨끗»이라 한다 — 자가검사 축이 빨개져야 한다" },
};
function applyMutation() {
  if (!MUT) return;
  const m = MUTATIONS[MUT];
  if (!m) { console.error("모르는 변이: " + MUT); process.exit(2); }
  const p = join(COPY, m.file);
  if (!existsSync(p)) { console.error(`🔴 변이 ${MUT}: ${m.file} 이 없다(B2 의 R9-3 이 아직 없다) — 심을 자리가 없다`); process.exit(3); }
  const src = readFileSync(p, "utf8");
  if (!m.re.test(src)) { console.error(`🔴 변이 ${MUT}: 심을 자리를 못 찾았다 — ${m.re}`); process.exit(3); }
  writeFileSync(p, src.replace(m.re, m.to));
  console.log(`\n⚠️ 변이 ${MUT} 적용 — 빨개져야 할 축: ${m.expect}`);
}

/* ═══ 가짜 스마트에디터 ═══
   B2 가 «꼭 있어야 한다»고 못 박은 넷: 문단·컴포넌트 클래스 / «본문 추가»(.se-canvas-bottom + 버튼) / 툴바 6종 + 실제 색이 칠해진 팔레트 /
   안 세는 칸(.se-quotation · .se-documentTitle). 여기 없으면 러너가 조용히 폴백으로 새고 우리는 초록을 본다. */
const EDITOR_HTML = String.raw`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>fake-se-one</title>
<style>
  body{font-family:sans-serif;margin:0;padding:12px}
  .se-toolbar{display:flex;gap:6px;padding:6px;border-bottom:1px solid #ddd;position:sticky;top:0;background:#fff}
  .se-toolbar button{padding:4px 8px}
  .se-content{min-height:300px;padding:12px;outline:1px dashed #ccc}
  .se-text-paragraph{font-size:15px;line-height:1.6;margin:0;min-height:1.6em}
  .se-section-documentTitle .se-text-paragraph{font-size:24px;font-weight:600;min-height:1.4em}
  .se-quotation-container{border-left:4px solid #999;margin:8px 0;padding:8px 12px}
  .se-quotation .se-text-paragraph{text-align:center;font-style:italic;font-size:19px}
  .se-horizontalLine hr{border:0;border-top:1px solid #999;margin:12px 0}
  .se-canvas-bottom{margin-top:16px;padding:10px;border:1px dashed #aaa;color:#666;cursor:pointer}
  .se-canvas-bottom-button{opacity:0;position:absolute;width:1px;height:1px}
  .se-color-palette-layer{display:none;position:absolute;background:#fff;border:1px solid #ccc;padding:6px;z-index:9}
  .se-color-palette-layer.open{display:flex;gap:4px}
  .se-color-palette{width:22px;height:22px;border:1px solid #999}
  .se-font-size-list{display:none;position:absolute;background:#fff;border:1px solid #ccc;z-index:9}
  .se-font-size-list.open{display:flex;flex-direction:column}
</style></head><body>
<div class="se-toolbar">
  <button class="se-insert-quotation-default-toolbar-button" aria-label="인용구 추가" data-name="quotation">인용구</button>
  <button class="se-insert-horizontal-line-default-toolbar-button" aria-label="구분선 추가" data-name="horizontal-line">구분선</button>
  <span style="position:relative"><button class="se-font-size-code-toolbar-button">크기</button>
    <div class="se-font-size-list"><button data-value="13">13</button><button data-value="15">15</button><button data-value="16">16</button><button data-value="19">19</button><button data-value="24">24</button></div></span>
  <!-- 🔴 네이버 DOM 의미대로: 색 **칸 하나** = .se-color-palette (러너 pickPaletteIndex 가 이 클래스의 배경색을 읽고 nth 로 누른다) · 층 = .se-color-palette-layer
       색은 러너의 실측 팔레트(형광펜 #fff8b2 #bdfbfa #c2f4db #fdd5f5 #e3fdc8 · 글자색 #ff0010)를 그대로 둔다 — 없으면 러너가 «근처 색 없음»으로 물러나 line 축을 못 잰다. -->
  <span style="position:relative"><button class="se-font-color-toolbar-button" aria-label="글자색 변경">글자색</button></span>
  <span style="position:relative"><button class="se-background-color-toolbar-button" aria-label="글자 배경색 변경">배경색</button></span>
  <!-- 팔레트 층은 **열렸을 때만** DOM 에 있다(네이버처럼). 러너는 문서 전체의 .se-color-palette 를 세므로 숨은 층이 섞이면 nth 가 어긋난다. -->
  <div class="se-color-palette-layer" data-kind=""></div>
  <button class="se-underline-toolbar-button">밑줄</button>
  <button class="se-bold-toolbar-button">굵게</button>
  <button data-name="image" title="사진">사진</button>
</div>
<div class="se-section-documentTitle"><div class="se-documentTitle"><p class="se-text-paragraph" contenteditable="true"><span></span></p></div></div>
<div class="se-content se-container" id="body" contenteditable="true">
  <div class="se-component se-text"><p class="se-text-paragraph"><span></span></p></div>
</div>
<div class="se-canvas-bottom">본문 추가<button class="se-canvas-bottom-button __edge-area" aria-label="본문 추가"></button></div>
<script>
(() => {
  document.execCommand("styleWithCSS", false, true);
  const body = document.getElementById("body");
  const sel = () => window.getSelection();
  const componentOf = (node) => { let n = node && node.nodeType === 1 ? node : node && node.parentElement; while (n && n !== body) { if (n.classList && n.classList.contains("se-component") && n.parentElement === body) return n; n = n.parentElement; } return null; };
  const caretIn = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = sel(); s.removeAllRanges(); s.addRange(r); };
  const newTextComponent = () => { const c = document.createElement("div"); c.className = "se-component se-text"; c.innerHTML = '<p class="se-text-paragraph"><span></span></p>'; return c; };
  const placeAfter = (ref, el) => { if (ref && ref.parentElement === body) body.insertBefore(el, ref.nextSibling); else body.appendChild(el); };
  const currentComponent = () => { const s = sel(); return s.rangeCount ? componentOf(s.getRangeAt(0).startContainer) : null; };
  const toggle = (el) => { el.classList.toggle("open"); };

  /* «본문 추가» — 새 글 칸을 문서 끝에 만들고 캐럿을 거기 둔다(선택 이동으로 Chromium typing style 이 풀린다 = 새 칸은 서식을 안 물려받는다). */
  const addBottom = () => { const c = newTextComponent(); body.appendChild(c); body.focus(); caretIn(c.querySelector("span")); };
  document.querySelector(".se-canvas-bottom").addEventListener("click", addBottom);
  document.querySelector(".se-canvas-bottom-button").addEventListener("click", (e) => { e.stopPropagation(); addBottom(); });

  document.querySelector(".se-insert-quotation-default-toolbar-button").addEventListener("mousedown", (e) => e.preventDefault());
  document.querySelector(".se-insert-quotation-default-toolbar-button").addEventListener("click", () => {
    const q = document.createElement("div"); q.className = "se-component se-quotation";
    q.innerHTML = '<blockquote class="se-quotation-container"><div class="se-component se-text"><p class="se-text-paragraph"><span></span></p></div></blockquote>';
    placeAfter(currentComponent(), q); body.focus(); caretIn(q.querySelector("span"));
  });
  document.querySelector(".se-insert-horizontal-line-default-toolbar-button").addEventListener("mousedown", (e) => e.preventDefault());
  document.querySelector(".se-insert-horizontal-line-default-toolbar-button").addEventListener("click", () => {
    const h = document.createElement("div"); h.className = "se-component se-horizontalLine"; h.innerHTML = "<hr>";
    placeAfter(currentComponent(), h); body.focus();
    const r = document.createRange(); r.setStartAfter(h); r.collapse(true); const s = sel(); s.removeAllRanges(); s.addRange(r);
  });
  for (const b of document.querySelectorAll(".se-toolbar button")) b.addEventListener("mousedown", (e) => e.preventDefault());
  document.querySelector(".se-font-size-code-toolbar-button").addEventListener("click", (e) => toggle(e.target.nextElementSibling));
  let pendingSize = null;
  for (const b of document.querySelectorAll(".se-font-size-list button")) b.addEventListener("click", (e) => {
    const px = e.target.dataset.value; e.target.parentElement.classList.remove("open");
    body.focus(); pendingSize = px; document.execCommand("fontSize", false, "7");
  });
  /* 팔레트 — 러너 실측 색 그대로(형광펜 #fff8b2 #bdfbfa #c2f4db #fdd5f5 #e3fdc8 · 글자색 #ff0010). 열 때 만들고 고르면 비운다. */
  const PALETTES = {
    fore: [["색 없음", "rgb(255, 255, 255)", true], ["검정", "rgb(0, 0, 0)"], ["빨강", "rgb(255, 0, 16)"], ["파랑", "rgb(0, 100, 255)"]],
    back: [["색 없음", "rgb(255, 255, 255)", true], ["연노랑", "rgb(255, 248, 178)"], ["하늘", "rgb(189, 251, 250)"], ["민트", "rgb(194, 244, 219)"], ["분홍", "rgb(253, 213, 245)"], ["연두", "rgb(227, 253, 200)"]],
  };
  const layer = document.querySelector(".se-color-palette-layer");
  const openPalette = (kind) => {
    if (layer.classList.contains("open") && layer.dataset.kind === kind) { layer.classList.remove("open"); layer.innerHTML = ""; layer.dataset.kind = ""; return; }
    layer.dataset.kind = kind; layer.innerHTML = "";
    for (const [label, color, noCol] of PALETTES[kind]) {
      const b = document.createElement("button"); b.className = "se-color-palette" + (noCol ? " se-color-palette-no-col" : ""); b.style.backgroundColor = color; b.setAttribute("aria-label", label);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { const c = getComputedStyle(b).backgroundColor; layer.classList.remove("open"); layer.innerHTML = ""; body.focus(); document.execCommand(kind === "fore" ? "foreColor" : "hiliteColor", false, c); layer.dataset.kind = ""; });
      layer.appendChild(b);
    }
    layer.classList.add("open");
  };
  document.querySelector(".se-font-color-toolbar-button").addEventListener("click", () => openPalette("fore"));
  document.querySelector(".se-background-color-toolbar-button").addEventListener("click", () => openPalette("back"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { layer.classList.remove("open"); layer.innerHTML = ""; layer.dataset.kind = ""; } });
  document.querySelector(".se-underline-toolbar-button").addEventListener("click", () => { body.focus(); document.execCommand("underline"); });
  document.querySelector(".se-bold-toolbar-button").addEventListener("click", () => { body.focus(); document.execCommand("bold"); });

  /* 인용 안에서 빈 문단 Enter = 인용 밖으로(네이버와 같은 «두 번 Enter» 관례). */
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const s = sel(); if (!s.rangeCount) return;
    const p = s.getRangeAt(0).startContainer.nodeType === 1 ? s.getRangeAt(0).startContainer.closest("p") : s.getRangeAt(0).startContainer.parentElement.closest("p");
    const q = p && p.closest(".se-quotation");
    if (q && p && !(p.textContent || "").trim()) { e.preventDefault(); const c = newTextComponent(); placeAfter(q, c); caretIn(c.querySelector("span")); }
  });

  /* 정규화 — Chromium 이 만드는 느슨한 노드를 se-* 모양으로 유지한다(러너 셀렉터가 계속 맞게). */
  const normalize = () => {
    for (const n of [...body.childNodes]) {
      if (n.nodeType === 3) { if (!n.textContent.trim()) { n.remove(); continue; } const c = newTextComponent(); c.querySelector("span").appendChild(n.cloneNode()); body.replaceChild(c, n); continue; }
      if (n.nodeType === 1 && !n.classList.contains("se-component")) {
        const c = newTextComponent(); const span = c.querySelector("span"); span.innerHTML = n.tagName === "P" || n.tagName === "DIV" ? n.innerHTML : n.outerHTML; body.replaceChild(c, n);
      }
    }
    for (const comp of body.querySelectorAll(".se-component.se-text")) {
      for (const n of [...comp.childNodes]) {
        if (n.nodeType === 1 && n.tagName === "P") { n.classList.add("se-text-paragraph"); continue; }
        if (n.nodeType === 1 && n.tagName === "DIV" && !n.classList.contains("se-component")) { const p = document.createElement("p"); p.className = "se-text-paragraph"; p.innerHTML = n.innerHTML || "<span></span>"; comp.replaceChild(p, n); continue; }
        if (n.nodeType === 3 && !n.textContent.trim()) n.remove();
      }
    }
    if (pendingSize) for (const f of body.querySelectorAll('span[style*="xxx-large"], font[size="7"]')) { const s = document.createElement("span"); s.style.fontSize = pendingSize + "px"; s.innerHTML = f.innerHTML; f.replaceWith(s); }
  };
  new MutationObserver(normalize).observe(body, { childList: true, subtree: true, characterData: true });
  /* 측정 직전에만 부른다 — 네이버처럼 문단의 글자를 전부 span 안에 둔다. 🔴 편집 도중에 하면 선택이 든 노드를 갈아 끼워 캐럿이 튄다(실측 · 자를 망가뜨렸다). */
  const wrapBareText = () => { for (const p of body.querySelectorAll(".se-text-paragraph")) for (const n of [...p.childNodes]) { if (n.nodeType === 3 && n.textContent.length) { const s = document.createElement("span"); p.replaceChild(s, n); s.appendChild(n); } } };
  window.__fakeSE = { normalize, wrapBareText };
})();
</script></body></html>`;

/* ═══ 내 자 — 문단마다 «어떤 서식이 통째로 / 부분으로 붙었나» ═══ */
const READ_PARAS = () => {
  const body = document.getElementById("body");
  const paras = [...body.querySelectorAll(".se-component.se-text .se-text-paragraph")]
    .filter((p) => !p.closest(".se-quotation") && !p.closest(".se-documentTitle"));
  const isRedish = (c) => { const m = String(c || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return !!m && +m[1] >= 140 && +m[2] <= 90 && +m[3] <= 90; };
  const comps = [...body.querySelectorAll(":scope > .se-component")];
  const rows = [];
  for (const p of paras) {
    const text = (p.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const comp = comps.findIndex((c) => c.contains(p));
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let total = 0; const cov = { bold: 0, underline: 0, color: 0, bg: 0, big: 0 };
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent; const len = t.replace(/\s/g, "").length; if (!len) continue;
      total += len;
      const cs = getComputedStyle(node.parentElement);
      if (["700", "bold", "600"].includes(String(cs.fontWeight)) || +cs.fontWeight >= 600) cov.bold += len;
      if ((cs.textDecorationLine || cs.textDecoration || "").includes("underline")) cov.underline += len;
      if (cs.color !== "rgb(0, 0, 0)" && cs.color !== "rgba(0, 0, 0, 0)") cov.color += len;
      const bg = cs.backgroundColor; if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "rgb(255, 255, 255)") cov.bg += len;
      if (parseInt(cs.fontSize, 10) > 15) cov.big += len;
    }
    const whole = {}, partial = {};
    for (const k of Object.keys(cov)) { const f = total ? cov[k] / total : 0; whole[k] = f >= 0.999; partial[k] = f > 0 && f < 0.999; }
    rows.push({ text, whole, partial, total, comp, cov });
  }
  return rows;
};

/* ═══ 기대치 — 계획(ops)에서 «이 문단은 무엇이 붙어도 되나»를 만든다 ═══ */
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function expectedOf(plan) {
  const exp = [];
  for (const op of plan.ops) {
    const parts = Array.isArray(op.parts) ? op.parts : null;
    const text = norm(parts ? parts.map((p) => p.t ?? p.text ?? "").join("") : op.text);
    if (!text) continue;
    const marks = new Set((parts || []).filter((p) => p.mark).map((p) => String(p.mark)));
    const inlineMarks = /<(u|mark|em|strong|b)\b/.test(String(op.html ?? op.text ?? "")) || Array.isArray(op.marks);
    switch (op.op) {
      case "heading": exp.push({ text, allowWhole: new Set(["bold", "big"]), allowPartial: new Set() }); break;
      case "qaQ": exp.push({ text, allowWhole: new Set(["bold"]), allowPartial: new Set() }); break;
      case "list": exp.push({ text: `• ${text}`, allowWhole: new Set(), allowPartial: new Set(["bold", "underline", "color", "bg"]) }); break;
      case "check": exp.push({ text: `☑ ${text}`, allowWhole: new Set(), allowPartial: new Set(["bold", "underline", "color", "bg"]) }); break;
      case "link": exp.push({ text: norm(`${op.text} ${op.url}`), allowWhole: new Set(), allowPartial: new Set(["bold", "underline", "color"]) }); break;
      case "quote": case "divider": case "image": case "note": case "title": break;
      default:
        /* para · faq · tagline 등 — **부분** 강조는 계획이 마크를 줬을 때만 허용. 통문단 서식은 언제나 번짐이다(계획엔 «문단 전체 색칠»이 없다). */
        exp.push({ text, allowWhole: new Set(), allowPartial: new Set(marks.size || inlineMarks ? ["bold", "underline", "color", "bg"] : []) });
    }
  }
  return exp;
}
function diffParas(rows, exp) {
  const bad = []; let matched = 0;
  for (const r of rows) {
    const e = exp.find((x) => x.text === r.text) || exp.find((x) => r.text.startsWith(x.text.slice(0, 20)));
    if (!e) continue;
    matched++;
    for (const k of Object.keys(r.whole)) {
      if (r.whole[k] && !e.allowWhole.has(k)) bad.push(`«${r.text.slice(0, 22)}» 통문단 ${k}(계획엔 없다)`);
      else if (r.partial[k] && !e.allowPartial.has(k) && !e.allowWhole.has(k)) bad.push(`«${r.text.slice(0, 22)}» 부분 ${k}(계획엔 없다)`);
    }
  }
  return { bad, matched };
}

/* ═══ 본체 ═══ */
async function main() {
  makeCopy();
  applyMutation();
  /* 🔴 [2026-09-16 메인] playwright 를 **러너 폴더에서만** 찾고 있었다 — `runner/node_modules` 는 **B2·C 폴더에만** 있어서
     메인·A·B 폴더에서는 이 자가 **종료코드 4**(«하니스 자체 오류»)로 떨어졌다. 🔴 그건 «틀렸다»가 아니라 «**못 쟀다**»다.
     `verify-safe-list` 는 **2** 를 «⊘ 못 쟀음»으로 세므로, 없을 때는 **exit 2** 로 끝나야 «실패 1개»로 안 찍힌다(AC-96).
     ⇒ 같은 폴더 문제를 이미 푼 `scripts/lib/find-playwright.mjs` 를 쓴다(우리 러너 것 → PW_DIR → 옆 리포 → 루트). */
  const pw = await requirePlaywright();
  const browser = await pw.chromium.launch({ headless: !HEADED });
  /* 폭 480 — 긴 문단이 **여러 줄로 접히게**(줄 경계를 넘는 ArrowLeft 가 글자 단위로 정확한지 재려면 접혀야 한다). */
  const context = await browser.newContext({ viewport: { width: 480, height: 900 }, locale: "ko-KR" });
  const open = async () => { const page = await context.newPage(); await page.setContent(EDITOR_HTML, { waitUntil: "domcontentloaded" }); return page; };
  const clickBody = async (page) => { await page.click("#body .se-text-paragraph"); };

  /* ── ⓪ 자기 찌르기: 가짜 에디터가 정말 번지나 / 새 칸이 정말 끊나 / 내 자가 그걸 보나 ── */
  {
    const page = await open();
    await clickBody(page);
    await page.click(".se-font-color-toolbar-button");
    await page.click('.se-color-palette-layer[data-kind="fore"] .se-color-palette[aria-label="빨강"]');
    await page.keyboard.insertText("첫 문단은 일부러 빨강으로 칠했다");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("둘째 문단은 아무 서식도 시키지 않았다");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("셋째 문단도 시키지 않았다");
    await page.waitForTimeout(150);
    const rows = await page.evaluate(READ_PARAS);
    const redAll = rows.filter((r) => r.whole.color).length;
    rec("⓪a 가짜 에디터가 정말 번진다(색 → Enter → 다음 문단도 색)", rows.length >= 3 && redAll >= 2,
      `문단 ${rows.length} · 통문단 색 ${redAll} (번지지 않으면 이 자는 아무것도 못 잰다)`);

    /* 밑줄·굵게·배경도 같은 병인가 */
    const page2 = await open();
    await clickBody(page2);
    await page2.click(".se-underline-toolbar-button");
    await page2.keyboard.insertText("밑줄 문단");
    await page2.keyboard.press("Enter");
    await page2.keyboard.insertText("밑줄을 시키지 않은 문단");
    await page2.waitForTimeout(100);
    const rows2 = await page2.evaluate(READ_PARAS);
    rec("⓪b 밑줄도 번진다(같은 병 · 밑줄은 켜졌는지 못 읽어 토글로 못 끈다)", rows2.filter((r) => r.whole.underline).length >= 2, rows2.map((r) => `${r.text.slice(0, 8)}:${r.whole.underline ? "U" : "-"}`).join(" "));

    /* 새 칸(«본문 추가»)이 끊나 — 이것이 러너의 유일한 방어라 가짜 에디터도 그 성질을 가져야 한다 */
    const page3 = await open();
    await clickBody(page3);
    await page3.click(".se-font-color-toolbar-button");
    await page3.click('.se-color-palette-layer[data-kind="fore"] .se-color-palette[aria-label="빨강"]');
    await page3.keyboard.insertText("빨강 문단");
    await page3.click(".se-canvas-bottom");
    await page3.keyboard.insertText("새 칸에서 쓴 문단");
    await page3.waitForTimeout(100);
    const rows3 = await page3.evaluate(READ_PARAS);
    const fresh = rows3.find((r) => r.text.startsWith("새 칸"));
    rec("⓪c «본문 추가» 새 칸은 서식을 안 물려받는다(러너의 끊기 = 이 성질 하나에 기댄다)", !!fresh && !fresh.whole.color && !fresh.partial.color,
      fresh ? `새 칸 문단 색=${fresh.whole.color || fresh.partial.color ? "물려받음 🔴" : "없음"}` : "새 칸 문단을 못 찾았다");

    /* 대조군 — 안 세는 칸(인용·제목)은 내 자도 안 센다(거짓 양성 축 · m6 대응) */
    const page4 = await open();
    await clickBody(page4);
    await page4.keyboard.insertText("정상 문단 하나");
    await page4.click(".se-insert-quotation-default-toolbar-button");
    await page4.keyboard.insertText("인용은 원래 가운데·기울임");
    await page4.waitForTimeout(100);
    const rows4 = await page4.evaluate(READ_PARAS);
    rec("⓪d 인용·제목은 세지 않는다(정상 글이 빨개지는 가장 쉬운 길을 막았나)", rows4.length === 1 && !rows4.some((r) => /인용/.test(r.text)), `센 문단 ${rows4.length}`);
    await page.close(); await page2.close(); await page3.close(); await page4.close();
  }

  /* ── 러너 모듈(사본) ── */
  let mod = null, planMod = null, bleedMod = null;
  /* 🔴 export 가 없으면 **사본에서만** 강제로 내보낸다 — «옛 판»(서식 0 · 끊기 0)을 같은 격자에 태워 빨강이 나오는 것을 본다(자를 먼저 찌른다). */
  let forcedExport = false;
  {
    const p = join(COPY, "channels", "naver-blog.mjs");
    const src = readFileSync(p, "utf8");
    if (!/export\s+(async\s+)?function\s+playOps\b/.test(src) && !/export\s*\{[^}]*\bplayOps\b/.test(src) && /async function playOps\(/.test(src)) {
      writeFileSync(p, src + "\nexport { playOps }; /* C 하니스 사본 전용 강제 export */\n");
      forcedExport = true;
    }
  }
  try { mod = await import(pathToFileURL(join(COPY, "channels", "naver-blog.mjs")).href); } catch (e) { rec("러너 모듈 로드", false, String(e.message).slice(0, 160)); }
  try { planMod = await import(pathToFileURL(join(COPY, "lib", "plan.mjs")).href); } catch (e) { rec("plan.mjs 로드", false, String(e.message).slice(0, 160)); }
  try { bleedMod = existsSync(join(COPY, "lib", "format-bleed.mjs")) ? await import(pathToFileURL(join(COPY, "lib", "format-bleed.mjs")).href) : null; } catch (e) { rec("format-bleed.mjs 로드", false, String(e.message).slice(0, 160)); }
  const hasPlay = !!(mod && typeof mod.playOps === "function");
  rec("① playOps 가 export 돼 있다(B2 약속 · 사본 강제 export 는 «옛 판 측정»일 뿐이다)", hasPlay && !forcedExport,
    forcedExport ? "🔴 리포엔 export 없음 — 사본에서 강제로 내보내 옛 판을 잰다" : hasPlay ? "있다" : "🔴 playOps 자체가 없다");
  rec("① format-bleed.mjs 가 있다(R9-3 세 겹이 사는 파일)", !!bleedMod, bleedMod ? `export: ${Object.keys(bleedMod).join(", ")}` : "🔴 없음 — R9-3 미착");

  const BLOCKS_PLAIN = [
    { type: "hook", text: "요즘 전기요금 때문에 고민이 많으시죠." },
    { type: "para", text: "저도 지난달 고지서를 보고 깜짝 놀랐어요. 그래서 이것저것 바꿔 봤습니다." },
    { type: "h2", text: "먼저 바꾼 것 세 가지" },
    { type: "list", items: ["대기전력 차단", "세탁은 밤에", "냉장고 온도 한 칸"] },
    { type: "quote", text: "작은 습관이 고지서를 바꿉니다." },
    { type: "para", text: "인용 뒤 문단입니다. 여기가 인용 서식을 물려받으면 번짐입니다." },
    { type: "divider" },
    { type: "checklist", items: ["멀티탭 스위치 끄기", "보일러 외출 모드"] },
    { type: "h3", text: "결론부터" },
    { type: "para", text: "한 달에 만 원 정도 줄었습니다. 다음 달도 이어 가 볼게요." },
    { type: "faq", items: ["Q. 효과가 바로 나오나요? | A. 두 달째부터 체감됐어요."] },
    { type: "hashtags", items: ["전기요금", "절약"] },
  ];

  const runCase = async (name, payload, opts = {}) => {
    if (!hasPlay || !planMod) { rec(name, false, "playOps 없음 — 열림"); return null; }
    const page = await open();
    await page.click(".se-documentTitle .se-text-paragraph");
    await page.keyboard.insertText(payload.title || "제목");
    await clickBody(page);
    const plan = planMod.planEditorOps(payload);
    const missed = { quote: 0, divider: 0, heading: 0, quoteEscape: 0, caretEnd: 0, image: 0, imageDownload: 0, imageSettle: 0 };
    const fmt = bleedMod && typeof bleedMod.createFormatState === "function" ? bleedMod.createFormatState() : undefined;
    let err = null, applied = null;
    try { const played = await mod.playOps(page, page, plan, new Map(), "c-bleed", missed, fmt); applied = played && typeof played === "object" ? played.applied ?? null : null; } catch (e) { err = e; }
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__fakeSE && window.__fakeSE.wrapBareText()).catch(() => {});
    if (ARGS.includes("--dump")) console.log(`\n[dump ${name}]\n` + await page.evaluate(() => [...document.querySelectorAll("#body .se-text-paragraph")].map((p) => p.outerHTML).join("\n")));
    const rows = await page.evaluate(READ_PARAS);
    const comps = await page.evaluate(() => ({ quote: document.querySelectorAll("#body > .se-component.se-quotation").length, hr: document.querySelectorAll("#body > .se-component.se-horizontalLine").length, fallback: [...document.querySelectorAll("#body .se-text-paragraph")].filter((p) => /^[“"].*[”"]$|^—{3,}$/.test((p.textContent || "").trim())).length })).catch(() => null);
    const emptyStyled = await page.evaluate(() => [...document.querySelectorAll("#body .se-text-paragraph")].filter((p) => !(p.textContent || "").trim() && p.querySelector("span[style]")).length).catch(() => -1);
    const { bad, matched } = diffParas(rows, expectedOf(plan));
    const verdict = bleedMod && typeof bleedMod.measureFormatBleed === "function" && typeof bleedMod.bleedVerdict === "function"
      ? await bleedMod.measureFormatBleed(page).then((b) => ({ b, v: bleedMod.bleedVerdict(b) })).catch((e) => ({ err: String(e.message) })) : null;
    if (!KEEP) await page.close();
    return { plan, rows, bad, matched, missed, fmt, err, verdict, applied, emptyStyled, comps };
  };

  /* ── ② 🔴 평범한 글 — 서식이 없는 글에 깃발이 서면 멀쩡한 글이 안 나간다(AC-68) ── */
  {
    const r = await runCase("② 평범한 글", { title: "전기요금 줄인 이야기", blocks: BLOCKS_PLAIN, tags: ["전기요금"] });
    if (r) {
      rec("② 평범한 글 — 계획에 없는 서식이 붙은 문단 0(연주 오류 0)", r.bad.length === 0 && !r.err && r.matched >= 6,
        r.err ? `🔴 연주 오류: ${String(r.err.message).slice(0, 120)}` : `문단 ${r.rows.length} · 대조 ${r.matched} · 번짐 ${r.bad.length}${r.bad.length ? " — " + r.bad.slice(0, 3).join(" · ") : ""}`);
      const dirtyOnPlain = r.fmt && typeof r.fmt === "object" ? (r.fmt.dirty === true || (r.fmt.breaks ?? 0) > 3) : false;
      rec("② 평범한 글에 «더럽다» 깃발·끊기가 남발되지 않는다(끊기는 서식 뒤에만)", !dirtyOnPlain, r.fmt ? `state=${JSON.stringify(r.fmt).slice(0, 140)}` : "상태 객체 없음(측정 불가)");
      /* 🔴 B7 «에디터 실제 요소» — 인용·구분선이 **진짜 컴포넌트**(.se-quotation · .se-horizontalLine)로 섰나, 텍스트 폴백(“…” · ———)으로 새지 않았나. 감사 B7 의 다른 모양의 자(행동 검사). */
      if (r.comps) rec("② B7 인용·구분선이 진짜 에디터 컴포넌트로 선다(텍스트 폴백 0)", r.comps.quote >= 1 && r.comps.hr >= 1 && r.comps.fallback === 0, `인용 컴포넌트 ${r.comps.quote} · 구분선 컴포넌트 ${r.comps.hr} · 텍스트 폴백 ${r.comps.fallback}`);
      if (r.verdict && !r.verdict.err) rec("② 러너 자가검사도 평범한 글을 «깨끗»이라 한다(거짓 양성 0)", r.verdict.v && r.verdict.v.stop !== true, JSON.stringify(r.verdict.v).slice(0, 160));
    }
  }

  /* ── ③ 🔴 서식 글 — 밑줄·형광펜·색이 **부분**으로만 붙고, 다음 문단으로 번지지 않는다 ── */
  {
    /* 서식 어휘 = B·B2 확정(2026-09-16): `block.marks[{kind:"value|line|row|bold|underline", s, e}]`(원문 인덱스) + `**굵게**`.
       마크 뒤마다 **평문 문단**을 둔다 — 그 문단이 «앞 문단의 서식을 물려받나»가 번짐의 정의다. */
    const mk = (text, kind, sub) => ({ type: "para", text, marks: [{ kind, s: text.indexOf(sub), e: text.indexOf(sub) + sub.length }] });
    const blocks = [
      mk("이 문단에는 밑줄 한 토막이 있습니다. 나머지는 평문입니다.", "underline", "밑줄 한 토막"),
      { type: "para", text: "이 문단은 평문입니다. 앞 문단의 밑줄이 여기까지 오면 번짐입니다." },
      mk("이 문단에는 형광펜으로 칠한 문장 하나가 있습니다.", "line", "형광펜으로 칠한 문장 하나가 있습니다."),
      { type: "para", text: "이 문단도 평문입니다. 형광펜이 여기까지 오면 번짐입니다." },
      mk("핵심값은 12,400원 입니다.", "value", "12,400원"),
      { type: "para", text: "핵심값 뒤 평문 문단입니다. 색·굵게가 오면 번짐입니다." },
      { type: "para", text: "여기는 **굵게 한 토막**이 있습니다." },
      /* B2 가 «제일 덜 확신한다»고 짚은 셋 — ⓐ마크가 문단 맨 앞(s=0) ⓑ두 마크가 붙어 있음(사이 평문 0자) ⓒ줄바꿈되는 긴 문단 한복판의 마크(폭 480 · ArrowLeft 가 줄 경계를 넘는다) */
      { type: "para", text: "맨 앞 토막부터 밑줄이고 그 뒤는 평문입니다.", marks: [{ kind: "underline", s: 0, e: 5 }] },
      { type: "para", text: "값은 12,400원 절약 이라고 붙여 썼습니다.", marks: [{ kind: "value", s: 3, e: 10 }, { kind: "underline", s: 10, e: 13 }] },
      { type: "para", text: "이 문단은 일부러 아주 길게 씁니다. 폰 폭에서는 여러 줄로 접히는데 그 한복판에 형광펜 한 문장을 둡니다. 여기가 그 문장입니다. 그리고 그 뒤로도 평문이 두 줄쯤 더 이어져서 캐럿이 줄 경계를 두 번 넘어야 합니다. 끝.",
        marks: [{ kind: "line", s: "이 문단은 일부러 아주 길게 씁니다. 폰 폭에서는 여러 줄로 접히는데 그 한복판에 형광펜 한 문장을 둡니다. ".length, e: "이 문단은 일부러 아주 길게 씁니다. 폰 폭에서는 여러 줄로 접히는데 그 한복판에 형광펜 한 문장을 둡니다. 여기가 그 문장입니다.".length }] },
      mk("마지막 문단의 끝에 밑줄 토막이 있고 바로 태그 줄이 옵니다.", "underline", "밑줄 토막"),
      { type: "hashtags", items: ["전기요금", "절약"] },   // 🔴 태그 op 는 hashtags 블록에서만 나온다(payload.tags 는 발행 레이어 태그란으로 간다)
    ];
    /* 🔴 마크 문단 → 해시태그 줄: 태그는 글의 마지막 줄이라 «다음 문단»이 없다 — 앞 서식이 남으면 태그 줄이 통째로 물든다(B2 가 두 번째 자리로 잡은 것). */
    const r = await runCase("③ 서식 글", { title: "서식 글", blocks, tags: ["전기요금", "절약"] });
    if (r) {
      const anyPartial = r.rows.some((x) => Object.values(x.partial).some(Boolean));
      const wholeBleed = r.bad.filter((b) => /통문단/.test(b));
      rec("③ 서식이 실제로 눌렸다(부분 서식이 DOM 에 있다 — 없으면 «그렸다»를 증명 못 한다 · AC-87)", anyPartial,
        anyPartial ? `부분 서식 문단 ${r.rows.filter((x) => Object.values(x.partial).some(Boolean)).length}개 · applied=${JSON.stringify(r.applied ?? null)}` : "🔴 부분 서식 0 — 러너가 서식을 안 누르거나(R9-2 미착) 어휘가 다르다");
      rec("③ 🔴 다음 문단으로 번진 것 0(계획에 없는 통문단 서식)", wholeBleed.length === 0 && !r.err,
        r.err ? `🔴 연주 오류: ${String(r.err.message).slice(0, 120)}` : wholeBleed.length ? `🔴 ${wholeBleed.slice(0, 4).join(" · ")}` : `문단 ${r.rows.length} · 번짐 0`);
      /* 🔴 꼬리 축 — 마크는 **계획한 글자만** 덮어야 한다. 마크 뒤에 ArrowRight 로 푼 캐럿이 span 안에 남으면 같은 문단의 다음 조각이
         서식을 물려받는다(«밑줄 한 토막»을 시켰는데 문단 끝까지 밑줄). 통문단이 아니라 «부분»이라 위 축은 못 본다 — 글자 수로 잰다.
         value 는 러너가 굵게 + (형광펜|글자색) 을 번갈아 쓰므로 굵게 글자 수만 정확히 재고 색은 «있다»만 본다. */
      {
        const bad = [];
        for (const op of r.plan.ops) {
          if (!Array.isArray(op.parts) || !op.parts.some((p) => p.mark)) continue;
          const text = norm(op.parts.map((p) => p.t ?? "").join(""));
          const row = r.rows.find((x) => x.text === text) || r.rows.find((x) => x.text.startsWith(text.slice(0, 20)));
          if (!row) continue;
          const want = { bold: 0, underline: 0, bg: 0, color: 0, valueLen: 0 };
          for (const p of op.parts) {
            const n = String(p.t ?? "").replace(/\s/g, "").length;
            if (p.mark === "underline") want.underline += n;
            else if (p.mark === "line") want.bg += n;
            else if (p.mark === "value") { want.bold += n; want.valueLen += n; }   // value = 굵게 + (형광펜|글자색 번갈아)
            else if (p.mark === "bold" || p.mark === "row") want.bold += n;
          }
          for (const k of ["bold", "underline", "bg", "color"]) {
            const got = row.cov?.[k] ?? 0;
            /* value 의 색은 bg 또는 color 어느 쪽이든 valueLen 만큼 — 둘의 합으로 잰다 */
            if ((k === "bg" || k === "color") && want.valueLen) {
              if (k === "color") continue;
              const gotColor = (row.cov?.bg ?? 0) + (row.cov?.color ?? 0);
              const wantColor = want.bg + want.valueLen;
              if (Math.abs(gotColor - wantColor) > 2) bad.push(`«${text.slice(0, 16)}» 색(bg+color) 계획 ${wantColor}자 → 실물 ${gotColor}자`);
              continue;
            }
            if (k === "color" && !want.valueLen) { if (got > 2) bad.push(`«${text.slice(0, 16)}» color 계획 0자 → 실물 ${got}자`); continue; }
            if (Math.abs(got - want[k]) > 2) bad.push(`«${text.slice(0, 16)}» ${k} 계획 ${want[k]}자 → 실물 ${got}자`);
          }
        }
        rec("③ 🔴 꼬리 — 마크가 **계획한 글자만** 덮는다(같은 문단의 다음 조각으로 안 번진다)", bad.length === 0, bad.length ? `🔴 ${bad.slice(0, 4).join(" · ")}` : "마크 문단 전부 글자 수 일치(±2)");
      }
      /* 🟠 빈 서식 문단 — Enter 를 먼저 치고 새 칸을 만들면 옛 칸 끝에 «서식만 남은 빈 문단»이 하나씩 남는다(발행물에 빈 줄 추가 = 모양 훼손). */
      {
        const empties = await (async () => { try { return await r.emptyStyled; } catch { return -1; } })();
        rec("③ 🟠 마크 문단 뒤에 «서식만 남은 빈 문단»이 안 남는다(빈 줄이 하나씩 늘면 모양이 흐트러진다)", empties === 0, empties >= 0 ? `빈 서식 문단 ${empties}개` : "측정 불가");
      }
      /* 🔴 기전 축 — «끊기»는 «새 글 칸(.se-component)을 만든다»여야 한다. 마크 문단의 **다음 문단이 같은 컴포넌트**에 있으면
         끊기는 문단 끝을 클릭만 한 것이고, 그건 contenteditable 에서 서식을 못 끊는다(state.breaks 가 «클릭 성공»을 세고 있을 수 있다). */
      const markedIdx = r.rows.map((x, i) => (Object.values(x.partial).some(Boolean) ? i : -1)).filter((i) => i >= 0);
      const sameComp = markedIdx.filter((i) => r.rows[i + 1] && r.rows[i + 1].comp === r.rows[i].comp).map((i) => `«${r.rows[i].text.slice(0, 14)}»→«${r.rows[i + 1].text.slice(0, 14)}» comp ${r.rows[i].comp}`);
      rec("③ 🔴 기전 — 마크 문단 다음 문단은 **새 컴포넌트**에 있다(끊기가 새 칸을 만들었다 · 클릭만 하면 못 끊는다)", markedIdx.length > 0 && sameComp.length === 0,
        markedIdx.length ? (sameComp.length ? `🔴 같은 컴포넌트: ${sameComp.slice(0, 3).join(" · ")}` : `마크 문단 ${markedIdx.length}개 전부 다음 문단이 새 칸`) : "마크 문단 0 — 측정 불가");
      if (r.fmt && typeof r.fmt === "object") rec("③ 대조군 — 끊기가 실제로 일어났다(state.breaks > 0 · 0 이면 «버튼이 없어서»인지 구분이 안 된다)", (r.fmt.breaks ?? 0) > 0 || (r.fmt.breakFails ?? 0) === 0 && anyPartial === false, `state=${JSON.stringify(r.fmt).slice(0, 140)}`);
      if (r.verdict && !r.verdict.err) rec("③ 러너 자가검사(bleedVerdict)와 내 자가 같은 방향을 말한다(멀쩡한 서식 글을 멈추면 AC-68)", (r.verdict.v?.stop === true) === (wholeBleed.length > 0 && r.rows.length && wholeBleed.length / r.rows.length >= 0.3),
        `자가검사=${r.verdict.v?.line ?? ""} · 표본=${JSON.stringify(r.verdict.b?.samples ?? [])} · 내 자 번짐=${wholeBleed.length}/${r.rows.length}`);
    }
  }

  /* ── ④ 🔴 자가검사(세 번째 겹) 자체 — **일부러 번지게 만든 판**을 잡나 · 깨끗한 판은 안 잡나 ──
     번짐 0 인 글에서는 «자가검사가 0 을 낸다»가 참이라 measure 변이가 안 보인다(첫 판의 내 구멍). 그래서 러너 없이 손으로 번진 판을 만들어 재운다. */
  if (bleedMod && typeof bleedMod.measureFormatBleed === "function" && typeof bleedMod.bleedVerdict === "function") {
    const page = await open();
    await clickBody(page);
    await page.click(".se-font-color-toolbar-button");
    await page.click('.se-color-palette-layer[data-kind="fore"] .se-color-palette[aria-label="빨강"]');
    for (const t of ["첫 문단부터 빨강으로 물들었습니다", "둘째 문단도 그대로 빨강입니다", "셋째 문단도 빨강이 이어집니다"]) { await page.keyboard.insertText(t); await page.keyboard.press("Enter"); }
    await page.click(".se-canvas-bottom");
    await page.keyboard.insertText("새 칸에서 쓴 깨끗한 문단입니다");
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__fakeSE && window.__fakeSE.wrapBareText()).catch(() => {});
    const opts = { headingSize: 19, bodySize: 15 };
    const bled = await bleedMod.measureFormatBleed(page, opts).catch(() => null);
    const v1 = bleedMod.bleedVerdict(bled);
    rec("④ 🔴 자가검사가 **일부러 번지게 만든 판**(4문단 중 3 빨강)을 «멈춤»으로 잡는다(measure 변이면 여기가 빨개진다)", !!bled && bled.bad >= 3 && v1.stop === true, `측정=${JSON.stringify(bled && { total: bled.total, bad: bled.bad, red: bled.red, pct: bled.pct })} · 판정=${v1.stop}`);
    const page2 = await open();
    await clickBody(page2);
    for (const t of ["평문 하나", "평문 둘", "평문 셋", "평문 넷"]) { await page2.keyboard.insertText(t); await page2.keyboard.press("Enter"); }
    await page2.evaluate(() => window.__fakeSE && window.__fakeSE.wrapBareText()).catch(() => {});
    const clean = await bleedMod.measureFormatBleed(page2, opts).catch(() => null);
    const v2 = bleedMod.bleedVerdict(clean);
    rec("④ 자가검사가 깨끗한 판을 «멈춤»으로 잡지 않는다(거짓 양성 0 · AC-68)", !!clean && clean.bad === 0 && v2.stop === false, `측정=${JSON.stringify(clean && { total: clean.total, bad: clean.bad })} · 판정=${v2.stop}`);
    await page.close(); await page2.close();
  }

  await browser.close();
  if (!KEEP) rmSync(COPY, { recursive: true, force: true });
}

main().then(() => {
  const w = (x, n) => String(x).padEnd(n);
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\n번짐 — 진짜 Chromium + 가짜 스마트에디터 · ${MUT ? "변이 " + MUT : "원판"} · ${new Date().toISOString()}\n${"─".repeat(126)}`);
  for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 70)} ${r.note}`);
  console.log(`${"─".repeat(126)}`);
  console.log(fail ? `🔴 실패 ${fail}개` : `✅ ${out.length}축 통과`);
  console.log("⚠️ 가짜 에디터는 네이버가 아니다 — 초록은 «러너 논리가 contenteditable 위에서 안 번진다»까지다.");
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error("🔴 하니스 자체 오류:", e); process.exit(4); });
