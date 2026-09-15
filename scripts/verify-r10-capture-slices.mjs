/**
 * scripts/verify-r10-capture-slices.mjs — 🔴 **캡처 자르기를 격자로 잰다**(C · R10-1 · 2026-09-16 · 순수 · 브라우저 0 · 네트워크 0).
 *   사용: node scripts/verify-r10-capture-slices.mjs
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   B2 의 자는 자기가 고른 표본(보통 글 3~4장)을 지킨다. 이 자는 **높이 축을 통째로 돌린다**:
 *   0 · 음수 · NaN · 문자열 · 뷰포트보다 짧은 글 · 경계값(1.5 화면) · 보통 · 긴 글 · 12,000 · 100,000.
 *   그리고 조각마다 부등호 넷만 본다 — 🔴 **①페이지 밖으로 안 나간다 ②구멍이 없다(겹침 ≥ 0) ③겹침은 10~15% ④2~6장(짧은 글만 1장)**.
 *   사장님 지시 그대로: 폰 폭 430 · 한 조각 ≈ 폰 화면 1.5개 · 2~6장 · 10~15% 겹침 · 6장 넘으면 처음·중간·끝.
 *
 *   ══ 자를 먼저 찌른다 ══
 *   «옛 식»(겹침 없이 4등분)을 같은 격자에 넣어 빨강이 나오는지 본다 — 안 나오면 이 격자는 아무것도 못 잡는다.
 *
 *   ⚠️ B2 가 `runner/lib/capture-slice.mjs`(`planCaptureSlices(pageHeight, opts)`) 를 만들기 전에는 **열림**이다(종료코드 1).
 */
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "runner", "lib", "capture-slice.mjs");
const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

const PHONE_W = 430;
const VIEWPORT_H = 932;
const ONE_AND_HALF = Math.round(VIEWPORT_H * 1.5);   // ≈1,398 — «한 조각 ≈ 폰 화면 1.5개»

const HEIGHTS = [0, -1, NaN, "abc", null, undefined, 300, 900, ONE_AND_HALF - 1, ONE_AND_HALF, ONE_AND_HALF + 1, 2000, 2800, 4200, 6000, 8400, 12000, 30000, 100000];

/**
 * 격자 하나 — 어떤 자르기 함수든 같은 부등호로 잰다(제품 함수도 «옛 식»도).
 *   반환: { bad:[…], n, why 없는 것 }
 */
function grade(fn, label) {
  const bad = [];
  let n = 0, noWhy = 0;
  for (const h of HEIGHTS) {
    n++;
    let r = null, threw = null;
    try { r = fn(h, { width: PHONE_W, viewportHeight: VIEWPORT_H }); } catch (e) { threw = e; }
    const finite = Number.isFinite(Number(h)) && Number(h) > 0 && typeof h !== "string" && h !== null && h !== undefined;
    if (!finite) {
      /* 모르는 입력 — 던지든 0장을 내든 되지만 **NaN 조각**을 내거나 «왜»를 안 적으면 안 된다(AC-9). */
      if (threw) continue;
      const slices = Array.isArray(r?.slices) ? r.slices : [];
      if (slices.some((s) => !Number.isFinite(s.y) || !Number.isFinite(s.h))) bad.push(`${String(h)}: NaN 조각`);
      if (slices.length && !String(r?.why ?? "").trim()) bad.push(`${String(h)}: 모르는 입력인데 why 가 없다`);
      continue;
    }
    if (threw) { bad.push(`${h}: 던짐(${String(threw.message).slice(0, 40)})`); continue; }
    const H = Number(h);
    const slices = Array.isArray(r?.slices) ? [...r.slices].sort((a, b) => a.y - b.y) : [];
    if (!String(r?.why ?? "").trim()) noWhy++;
    if (!slices.length) { bad.push(`${H}: 조각 0`); continue; }
    if (slices.length > 6) bad.push(`${H}: ${slices.length}장 > 6`);
    if (H > ONE_AND_HALF && slices.length < 2) bad.push(`${H}: 긴데 ${slices.length}장(2~6 이어야)`);
    if (H <= VIEWPORT_H && slices.length !== 1) bad.push(`${H}: 뷰포트보다 짧은데 ${slices.length}장(1장이어야 — 같은 화면을 두 번 읽는다)`);
    for (const s of slices) {
      if (s.y < 0 || s.h <= 0) bad.push(`${H}: y=${s.y} h=${s.h}`);
      if (s.y + s.h > H + 1) bad.push(`${H}: 조각 끝 ${s.y + s.h} > 페이지 ${H}(페이지 밖)`);
      if (s.w !== undefined && s.w !== PHONE_W) bad.push(`${H}: 폭 ${s.w} ≠ ${PHONE_W}`);
      if (r.width !== undefined && r.width !== PHONE_W) bad.push(`${H}: width ${r.width} ≠ ${PHONE_W}`);
    }
    const first = slices[0], last = slices[slices.length - 1];
    if (first.y > 1) bad.push(`${H}: 첫 조각이 0 에서 안 시작(${first.y})`);
    if (last.y + last.h < H - 1) bad.push(`${H}: 마지막 조각이 끝에 안 붙는다(${last.y + last.h} < ${H})`);
    const sampled = /처음|중간|끝|건너|표본|sample|skip/i.test(String(r?.why ?? ""));
    for (let i = 0; i + 1 < slices.length; i++) {
      const a = slices[i], b = slices[i + 1];
      const overlap = a.y + a.h - b.y;
      if (overlap < 0 && !sampled) bad.push(`${H}: ${i}↔${i + 1} 구멍 ${-overlap}px(겹침 음수 · why 에 «건너뜀»도 없다)`);
      if (overlap >= 0 && !sampled) {
        const pct = overlap / a.h;
        if (pct < 0.10 - 0.005 || pct > 0.15 + 0.005) bad.push(`${H}: ${i}↔${i + 1} 겹침 ${(pct * 100).toFixed(1)}%(10~15% 아님)`);
      }
    }
    /* 결정적인가 — 같은 입력이면 같은 조각(재시도가 다른 장수를 만들면 «왜 달라졌나»를 못 쫓는다) */
    try { const again = fn(h, { width: PHONE_W, viewportHeight: VIEWPORT_H }); if (JSON.stringify(again?.slices) !== JSON.stringify(r?.slices)) bad.push(`${H}: 두 번 불러 다른 조각`); } catch { /* 위에서 잡힌다 */ }
  }
  return { bad, n, noWhy };
}

