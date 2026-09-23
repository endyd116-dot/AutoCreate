/**
 * lib/ai-models-sync.ts — 🔴 **«정본 동기화» — DB 오버레이를 파일로 되돌리는 PR 을 만든다**(계약 P1R8-B §4.5 E5 · DESIGN §890).
 *   🔎 출처: AC 신규(계약 P1R8-B §4.5 E5 · 생성 커밋 `4589d4d` 2026-09-16) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *
 *   ══ 무엇을 푸는가 ══
 *     모델 이름의 정본은 **파일 하나**다(`lib/ai-models.ts` · CLAUDE §2 «한 파일에만»).
 *     그런데 급할 때는 DB `ai_model_overrides` 로 **배포 없이** 덮어쓴다 — 그게 이 구조의 값이다.
 *     🔴 **그대로 두면 파일과 DB 가 갈라진 채 굳는다.** 다음 사람이 파일을 읽고 «이게 지금 쓰는 모델»이라 믿는데
 *        실제로는 석 달 전 DB 로 덮어쓴 값이 돌고 있다. 그 순간 «파일이 정본»은 거짓말이 된다.
 *     ⇒ 분기마다 **오버레이를 파일에 굽는다**: 지금 DB 값으로 파일을 고치는 **PR 을 만들고**, 사람이 보고 머지한다.
 *
 *   ══ 🔴 범위 셋(메인이 못 박음) ══
 *     ① **PR 을 만드는 것까지다. 머지는 사람이 한다** — 모델을 바꾸는 건 되돌리기 어려운 쪽이다.
 *     ② **토큰이 없으면 «키 꽂으면 즉시»로 정직하게 닫아 둔다**(`not_configured` · CLAUDE §8). 조용히 성공한 척하지 않는다.
 *     ③ **PR 생성은 대외 동작이다**(AC-50) — 코드는 완성해 두되 실제로 쏘는 것은 사람이 누를 때다.
 *
 *   ══ 🔴 값이 세 군데서 온다는 사실을 숨기지 않는다 ══
 *     `chain(process.env.GEMINI_CHAIN_HIGH, "기본값")` — **env 가 있으면 파일 기본값은 안 쓰인다.**
 *     그래서 갈림 보고는 «env 가 켜져 있나»를 **같이** 말한다. 안 그러면 PR 을 머지해도 **아무것도 안 바뀐다**(제일 나쁜 종류).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { AI_ROLE_SPECS } from "./ai-models";

/** 🔴 정본은 `AI_ROLE_SPECS`(`lib/ai-models.ts`) 다 — 여기서 역할 목록을 **다시 적지 않는다**(AC-256). */
export type SyncRole = string;

/**
 * 역할 → 파일에서 그 값이 사는 **상수 이름**(= 고칠 때의 닻).
 * 🔴 모델 **이름**을 여기 적지 않는다(§4.9) — 적는 것은 «어느 자리인가»뿐이다.
 *
 *   ══ 🔴 [AC-256 · 2026-09-23] 닻을 «env 이름»에서 «상수 이름»으로 바꿨다 ══
 *     종전 닻은 `chain(process.env.<ENV>, "…")` 한 모양뿐이라 **다섯 역할만** 잡혔다.
 *     그런데 AC-252 에서 오버레이를 **열한 역할**로 넓혔다 ⇒ 나머지 여섯은 DB 로 덮어써도
 *     🔴 **정본 동기화가 영영 안 굽는다.** 파일과 DB 가 갈라진 채 굳는 것이 바로 이 파일이 막으려던 그 일이다.
 *     ⚠️ **내가 AC-252 에서 만든 구멍**이다 — 문을 넓히면서 그 문으로 들어온 것을 치우는 쪽을 안 넓혔다.
 *
 *     파일 안 모양이 **셋**이라 env 로는 못 덮는다:
 *       ① `chain(process.env.E, "a,b,c")` — 한 상수에 사슬 전체
 *       ② `process.env.E || process.env.F || "lit"` — 한 상수에 모델 하나 · **env 가 둘**
 *       ③ `const FAL_MODEL_WAN = "…"` — 🔴 **env 가 아예 없다**(fal 게이트웨이 셋)
 *     ⇒ 상수 이름이면 셋 다 닿는다. 그리고 **`envNames` 는 그 선언문에서 읽어 낸다**(손으로 안 적는다).
 *
 *   ⚠️ **여기 없는 역할은 «못 굽는다»고 말한다** — `AI_ROLE_SPECS` 에 열두 번째가 생기면
 *      조용히 빠지는 게 아니라 `missed` 에 뜬다(AC-9 «못 쟀음»을 통과로 쓰지 않는다).
 */
