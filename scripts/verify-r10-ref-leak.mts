/**
 * scripts/verify-r10-ref-leak.mts — 🔴 **레퍼런스가 원문을 새게 하나**(C · R10-2/3 · 2026-09-16 · 순수 · DB 0 · 네트워크 0 · 실호출 0).
 *   사용: npx --yes tsx scripts/verify-r10-ref-leak.mts
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   B 의 자는 «허용 목록에 이 키가 있나·캡이 몇이냐»를 지킨다. 이 자는 **키 이름을 하나도 모르는 척** 한다:
 *   모델이 낼 법한 가짜 응답을 **여섯 가지 모양**으로 지어(원문을 `quotes`·`sentences`·`script`·`transcript`·`body` 에,
 *   허용 칸 전부에, 중첩 안에, 배열 안에, 구조 어휘 자리에, 이모지 자리에) 소독기에 넣고 **저장물을 통째로 문자열로 만든 뒤**
 *   부등호 하나만 본다 — 🔴 **원문 25자 연속이 저장물 어디에도 없다.**
 *   (25자 = 우리 표본 문장 최소 길이(22자)보다 길다. 그보다 짧은 조각은 «문장»이 아니라 «낱말»이다.)
 *
 *   ══ 자를 먼저 찌른다 ══
 *   영상 소독기 `lib/video/reference.ts sanitizeTemplate` 은 캡이 120~240자다 — 설계가 스스로 «블로그 한 문장을 통째로 담는다»(B-1)고
 *   적어 둔 **알려진 약점**이다. 같은 격자에 넣어 **빨강이 나와야** 이 자에 이가 있다.
 *
 *   ⚠️ 글 소독기의 이름은 B 가 정한다 — `lib/**` 에서 «레퍼런스·스타일» 파일의 `export function sanitize*` 를 **스스로 찾는다**(AC-82).
 *      못 찾으면 **열림**(종료코드 1).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { out.push({ step, ok, note }); return ok; };

/* ═══ 원문 — 실제 블로그 문장 꼴(표본 중앙값 83자보다 짧은 44자 · 이것이 통째로 남으면 저작권이다) ═══ */
const SENT = "요즘 전기요금 때문에 고민 많으시죠? 저도 지난달 고지서 보고 깜짝 놀랐어요.";
const SENT2 = "그래서 멀티탭 스위치부터 끄기 시작했는데 한 달 만에 만 원이 줄었습니다.";
const PROSE = `${SENT} ${SENT2} 냉장고 온도를 한 칸 올리고 세탁은 밤에 돌렸어요.`;
const WINDOW = 25;
/** 저장물 문자열에 원문 25자 연속 창이 하나라도 있나. */
function leaks(stored: string, src: string): string | null {
  const s = stored.replace(/\s+/g, " ");
  const p = src.replace(/\s+/g, " ");
  for (let i = 0; i + WINDOW <= p.length; i++) { const win = p.slice(i, i + WINDOW); if (s.includes(win)) return win; }
  return null;
}

/* ═══ 가짜 응답 여섯 모양 ═══ */
const FAKES: Record<string, unknown> = {
  "① 금지된 키에 원문": { quotes: [SENT, SENT2], sentences: [SENT], script: PROSE, transcript: PROSE, body: PROSE, text: PROSE, raw: PROSE,
    paragraphs: [SENT, SENT2], examples: [SENT], sample: SENT, excerpt: SENT, original: SENT, content: PROSE, html: `<p>${SENT}</p>` },
  "② 허용 칸 전부에 통짜 본문": Object.fromEntries(["name", "label", "summary", "tone", "ending", "emoji", "emphasis", "photos", "structure", "layout", "rhythm",
    "paragraph", "title", "hook", "hookPrinciple", "style", "visual", "palette", "caption", "pace", "camera", "goal", "principle", "rules", "notes", "why", "reason",
    "sentenceEnd", "titleShape", "paraLen", "lineBreak", "emojiUse", "emphasisUse", "imageUse", "blocks", "composition", "conclusionFirst", "subheads", "length"]
    .map((k) => [k, PROSE])),
  "③ 중첩 안에 원문": { shape: { paragraph: { note: PROSE, avg: 3 }, emoji: { top: ["✅", SENT], where: PROSE } }, tone: { ending: { note: SENT } }, structure: { order: ["hook", "para"], note: PROSE } },
  "④ 배열 안에 원문": { structure: ["hook", SENT, "para", { label: SENT2, goal: PROSE }], rules: [PROSE, SENT], emoji: [SENT, "✅"], summary: [SENT, SENT2] },
  "⑤ 구조 어휘 자리에 산문": { structure: { stages: [{ label: "hook", goal: PROSE }, { label: SENT, goal: SENT2 }] }, blocks: ["hook", SENT, "para", PROSE] },
  "⑥ 숫자 칸에 문자열 원문": { paragraphs: { avgLines: SENT, avgChars: PROSE }, emojiPerPost: SENT, emphasisCount: SENT2, images: { count: SENT, where: PROSE } },
};