/* ═══ «옛 식» — 겹침 없는 4등분(사장님이 «2분할·4분할» 이라 말씀하신 것을 글자 그대로 구현하면 이렇게 된다) ═══ */
const naive = (h) => {
  const H = Number(h) || 0;
  const n = 4, each = Math.ceil(H / n);
  return { slices: Array.from({ length: n }, (_, i) => ({ y: i * each, h: Math.min(each, H - i * each), index: i })), count: n, overlapPct: 0, why: "" };
};

(async () => {
  /* ⓪ 자를 먼저 찌른다 */
  {
    const g = grade(naive, "옛 식");
    rec("⓪ 🔴 이 격자가 «옛 식»(겹침 0 · 무조건 4장)을 잡나", g.bad.length > 0, g.bad.length ? `옛 식을 넣으면 ${g.bad.length}건이 잡힌다 — 자에 이가 있다(예: ${g.bad[0]})` : "🔴 옛 식을 넣어도 안 잡힌다 — 이 격자는 아무것도 못 잡는다");
  }

  if (!existsSync(FILE)) {
    rec("① runner/lib/capture-slice.mjs 가 있다(R10-1 · B2)", false, "🔴 없음 — 열림(캡처 자르기 미착)");
  } else {
    let mod = null;
    try { mod = await import(pathToFileURL(FILE).href); } catch (e) { rec("① capture-slice.mjs 로드", false, String(e.message).slice(0, 160)); }
    if (mod) {
      const fn = mod.planCaptureSlices;
      rec("① planCaptureSlices 가 export 돼 있다", typeof fn === "function", typeof fn === "function" ? "있다" : `🔴 없음 — export: ${Object.keys(mod).join(", ")}`);
      rec("① PHONE_WIDTH = 430(사장님이 못 박은 폰 폭)", mod.PHONE_WIDTH === PHONE_W, `PHONE_WIDTH=${String(mod.PHONE_WIDTH)}`);
      if (typeof fn === "function") {
        const g = grade(fn, "제품");
        rec(`② 🔴 높이 격자 ${g.n}개 — 페이지 밖 0 · 구멍 0 · 겹침 10~15% · 2~6장(짧은 글 1장) · 끝에 붙음 · 결정적`, g.bad.length === 0,
          g.bad.length ? `🔴 ${g.bad.length}건 — ${g.bad.slice(0, 5).join(" · ")}` : `${g.n}높이 전부 통과`);
        rec("③ 모든 답에 «왜 이 장수인가»(why)가 있다(AC-9 · 못 잰 것도 여기 적는다)", g.noWhy === 0, g.noWhy ? `🔴 why 없는 답 ${g.noWhy}개` : "전부 있다");
        /* ④ B2 가 스스로 짚은 두 자리 */
        try {
          const short = fn(300, { width: PHONE_W, viewportHeight: VIEWPORT_H });
          rec("④a 뷰포트보다 짧은 글(300px) → 1장 + why(«최소 2장» 규칙과 안 싸운다)", Array.isArray(short?.slices) && short.slices.length === 1 && !!String(short?.why ?? "").trim(), `count=${short?.slices?.length} why=«${String(short?.why ?? "").slice(0, 60)}»`);
        } catch (e) { rec("④a 뷰포트보다 짧은 글", false, `던짐 ${String(e.message).slice(0, 80)}`); }
        try {
          const long = fn(12000, { width: PHONE_W, viewportHeight: VIEWPORT_H });
          const sl = [...(long?.slices ?? [])].sort((a, b) => a.y - b.y);
          let negative = 0;
          for (let i = 0; i + 1 < sl.length; i++) if (sl[i].y + sl[i].h - sl[i + 1].y < 0) negative++;
          const declared = /처음|중간|끝|건너|표본/.test(String(long?.why ?? ""));
          rec("④b 아주 긴 글(12,000px) → 6장 상한에서 겹침이 음수가 되지 않거나, 됐으면 why 에 «건너뜀»이 적혀 있다", sl.length <= 6 && (negative === 0 || declared), `count=${sl.length} 구멍=${negative} why=«${String(long?.why ?? "").slice(0, 60)}»`);
        } catch (e) { rec("④b 아주 긴 글", false, `던짐 ${String(e.message).slice(0, 80)}`); }
      }
    }
  }

  const w = (x, n) => String(x).padEnd(n);
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\n캡처 자르기 — 높이 격자 · ${new Date().toISOString()}\n${"─".repeat(126)}`);
  for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 74)} ${r.note}`);
  console.log(`${"─".repeat(126)}`);
  console.log(fail ? `🔴 실패 ${fail}개` : `✅ ${out.length}축 통과`);
  console.log("⚠️ 이 자는 **순수 함수**만 잰다 — «러너가 정말 그 조각으로 찍나»·«찍은 파일을 버리나»는 verify-r10-ref-leak 의 정적 축과 라이브 몫이다.");
  process.exit(fail ? 1 : 0);
})();