const ANCHORS: Record<string, { consts: string[]; shape: "chain" | "single"; envs: string[]; label?: string }> = {
  high:      { consts: ["CHAIN_HIGH"],        shape: "chain",  envs: ["GEMINI_CHAIN_HIGH"],     label: "복잡한 판단" },
  low:       { consts: ["CHAIN_LOW"],         shape: "chain",  envs: ["GEMINI_CHAIN_LOW"],      label: "간단·대량" },
  director:  { consts: ["CHAIN_DIRECTOR"],    shape: "chain",  envs: ["GEMINI_CHAIN_DIRECTOR"], label: "디렉터" },
  landing:   { consts: ["CHAIN_LANDING_GEN"], shape: "chain",  envs: ["GEMINI_CHAIN_LANDING"],  label: "랜딩·스토리" },
  image:     { consts: ["CHAIN_IMAGE"],       shape: "chain",  envs: ["GEMINI_MODEL_IMAGE"] },
  /* 🔴 여기부터가 AC-256 에서 닿게 된 여섯 — 여태 «구울 수 없던» 자리다. */
  tts:       { consts: ["MODEL_TTS"],        shape: "single", envs: ["GEMINI_MODEL_TTS"] },
  /* ⚠️ 폴백 env 까지 적는다 — 둘째를 빠뜨리면 «머지해도 안 바뀝니다»를 **못 말한다**(제일 나쁜 종류). */
  vision:    { consts: ["MODEL_VISION"],     shape: "single", envs: ["GEMINI_MODEL_VISION", "GEMINI_MODEL_FLASH"] },
  videoRead: { consts: ["MODEL_VIDEO_READ"], shape: "single", envs: ["GEMINI_MODEL_VIDEO_READ", "GEMINI_MODEL"] },
  videoOmni: { consts: ["MODEL_OMNI"],       shape: "single", envs: ["GEMINI_MODEL_OMNI"] },
  /* 🔴 사슬 하나가 **상수 셋**에 흩어져 있다 — 순서가 곧 사슬 순서다(바꾸면 등급이 뒤섞인다). */
  videoVeo:  { consts: ["MODEL_VEO", "MODEL_VEO_FAST", "MODEL_VEO_LITE"], shape: "single",
               envs: ["GEMINI_MODEL_VEO", "GEMINI_MODEL_VEO_FAST", "GEMINI_MODEL_VEO_LITE"] },
  /* ⚠️ env 가 아예 없다 — 그래서 «머지해도 안 바뀝니다» 경고가 안 뜬다(뜰 까닭이 없다). */
  videoFal:  { consts: ["FAL_MODEL_WAN", "FAL_MODEL_HAILUO", "FAL_MODEL_KLING"], shape: "single", envs: [] },
};

/** 역할 → 라벨·지금 런타임 값. 🔴 **`AI_ROLE_SPECS` 에서 파생한다** — 목록을 두 벌 두지 않는다(AC-252 가 만든 표가 정본). */
const ROLES: Record<string, { consts: string[]; shape: "chain" | "single"; envs: string[]; runtime: string[]; label: string }> =
  Object.fromEntries(AI_ROLE_SPECS.map((s) => {
    const a = ANCHORS[s.role];
    return [s.role, { consts: a?.consts ?? [], shape: a?.shape ?? "single", envs: a?.envs ?? [], runtime: [...s.codeChain], label: a?.label ?? s.label }];
  }));