/* ═══ 소독기를 찾는다(이름을 손으로 들지 않는다) ═══ */
function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(ts|mts)$/.test(f)) acc.push(p);
  }
  return acc;
}
const LIB = walk(join(ROOT, "lib"));
const candidates = LIB.filter((p) => !/video[\\/]reference\.ts$/.test(p)).filter((p) => {
  const s = readFileSync(p, "utf8");
  return /export\s+function\s+sanitize\w*/.test(s) && /(레퍼런스|reference|style|스타일|옷장|style_ref|account_style)/i.test(s) && /(문단|이모지|emoji|paragraph|emphasis|강조)/i.test(s);
});

async function gradeSanitizer(label: string, fn: (raw: unknown) => unknown): Promise<{ bad: string[]; maxStr: number }> {
  const bad: string[] = [];
  let maxStr = 0;
  for (const [name, fake] of Object.entries(FAKES)) {
    let res: unknown;
    try { res = fn(fake); } catch (e) { bad.push(`${name}: 던짐 ${String((e as Error).message).slice(0, 40)}`); continue; }
    const stored = JSON.stringify(res ?? null);
    const hit = leaks(stored, PROSE);
    if (hit) bad.push(`${name}: «${hit}» 가 저장물에 있다`);
    /* 저장물 안의 가장 긴 문자열 — «글 축 캡이 블로그 한 문장보다 짧나»의 숫자 */
    const walkStr = (v: unknown) => { if (typeof v === "string") maxStr = Math.max(maxStr, v.length); else if (Array.isArray(v)) v.forEach(walkStr); else if (v && typeof v === "object") Object.values(v as object).forEach(walkStr); };
    walkStr(res);
  }
  return { bad, maxStr };
}

