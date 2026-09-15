/**
 * lib/ai-models-sync.ts — 🔴 **«정본 동기화» — DB 오버레이를 파일로 되돌리는 PR 을 만든다**(계약 P1R8-B §4.5 E5 · DESIGN §890).
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
import { CHAIN_HIGH, CHAIN_LOW, CHAIN_DIRECTOR, CHAIN_LANDING_GEN, CHAIN_IMAGE } from "./ai-models";

export type SyncRole = "high" | "low" | "director" | "landing" | "image";

/**
 * 역할 → 파일에서 그 값을 만드는 **env 이름**(= 파일을 고칠 때의 닻)과 지금 런타임 값.
 * 🔴 모델 **이름**을 여기 적지 않는다(§4.9) — 적는 것은 «어느 자리인가»뿐이다.
 */
const ROLES: Record<SyncRole, { env: string; runtime: string[]; label: string }> = {
  high:     { env: "GEMINI_CHAIN_HIGH",     runtime: CHAIN_HIGH,        label: "복잡한 판단" },
  low:      { env: "GEMINI_CHAIN_LOW",      runtime: CHAIN_LOW,         label: "간단·대량" },
  director: { env: "GEMINI_CHAIN_DIRECTOR", runtime: CHAIN_DIRECTOR,    label: "디렉터" },
  landing:  { env: "GEMINI_CHAIN_LANDING",  runtime: CHAIN_LANDING_GEN, label: "랜딩·스토리" },
  image:    { env: "GEMINI_MODEL_IMAGE",    runtime: CHAIN_IMAGE,       label: "사진" },
};

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
  envName: string;
}

export interface DriftReport {
  /** 굽어야 할 것이 있나. */
  drifted: boolean;
  rows: DriftRow[];
  /** 🔴 카나리 중인 역할 — «아직 정하지 않은 값»이라 굽지 않는다(그 값이 파일에 박히면 시험이 끝난 척이 된다). */
  canaryRoles: SyncRole[];
  /** 🔴 env 로 덮인 역할 — PR 을 머지해도 안 바뀐다. */
  envMasked: SyncRole[];
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
  for (const role of Object.keys(ROLES) as SyncRole[]) {
    const meta = ROLES[role];
    const r = byRole.get(role);
    const db = r && Array.isArray(r.chain) && (r.chain as unknown[]).length ? (r.chain as unknown[]).map(String) : null;
    const candidate = r && Array.isArray(r.candidate) && (r.candidate as unknown[]).length ? (r.candidate as unknown[]).map(String) : null;
    out.push({
      role, label: meta.label, code: meta.runtime, db, candidate,
      canaryPct: r ? Math.max(0, Math.min(100, Number(r.canary_pct ?? 100))) : 100,
      same: !db || arrEq(db, meta.runtime),
      envSet: !!String(process.env[meta.env] ?? "").trim(), envName: meta.env,
    });
  }
  return {
    drifted: out.some((x) => !x.same),
    rows: out,
    canaryRoles: out.filter((x) => x.candidate && x.canaryPct < 100).map((x) => x.role),
    envMasked: out.filter((x) => x.envSet && !x.same).map((x) => x.role),
  };
}

/**
 * applyToSource — 파일 본문에서 그 역할의 **기본값 문자열만** 바꾼다.
 *   🔴 파일을 다시 만들지 않는다 — 그 파일엔 주석으로 남긴 **이유**가 가득하고(«lite 를 헤드에 두는 것이 이 체인의 목적»),
 *      기계가 다시 쓰면 그 이유가 통째로 사라진다. 바꾸는 것은 **따옴표 안 한 줄**뿐이다.
 *   @returns 바뀐 본문과 실제로 바꾼 역할들. 닻을 못 찾으면 그 역할은 **건너뛰고 말한다**(조용히 지나가지 않는다).
 */
export function applyToSource(source: string, drift: DriftReport): { text: string; changed: SyncRole[]; missed: SyncRole[] } {
  let text = source;
  const changed: SyncRole[] = [], missed: SyncRole[] = [];
  for (const row of drift.rows) {
    if (row.same || !row.db) continue;
    /* 🔴 카나리 중이면 굽지 않는다 — 아직 «정하지 않은» 값이다. */
    if (row.candidate && row.canaryPct < 100) continue;
    const env = ROLES[row.role].env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(chain\\(\\s*process\\.env\\.${env}\\s*,\\s*)"([^"]*)"`);
    if (!re.test(text)) { missed.push(row.role); continue; }
    text = text.replace(re, `$1"${row.db.join(",")}"`);
    changed.push(row.role);
  }
  return { text, changed, missed };
}

/** 사람이 PR 에서 읽을 본문 — «무엇이 왜 바뀌나»를 표로. */
export function prBody(drift: DriftReport, changed: SyncRole[]): string {
  const line = (r: DriftRow) => `| ${r.role}(${r.label}) | \`${r.code.join(", ")}\` | \`${(r.db ?? []).join(", ")}\` | ${r.envSet ? `⚠️ \`${r.envName}\` 가 켜져 있어 **머지해도 안 바뀝니다**` : "—"} |`;
  const rows = drift.rows.filter((r) => changed.includes(r.role)).map(line).join("\n");
  const skipped = drift.canaryRoles.length ? `\n\n🔴 **카나리 중이라 굽지 않은 역할**: ${drift.canaryRoles.join(", ")} — 아직 «정하지 않은» 값이라 파일에 박으면 시험이 끝난 척이 됩니다.` : "";
  const masked = drift.envMasked.length ? `\n\n⚠️ **env 로 덮여 있는 역할**: ${drift.envMasked.map((r) => `${r}(\`${ROLES[r].env}\`)`).join(", ")} — 이 PR 을 머지해도 그 역할은 안 바뀝니다. env 를 먼저 비워야 합니다.` : "";
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