/**
 * 한 상수의 **선언문 전체**를 떼어 낸다 — `export const NAME` 부터 문자열 밖의 첫 `;` 까지.
 *   🔴 정규식으로 한 줄만 긁지 않는다: `chain(...)` 은 **두 줄**에 걸쳐 있고, 한 줄만 보면 그 자리를 못 찾는다.
 *   🔴 문자열 안의 `;` 에 안 속게 **글자를 걸어서** 센다(AC-178 — 이 함수가 파서의 대용물인 것은 맞지만, **알고 쓴다**:
 *      템플릿 리터럴·주석 안의 `;` 에는 틀릴 수 있다. 이 파일엔 둘 다 없고, **못 찾으면 `null` 을 내서 `missed` 로 간다**).
 *   ⚠️ 같은 이름이 **두 번** 나오면 `null` — «어느 쪽인가»를 우리가 고르지 않는다.
 */
export function declOf(src: string, name: string): { start: number; end: number; text: string } | null {
  /* 🔴 **이름이 이름의 앞토막이면 안 된다** — `MODEL_VEO` 로 찾으면 `MODEL_VEO_FAST`·`MODEL_VEO_LITE` 가 같이 걸린다.
     실제로 그랬다(2026-09-23 실측): 셋을 «같은 이름이 세 번 나온다»로 읽고 `videoVeo` 를 통째로 `missed` 로 냈다.
     ⚠️ 그 실패는 **조용하지 않았다**(missed 로 떴다) — 그게 이 파일의 «못 찾으면 말한다» 규율이 한 일이다.
     🔴 그러나 그 탓에 **변이 시험이 거짓 통과**했다(대조군이 이미 빨강이라 변이가 아무것도 안 바꿨다 · AC-161). */
  const ident = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);
  const needle = `export const ${name}`;
  const at = (from: number): number => {
    for (let k = src.indexOf(needle, from); k >= 0; k = src.indexOf(needle, k + 1)) if (!ident(src[k + needle.length])) return k;
    return -1;
  };
  const first = at(0);
  if (first < 0 || at(first + 1) >= 0) return null;   // 없거나 둘 이상 — 둘 다 «모른다»
  let i = first, inStr = false, quote = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; continue; }
    if (c === ";") return { start: first, end: i + 1, text: src.slice(first, i + 1) };
  }
  return null;
}

/** 선언문 안의 문자열 리터럴 위치(큰따옴표만 — 이 파일의 모델 값은 전부 `"…"` 다). */
function literalsIn(decl: string): { at: number; len: number; value: string }[] {
  const out: { at: number; len: number; value: string }[] = [];
  for (let i = 0; i < decl.length; i++) {
    const c = decl[i];
    if (c === "'" || c === "`") { const qq = c; for (i++; i < decl.length && decl[i] !== qq; i++) if (decl[i] === "\\") i++; continue; }
    if (c !== '"') continue;
    const s = i;
    for (i++; i < decl.length && decl[i] !== '"'; i++) if (decl[i] === "\\") i++;
    out.push({ at: s, len: i - s + 1, value: decl.slice(s + 1, i) });
  }
  return out;
}