(async () => {
  /* ⓪ 자를 먼저 찌른다 — 영상 소독기(알려진 약점 · 캡 120~240) */
  try {
    const v = await import(pathToFileURL(join(ROOT, "lib", "video", "reference.ts")).href);
    const g = await gradeSanitizer("영상", v.sanitizeTemplate);
    rec("⓪ 🔴 이 격자가 영상 소독기(캡 120~240 · 알려진 약점)를 잡나", g.bad.length > 0,
      g.bad.length ? `잡는다 — ${g.bad.length}모양에서 원문 25자가 남는다(예: ${g.bad[0].slice(0, 70)}) · 가장 긴 저장 문자열 ${g.maxStr}자` : "🔴 영상 소독기도 통과 — 이 격자는 원문을 못 본다(자를 의심하라)");
  } catch (e) { rec("⓪ 영상 소독기 로드", false, String((e as Error).message).slice(0, 120)); }

  /* ① 글 소독기 */
  rec("① 글 레퍼런스 소독기를 lib/** 에서 찾았다(export function sanitize* · 레퍼런스·문단·이모지 낱말)", candidates.length > 0,
    candidates.length ? candidates.map((p) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "")).join(", ") : "🔴 없음 — R10-2/3 미착(열림)");
  for (const p of candidates) {
    let mod: Record<string, unknown> | null = null;
    try { mod = await import(pathToFileURL(p).href); } catch (e) { rec(`① ${p} 로드`, false, String((e as Error).message).slice(0, 120)); continue; }
    const fns = Object.entries(mod!).filter(([k, v]) => /^sanitize/.test(k) && typeof v === "function") as [string, (r: unknown) => unknown][];
    for (const [name, fn] of fns) {
      const g = await gradeSanitizer(name, fn);
      rec(`② 🔴 ${name} — 가짜 응답 ${Object.keys(FAKES).length}모양 전부에서 원문 25자 연속이 저장물에 없다`, g.bad.length === 0,
        g.bad.length ? `🔴 ${g.bad.slice(0, 3).join(" · ")}` : "6모양 전부 원문 0");
      rec(`③ 🔴 ${name} — 가장 긴 저장 문자열이 우리 표본 최소 문장(22자)보다 짧다(«글 축 캡 < 블로그 한 문장»)`, g.maxStr > 0 ? g.maxStr < 22 : true,
        `가장 긴 저장 문자열 ${g.maxStr}자(영상은 120~240)`);
      /* ④ 구조 어휘가 닫혀 있나 — 어휘 밖 문자열이 구조 배열에 남으면 구조가 산문을 실어 나른다 */
      try {
        const r = fn({ structure: ["hook", SENT, "para", "이건어휘밖", "h2"], blocks: ["hook", SENT2] }) as Record<string, unknown>;
        const s = JSON.stringify(r);
        rec(`④ ${name} — 구조 어휘가 닫혀 있다(어휘 밖 문자열이 구조에 안 남는다)`, !s.includes("이건어휘밖") && !leaks(s, SENT), s.slice(0, 120));
      } catch (e) { rec(`④ ${name} 구조 어휘`, false, String((e as Error).message).slice(0, 80)); }
      /* ⑤ 정상 응답은 살아남나(AC-68 — 너무 조여 다 죽는 쪽).
         🔴 표본은 B 가 모델에게 보여 주는 예시 JSON 그대로(`TEXT_STYLE_RAW_EXAMPLE`) — 그게 통과 못 하면 «모델이 시킨 대로 답해도 버려진다». 없으면 내 추정 표본(🟠). */
      try {
        const example = (mod as Record<string, unknown>).TEXT_STYLE_RAW_EXAMPLE;
        const raw = example && typeof example === "object" ? example : typeof example === "string" ? JSON.parse(example) : {
          paragraphs: { avgLines: 3, avgChars: 120 }, emoji: { uses: true, where: "para_start", top: ["✅", "📌", "💡"], perPost: 6 },
          emphasis: { kind: "underline", perPost: 5, on: "number" }, images: { count: 7, captioned: false }, structure: ["hook", "para", "h2", "list", "image", "para"],
          tone: { ending: "haeyo", avgSentenceLen: 38, questionRatio: 0.2 }, title: { hasNumber: true, chars: 24, question: false } };
        const r = fn(raw) as Record<string, unknown>;
        const s = JSON.stringify(r);
        /* 살아남았다 = 이모지 목록·강조 종류·구조 배열이 저장물에 남고, 숫자 칸이 0 으로 뭉개지지 않았다 */
        const nums = (JSON.stringify(raw).match(/:\s*(\d+(\.\d+)?)/g) || []).map((m) => m.replace(/:\s*/, ""));
        const numsKept = nums.filter((n) => new RegExp(`[:\\[,]\\s*${n}(?:[,}\\]])`).test(s)).length;
        const keep = [/✅|📌|💡|[\u{1F300}-\u{1FAFF}]/u.test(s), /underline|bold|line|value|highlight/.test(s), /hook|para|h2/.test(s)].filter(Boolean).length;
        rec(`⑤ ${name} — 정상 응답(${example ? "B 의 예시 JSON 그대로" : "🟠 C 추정 표본"})이 살아남는다 — 이모지·강조·구조 ${keep}/3 · 숫자 ${numsKept}/${nums.length} 보존`, keep >= 2 && (nums.length === 0 || numsKept >= Math.ceil(nums.length * 0.6)), s.slice(0, 160));
      } catch (e) { rec(`⑤ ${name} 정상 응답`, false, String((e as Error).message).slice(0, 80)); }
    }
  }

  /* ⑥ 문이 하나인가 — 저장하는 자리(INSERT/UPDATE 하는 곳)가 소독기를 거치나(정적 · 이름은 위에서 찾은 것) */
  if (candidates.length) {
    const names = new Set<string>();
    for (const p of candidates) for (const m of readFileSync(p, "utf8").matchAll(/export\s+function\s+(sanitize\w*)/g)) names.add(m[1]);
    const writers = [...LIB, ...walk(join(ROOT, "netlify", "functions"))].filter((p) => {
      const s = readFileSync(p, "utf8");
      /* 표 이름은 B 의 DDL 0035 `text_styles`(+ 있을 법한 옛 이름들) — 손으로 든 목록이라 새 표가 생기면 여기도 늘려야 한다(AC-82 · 그래서 «못 찾았다»를 초록으로 안 센다). */
      /* 🔴 «그 표에 쓰는 문장»만 센다 — 표 이름을 읽기만 하는 파일(director·pieces 가 text_style_id 를 join)까지 세면 가짜 빨강이다(첫 판이 그랬다). */
      return /(INSERT\s+INTO|UPDATE)\s+(text_styles|account_styles|style_refs|style_references|text_templates|writing_styles)\b/i.test(s);
    });
    /* 스타일 본문(style 칸)을 쓰는 문장만 소독 대상 — deleted_at 만 바꾸는 UPDATE 는 원문이 안 지난다 */
    const writesStyle = (s: string) => /INSERT\s+INTO\s+text_styles[^;]*\bstyle\b/i.test(s) || /UPDATE\s+text_styles\s+SET[^;]*\bstyle\s*=/i.test(s);
    const unguarded = writers.filter((p) => { const s = readFileSync(p, "utf8"); return writesStyle(s) && ![...names].some((n) => s.includes(n + "(")); });
    rec("⑥ 저장하는 자리마다 소독기를 부른다(문이 하나 · 소독기 없이 INSERT 하는 파일 0)", writers.length > 0 && unguarded.length === 0,
      writers.length ? (unguarded.length ? `🔴 소독 없이 쓰는 파일: ${unguarded.map((p) => p.replace(ROOT, "")).join(", ")}` : `쓰는 파일 ${writers.length}개 전부 소독기 경유`) : "🟠 저장하는 파일을 못 찾았다(표 이름을 모른다 — 사람이 확인)");
  }

  /* ⑦ 캡처가 버려지나(정적 · 러너) — 레퍼런스 캡처 파일을 쓰는 러너 코드는 finally 에서 지우고 R2 에 안 올리고 로그에 URL 을 안 남긴다 */
  {
    const runnerFiles = existsSync(join(ROOT, "runner")) ? walkMjs(join(ROOT, "runner")) : [];
    const capFiles = runnerFiles.filter((p) => { const s = readFileSync(p, "utf8"); return /style-reference|styleReference|reference\.capture|capture-slice|planCaptureSlices/.test(s) && /screenshot\(/.test(s); });
    if (!capFiles.length) rec("⑦ 러너 캡처 코드(screenshot + planCaptureSlices)가 있다", false, "🔴 없음 — R10-1 미착(열림)");
    for (const p of capFiles) {
      const s = readFileSync(p, "utf8");
      const code = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      /* «버린다»의 두 길: ⓐ디스크에 아예 안 쓴다(더 세다 — 지우기는 잊거나 실패한다) ⓑ썼으면 finally 에서 지운다. 둘 중 하나. */
      const writesDisk = /writeFile|writeFileSync|createWriteStream|TMP_DIR|_shots|\bshot\(|failShot\(|path:\s*["'`]/.test(code) || /screenshot\(\{[^}]*\bpath\b/.test(code);
      const finallyCleans = /finally\s*\{[^}]*(unlink|rmSync|rm\(|cleanupFiles|removeSync)/.test(code);
      const noR2 = !/putObject|r2\.|R2_|uploadToR2|upload\(/i.test(code);
      const logsUrl = /console\.(log|error)\([^)]*\b(url|href|finalUrl|title|body|innerText|text|data)\b/i.test(code);
      rec(`⑦ ${p.replace(ROOT, "")} — 캡처를 버린다(디스크 미기록 또는 finally 삭제) · R2 0 · 로그에 URL·제목·본문 0`, (!writesDisk || finallyCleans) && noR2 && !logsUrl,
        `디스크기록=${writesDisk} finally지움=${finallyCleans} R2없음=${noR2} 로그URL=${logsUrl}`);
    }
  }

  const w = (x: unknown, n: number) => String(x).padEnd(n);
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\n레퍼런스 누출 — 원문 25자 창 격자 · ${new Date().toISOString()}\n${"─".repeat(126)}`);
  for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 84)} ${r.note}`);
  console.log(`${"─".repeat(126)}`);
  console.log(fail ? `🔴 실패 ${fail}개 — 저작권이 걸린 자리다.` : `✅ ${out.length}축 통과`);
  process.exit(fail ? 1 : 0);
})();

function walkMjs(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (["node_modules", "profiles", "_shots", "tmp"].includes(f) || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkMjs(p, acc); else if (/\.mjs$/.test(f)) acc.push(p);
  }
  return acc;
}