/** 선언문이 읽는 env 이름 전부 — 🔴 **손으로 안 적는다**(둘째·셋째 폴백을 빠뜨리면 «머지해도 안 바뀐다»를 못 말한다). */
function envNamesIn(decl: string): string[] {
  const out: string[] = [];
  const re = /process\.env\.([A-Z0-9_]+)/g;
  for (let m = re.exec(decl); m; m = re.exec(decl)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export interface DriftRow {
  role: SyncRole; label: string;
  /** 지금 코드가 쓰는 값(파일 기본값 또는 env). */
  code: string[];
  /** DB 오버레이가 말하는 값(없으면 null). */
  db: string[] | null;
  /** 카나리 중인 후보(있으면 아직 «정하지 않은» 값이다 — 굽지 않는다). */
  candidate: string[] | null;
  canaryPct: number;
  /** 같은가(오버레이가 없으면 «같다»로 본다 — 덮어쓴 적이 없다). */
  same: boolean;
  /** 🔴 env 가 켜져 있나 — 켜져 있으면 **PR 을 머지해도 안 바뀐다**. */
  envSet: boolean;
  /** 켜져 있는 env 이름들(없으면 첫째 이름 · env 가 아예 없는 역할이면 빈 문자열). 화면·PR 본문이 이걸 그대로 적는다. */
  envName: string;
  /** [AC-256] 이 역할이 읽는 env **전부**(폴백 포함). 🔴 `vision` 처럼 둘째 env 가 있으면 그것도 머지를 무력화한다. */
  envNames: string[];
  /** [AC-256] 🔴 **구울 자리를 아는가** — `false` 면 오버레이가 갈려도 PR 로 못 굽는다(`AI_ROLE_SPECS` 에만 있고 닻이 없는 역할). */
  bakeable: boolean;
  /** [AC-256] `probe:"none"` — 텍스트로 못 재는 역할(영상·게이트웨이). 화면이 «사람이 1컷 실증» 을 그대로 말한다. */
  probeNone: boolean;
}

export interface DriftReport {
  /** 굽어야 할 것이 있나. */
  drifted: boolean;
  rows: DriftRow[];
  /** 🔴 카나리 중인 역할 — «아직 정하지 않은 값»이라 굽지 않는다(그 값이 파일에 박히면 시험이 끝난 척이 된다). */
  canaryRoles: SyncRole[];
  /** 🔴 env 로 덮인 역할 — PR 을 머지해도 안 바뀐다. */
  envMasked: SyncRole[];
  /** [AC-256] 🔴 **갈렸는데 구울 자리를 모르는 역할** — 조용히 빠지지 않게 밖으로 낸다(AC-9). */
  unbakeable: SyncRole[];
  /** [AC-256] 재는 모수 — 화면이 «열한 역할 중 몇» 을 말할 수 있게(AC-141② 모수 0 을 통과로 쓰지 않는다). */
  roleCount: number;
}

const arrEq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * driftReport — 🔴 **읽기만 한다.** 지금 파일(런타임)과 DB 오버레이가 갈라져 있나.
 *   오버레이 행이 하나도 없으면 `drifted:false` — 덮어쓴 적이 없으니 파일이 정본 그대로다.
 */
export async function driftReport(): Promise<DriftReport> {
  let rows: Record<string, unknown>[] = [];
  try { rows = await q(sql`SELECT role, chain, candidate, canary_pct FROM ai_model_overrides`); }
  catch (e) { console.warn("[ai-models-sync] 오버레이 조회 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
  const byRole = new Map(rows.map((r) => [String(r.role), r]));
  const out: DriftRow[] = [];
  const probeNoneOf = new Map(AI_ROLE_SPECS.map((s) => [s.role, s.probe === "none"]));
  for (const role of Object.keys(ROLES) as SyncRole[]) {
    const meta = ROLES[role];
    const r = byRole.get(role);
    const db = r && Array.isArray(r.chain) && (r.chain as unknown[]).length ? (r.chain as unknown[]).map(String) : null;
    const candidate = r && Array.isArray(r.candidate) && (r.candidate as unknown[]).length ? (r.candidate as unknown[]).map(String) : null;
    out.push({
      role, label: meta.label, code: meta.runtime, db, candidate,
      canaryPct: r ? Math.max(0, Math.min(100, Number(r.canary_pct ?? 100))) : 100,
      same: !db || arrEq(db, meta.runtime),
      /* 🔴 [AC-256] 폴백 env 까지 본다 — `vision` 은 `GEMINI_MODEL_FLASH` 하나만 켜져 있어도 머지가 무력해진다. */
      envSet: meta.envs.some((e) => !!String(process.env[e] ?? "").trim()),
      envName: meta.envs.filter((e) => !!String(process.env[e] ?? "").trim()).join(", ") || meta.envs[0] || "",
      envNames: meta.envs,
      bakeable: meta.consts.length > 0,
      probeNone: probeNoneOf.get(role) === true,
    });
  }
  return {
    drifted: out.some((x) => !x.same),
    rows: out,
    canaryRoles: out.filter((x) => x.candidate && x.canaryPct < 100).map((x) => x.role),
    envMasked: out.filter((x) => x.envSet && !x.same).map((x) => x.role),
    /* 🔴 갈렸는데 닻이 없는 것 — «조용히 안 구워짐» 대신 이름을 댄다. */
    unbakeable: out.filter((x) => !x.same && !x.bakeable).map((x) => x.role),
    roleCount: out.length,
  };
}

/**
 * applyToSource — 파일 본문에서 그 역할의 **기본값 문자열만** 바꾼다.
 *   🔴 파일을 다시 만들지 않는다 — 그 파일엔 주석으로 남긴 **이유**가 가득하고(«lite 를 헤드에 두는 것이 이 체인의 목적»),
 *      기계가 다시 쓰면 그 이유가 통째로 사라진다. 바꾸는 것은 **따옴표 안 한 줄**뿐이다.
 *   @returns 바뀐 본문과 실제로 바꾼 역할들. 닻을 못 찾으면 그 역할은 **건너뛰고 말한다**(조용히 지나가지 않는다).
 */
export function applyToSource(source: string, drift: DriftReport): { text: string; changed: SyncRole[]; missed: SyncRole[]; envTableDrift: string[] } {
  let text = source;
  const changed: SyncRole[] = [], missed: SyncRole[] = [], envTableDrift: string[] = [];
  for (const row of drift.rows) {
    if (row.same || !row.db) continue;
    /* 🔴 카나리 중이면 굽지 않는다 — 아직 «정하지 않은» 값이다. */
    if (row.candidate && row.canaryPct < 100) continue;
    const meta = ROLES[row.role];
    if (!meta || !meta.consts.length) { missed.push(row.role); continue; }   // 닻이 없는 역할 — 조용히 넘어가지 않는다

    /* 🔴 먼저 **전부 찾고** 나서 고친다 — 셋 중 둘만 바뀐 채 PR 이 나가면
       `videoVeo` 처럼 사슬이 상수 셋에 흩어진 역할이 **등급이 섞인 채** 머지된다. */
    const edits: { at: number; len: number; next: string }[] = [];
    let broken = false;
    for (let i = 0; i < meta.consts.length; i++) {
      const d = declOf(text, meta.consts[i]);
      if (!d) { broken = true; break; }
      const lits = literalsIn(d.text);
      if (!lits.length) { broken = true; break; }
      /* ① `chain(env, "a,b,c")` — 첫 리터럴이 사슬 전체 · ② `env || … || "lit"` · ③ `= "lit"` — **마지막** 리터럴이 값이다. */
      const lit = meta.shape === "chain" ? lits[0] : lits[lits.length - 1];
      const next = meta.shape === "chain" ? row.db.join(",") : (row.db[i] ?? "");
      if (!next) { broken = true; break; }                      // 사슬이 상수 수보다 짧다 — 반만 굽지 않는다
      edits.push({ at: d.start + lit.at, len: lit.len, next });

      /* ⚠️ 표에 적어 둔 env 이름이 **소스와 어긋나면** 말한다 — 안 그러면 «머지해도 안 바뀝니다» 경고가 조용히 틀린다. */
      /* 🔴 표(`ANCHORS.envs`)와 대조한다 — `row.envNames` 가 아니다. 그 행이 `driftReport` 가 아닌 곳에서 왔으면
         행끼리 견주는 꼴이 돼 **표가 낡아도 안 운다**(자기 자신과 견주는 자는 언제나 초록이다). */
      for (const e of envNamesIn(d.text)) if (!meta.envs.includes(e)) envTableDrift.push(`${row.role}:${e}`);
    }
    if (broken) { missed.push(row.role); continue; }

    /* 뒤에서부터 갈아 끼운다 — 앞을 먼저 바꾸면 뒤 자리 번호가 밀린다. */
    for (const e of [...edits].sort((a, b) => b.at - a.at)) {
      text = text.slice(0, e.at) + JSON.stringify(e.next) + text.slice(e.at + e.len);
    }
    changed.push(row.role);
  }
  return { text, changed, missed, envTableDrift: [...new Set(envTableDrift)] };
}

/** 사람이 PR 에서 읽을 본문 — «무엇이 왜 바뀌나»를 표로. */
export function prBody(drift: DriftReport, changed: SyncRole[]): string {
  const line = (r: DriftRow) => `| ${r.role}(${r.label}) | \`${r.code.join(", ")}\` | \`${(r.db ?? []).join(", ")}\` | ${r.envSet ? `⚠️ \`${r.envName}\` 가 켜져 있어 **머지해도 안 바뀝니다**` : "—"} |`;
  const rows = drift.rows.filter((r) => changed.includes(r.role)).map(line).join("\n");
  const skipped = drift.canaryRoles.length ? `\n\n🔴 **카나리 중이라 굽지 않은 역할**: ${drift.canaryRoles.join(", ")} — 아직 «정하지 않은» 값이라 파일에 박으면 시험이 끝난 척이 됩니다.` : "";
  const masked = drift.envMasked.length ? `\n\n⚠️ **env 로 덮여 있는 역할**: ${drift.envMasked.map((r) => `${r}(\`${(ROLES[r]?.envs ?? []).join("` · `")}\`)`).join(", ")} — 이 PR 을 머지해도 그 역할은 안 바뀝니다. env 를 먼저 비워야 합니다.` : "";
  /* 🔴 [AC-256] 갈렸는데 **구울 자리를 모르는** 역할 — PR 본문에도 적는다. 안 적으면 머지한 사람이 «다 구웠다»고 믿는다. */
  const unbaked = drift.unbakeable.length ? `\n\n🔴 **이 PR 이 굽지 못한 역할**: ${drift.unbakeable.join(", ")} — \`lib/ai-models-sync.ts\` 의 \`ANCHORS\` 에 그 상수 이름이 없습니다. **DB 오버레이가 계속 다릅니다.**` : "";
  return [
    "운영센터에서 **배포 없이** 바꿔 둔 AI 모델 체인을 **파일로 되돌립니다**(정본 동기화 · DESIGN §890).",
    "",
    "🔴 이 PR 을 머지하기 전까지 `lib/ai-models.ts` 는 **지금 돌고 있는 값과 다릅니다** — 파일을 읽은 사람이 틀린 값을 믿게 됩니다.",
    "",
    "| 역할 | 지금 파일 | DB 오버레이(적용 중) | 비고 |",
    "|---|---|---|---|",
    rows || "| — | — | — | 바꿀 것 없음 |",
    skipped,
    masked,
    unbaked,
    "",
    "머지 뒤에는 운영센터에서 그 역할의 오버레이를 지워도 같은 값이 돕니다(파일이 정본으로 돌아옵니다).",
  ].join("\n");
}

/* ═══ GitHub — 🔴 토큰이 없으면 정직하게 닫혀 있다 ═══ */
export interface GithubCfg { token: string; repo: string; branch: string }
/** `GITHUB_TOKEN`(repo 쓰기) · `GITHUB_REPO`(owner/name) · `GITHUB_BRANCH`(기본 main). */
export function githubCfg(): GithubCfg | null {
  const token = String(process.env.GITHUB_TOKEN ?? "").trim();
  const repo = String(process.env.GITHUB_REPO ?? "").trim();
  if (!token || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  return { token, repo, branch: String(process.env.GITHUB_BRANCH ?? "main").trim() || "main" };
}

const FILE_PATH = "lib/ai-models.ts";
async function gh(cfg: GithubCfg, path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let json: Record<string, unknown> = {};
  try { json = (await r.json()) as Record<string, unknown>; } catch { /* 빈 응답 */ }
  return { status: r.status, json };
}

export type SyncPrResult =
  | { ok: true; url: string; branch: string; changed: SyncRole[]; missed: SyncRole[] }
  | { ok: false; step: "not_configured" | "no_drift" | "github" | "anchor"; error: string; detail?: string };

/**
 * openSyncPr — 🔴 **PR 을 연다. 머지는 사람이 한다.**
 *   ① 지금 파일을 **GitHub 에서** 읽는다(번들 안에는 소스가 없다 — 이게 이 기능이 파일을 fs 로 안 읽는 이유다)
 *   ② 기본값 문자열만 바꾼다 ③ 새 가지에 올린다 ④ PR 을 만든다
 */
export async function openSyncPr(drift: DriftReport, byLabel: string): Promise<SyncPrResult> {
  const cfg = githubCfg();
  if (!cfg) return { ok: false, step: "not_configured", error: "GitHub 연결이 아직 등록되지 않았어요(GITHUB_TOKEN·GITHUB_REPO)." };
  if (!drift.drifted) return { ok: false, step: "no_drift", error: "파일과 지금 값이 같아요. 만들 PR 이 없어요." };

  const cur = await gh(cfg, `/contents/${FILE_PATH}?ref=${encodeURIComponent(cfg.branch)}`);
  if (cur.status !== 200 || typeof cur.json.content !== "string") {
    return { ok: false, step: "github", error: "지금 파일을 읽지 못했어요.", detail: `contents ${cur.status}` };
  }
  const source = Buffer.from(String(cur.json.content), "base64").toString("utf8");
  const { text, changed, missed } = applyToSource(source, drift);
  if (!changed.length) {
    return { ok: false, step: "anchor", error: "파일에서 바꿀 자리를 찾지 못했어요. 사람이 확인해 주세요.", detail: missed.join(",") };
  }

  const head = await gh(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const baseSha = ((head.json.object ?? {}) as Record<string, unknown>).sha;
  if (head.status !== 200 || typeof baseSha !== "string") return { ok: false, step: "github", error: "기준 가지를 찾지 못했어요.", detail: `ref ${head.status}` };

  const branch = `sync/ai-models-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`;
  const mk = await gh(cfg, "/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
  if (mk.status >= 300) return { ok: false, step: "github", error: "새 가지를 만들지 못했어요.", detail: `refs ${mk.status}` };

  const put = await gh(cfg, `/contents/${FILE_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore(ai-models): 정본 동기화 — 운영센터 오버레이를 파일로(${changed.join(", ")})`,
      content: Buffer.from(text, "utf8").toString("base64"),
      sha: String(cur.json.sha ?? ""), branch,
    }),
  });
  if (put.status >= 300) return { ok: false, step: "github", error: "파일을 올리지 못했어요.", detail: `contents ${put.status}` };

  const pr = await gh(cfg, "/pulls", {
    method: "POST",
    body: JSON.stringify({
      title: `정본 동기화 — AI 모델 체인(${changed.join(", ")})`,
      head: branch, base: cfg.branch,
      body: `${prBody(drift, changed)}\n\n---\n운영센터에서 ${byLabel} 이(가) 만들었습니다. 🔴 **머지는 사람이 합니다.**`,
    }),
  });
  const url = typeof pr.json.html_url === "string" ? pr.json.html_url : "";
  if (pr.status >= 300 || !url) return { ok: false, step: "github", error: "PR 을 만들지 못했어요.", detail: `pulls ${pr.status}` };
  return { ok: true, url, branch, changed, missed };
}
