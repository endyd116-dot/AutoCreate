/**
 * lib/format-marks.ts — **«못 낸 서식»을 남기고 사람말로 번역한다**(R9-5 · 설계 §2.1e · B · 2026-09-16).
 *   🔎 출처: AC 신규(AM 원본 없음 — AM 은 러너 안에서 `marksDemoted` 로 세고 서버엔 안 남긴다 · 우리는 서버 meta 가 정본).
 *
 *   ══ 왜 ══
 *     채널마다 낼 수 있는 서식이 다르다(네이버는 형광펜 O · 쓰레드는 글자뿐 · 당근 러너는 0건). «배웠는데 이 채널에선 못 낸다»가
 *     글 쪽에도 생긴다 — 영상의 `meta.refUnused` 와 **같은 모양**으로 남겨야 A 가 만든 화면을 **그대로** 쓴다(새로 안 짓는다).
 *
 *   ══ 두 모양 ══
 *     · 저장 `pieces.meta.formatMarks`(내부 · 정본): { planned, applied?, demoted:[{kind, why, sample?, by?}] }
 *         - 생성 때 서버가 planned(종류별 수)·server 강등(범위 오류·상한 초과·채널 false)을 적고
 *         - 발행 뒤 러너 보고(`formatMarks`)를 **append** 한다(applied + runner 강등 · `mergeRunnerFormatMarks`)
 *     · 투영 `pieces-get meta.formatUnused`(사람말): [{ field, label, why, n }] — 영상 `refUnused=[{field,why}]` + `label`.
 *         🔴 `label` 은 **서버 정본**(`MARK_LABEL`·`FIELD_LABEL`) — 화면이 베껴 쓰지 않는다(AC-52). `why` 는 사람말이지만 화면은 안 그린다(AC-91).
 *
 *   ══ 어휘(B2 러너와 글자 그대로 맞춤) ══
 *     why: budget(글당 상한) · too_long · url_para(주소 문단은 링크가 색보다 먼저 · AM #799~801) · channel_unsupported · caret_drift(캐럿 어긋남) ·
 *          range_invalid · overlap · unknown_kind · no_text · no_editor_op(블록을 에디터 요소로 못 내려 글로 풀었다) · channel_unknown
 *     kind: 마크 여섯(value·line·row·bold·underline·italic) 또는 블록 타입(table·checklist·faq·toc·place…)
 *   🔴 순수 함수(DB·네트워크 0). `scripts/verify-format-marks.mts` 가 그대로 돌린다.
 */
import { type Block, type MarkKind, type InlineMark, MARK_KINDS, MARK_LABEL, MARK_BUDGET, type MarkDrop } from "./blocks";   // [R12-5] InlineMark — 문단·목록 항목·표 칸 세 자리를 한 판정기로 훑는다
import { formatCapsOf, canRetract, channelSpec, type FormatCapKey } from "./channel-registry";

export interface MarkDemotion { kind: string; why: string; sample?: string; by?: "server" | "runner" }
/**
 * 세 숫자를 **따로** 든다(B2 2026-09-16): `planned`(모델이 낸 수) → `kept`(상한·채널 표를 먹인 뒤 남은 수) → `applied`(에디터에서 실제로 누른 수).
 *   🔴 `kept` 가 없으면 «상한 때문에 안 냈다»와 «누르려다 실패했다»가 한 숫자로 뭉친다 — 다음 수리가 추측에서 시작한다.
 *   `breaks`/`breakFails` = 러너의 문단 경계 서식 끊기가 몇 번 돌았나/실패했나 — 🔴 `breakFails > 0` 은 «뒤 문단이 앞 서식을 물려받았을 수 있다»는 뜻이라 화면에 값이 있다.
 *   `bleed` = 발행 직전 자가검사가 잰 번진 문단 비율(%) — 🔴 **없으면 «못 쟀다»**이지 «깨끗»이 아니다(키를 지어내지 않는다 · AC-92).
 */
export interface FormatMarks {
  /** 모델이 내려던 수(검증 뒤 · 상한 전). */
  planned: Partial<Record<MarkKind, number>>;
  /** 상한·채널 표를 먹인 뒤 실제로 내려보낸 수(서버). */
  kept?: Partial<Record<MarkKind, number>>;
  /** 러너가 실제로 누른 수(발행 뒤 · 없으면 아직 보고 전 · API 채널은 kept 가 곧 applied). */
  applied?: Partial<Record<string, number>>;
  demoted: MarkDemotion[];
  breaks?: number;
  breakFails?: number;
  /** 발행 직전 자가검사(`runner/lib/format-bleed.mjs`) — 번진 문단 비율(pct)과 증상별 수(red·center·italic·underline·bold). 🔴 키가 없으면 «못 쟀다»(러너가 null 을 보내면 키를 안 만든다 · 0 으로 넣으면 화면이 «깨끗했다»로 읽는다).
   *  🔴 `bold` 는 2026-09-16 부터 세기 시작한 축 — 옛 글엔 키가 없고 그건 «0건»이 아니라 «그때는 안 쟀다»다(`?? 0` 로 읽지 않는다 · AC-92).
   *  🔴 러너의 `samples`(번진 문단의 실물 조각)는 **여기 싣지 않는다** — 실물 예시는 **러너 로그에만 있다**(B2 합의 · meta 를 무겁게 하지 않는다 · «왜 예시 문단이 안 보이지»의 답이 이 줄이다). */
  bleed?: { pct: number; total?: number; bad?: number; red?: number; center?: number; italic?: number; underline?: number; bold?: number };
  /** [R9-11] 티스토리가 HTML 모드를 못 열어 기본 모드로 내려앉은 횟수 — 🔴 0 이면 키를 안 만든다(B2 · 강등 자체는 `demoted[{kind:블록, why:"no_editor_op"}]` 로 같이 온다). */
  htmlMode?: number;
  /** 러너 보고를 받은 시각(UTC ISO) — 있으면 «발행 뒤 본 것»이다. */
  runnerReportedAt?: string;
}

/** 사람말 라벨 — 마크 여섯 + 블록 요소. 화면 칩 정본(AC-52). 모르는 키는 키 그대로 돌려준다(지어내지 않는다). */
export const FIELD_LABEL: Record<string, string> = {
  ...MARK_LABEL,
  emoji: "이모지", quote: "인용", table: "표", list: "목록", checklist: "체크리스트", faq: "자주 묻는 질문", toc: "목차", divider: "구분선", image: "사진",
  place: "장소·링크 카드", h2: "소제목", h3: "작은 소제목", summary: "요약", tip: "한 줄 팁", hashtags: "해시태그", affiliate: "제휴 링크", adsense: "광고 자리",
  color: "글자색", align: "가운데 정렬", hook: "첫 줄",
};
export function fieldLabelOf(kind: string): string { return FIELD_LABEL[kind] ?? String(kind); }

/**
 * 사유 → 사람말(CLAUDE §3: ①사실 ②어떻게 ③우리가 대신 해 준 것 · 위협·책임 전가 0).
 *   🔴 «못 낸 것»은 글자를 잃은 게 아니다 — 꾸밈만 빠지고 글자는 그대로다. 문장이 그걸 먼저 말한다.
 */
export const WHY_SAY: Record<string, string> = {
  channel_unsupported: "이 채널에서는 낼 수 없는 꾸밈이라 글자만 그대로 실었어요.",
  channel_unknown: "이 채널에서 되는지 아직 몰라서 그대로 올려 봤어요 — 결과를 여기에 적어 드려요.",
  budget: "한 글에 너무 많으면 오히려 읽기 어려워서 앞쪽 몇 곳만 남겼어요.",
  too_long: "너무 긴 구간이라 그 꾸밈은 뺐어요 — 글자는 그대로예요.",
  url_para: "주소가 든 문단은 링크가 먼저라 꾸밈을 뺐어요.",
  caret_drift: "편집기에서 자리를 정확히 못 잡아 그 꾸밈은 뺐어요 — 글자는 그대로예요.",
  range_invalid: "글자 위치가 맞지 않아 그 꾸밈은 뺐어요.",
  overlap: "겹치는 꾸밈이라 하나만 남겼어요.",
  unknown_kind: "우리가 모르는 꾸밈이라 뺐어요.",
  no_text: "글자가 없는 자리에 붙은 꾸밈이라 뺐어요.",
  /* 🔴 둘은 다른 사실이다(B2): no_editor_op = **블록 자체**를 에디터 요소로 못 세웠다(kind 에 블록 타입) ·
     block_unsupported = 블록은 세웠는데 **그 블록이 마크를 못 싣는다**(목록·표·FAQ 는 줄 하나씩이라 조각을 실을 칸이 없다 · kind 에 마크 종류).
     앞은 «에디터 요소를 배우자», 뒤는 «조각을 실을 칸을 만들자» — 한 칸으로 뭉치면 그 차이가 안 보인다. */
  no_editor_op: "이 채널 편집기에 그 요소가 없어 글로 풀어 넣었어요.",
  block_unsupported: "목록·표 안에는 꾸밈을 실을 칸이 없어 글자만 그대로 실었어요.",
  /* [R9-11 · B2 제기 2026-09-16] 티스토리 HTML 모드를 못 열면 인용은 «"…"», 구분선은 «———»로 대신 들어간다 — 장식이지 요소가 아니다.
     러너가 세기는 했는데 서버가 note 를 버려 고객이 몰랐다(§9 ①② 위반). 이제 같은 칸(`demoted[{kind:"quote"|"divider", why:"html_mode_fallback"}]`)으로 온다. */
  html_mode_fallback: "편집기 HTML 모드를 열지 못해 이 요소는 글자(따옴표·줄)로 대신 들어갔어요 — 글에서 직접 고치실 수 있어요.",
};

/**
 * [R9-11 · §9-②] 🔴 **사람이 안 보는 경로(자동 승인)에서도 닿게** — 발행 뒤 강등이 있으면 알림 한 통의 제목·본문(사람말 · §3 말투).
 *   순수 함수 — 러너 보고를 받는 쪽(`lib/runner-jobs.ts applyFormatMarksToPiece` · B2)이 부르고 notifications 에 넣는다. 강등이 0이면 null(알림을 만들지 않는다).
 */
export function formatDemotionNotice(fm: unknown, pieceTitle?: string | null, channel?: string | null): { title: string; body: string } | null {
  const rows = formatUnusedOf(fm).filter((r) => r.n > 0);
  if (!rows.length) return null;
  const head = rows.slice(0, 3).map((r) => `${r.label}${r.n > 1 ? ` ${r.n}곳` : ""}`).join(" · ");
  const more = rows.length > 3 ? ` 외 ${rows.length - 3}가지` : "";
  /* 🔴 §9-③ «되돌릴 길을 함께 준다» — 이 알림은 **이미 올라간 뒤**에 간다(B2 지적 2026-09-16). 우리 화면에서 고치는 게 아니라
     내릴 수 있는 채널(§5E `canRetract`)이면 «내렸다가 고쳐서 다시 올리기», 아니면 «채널에서 직접 고치기»가 정직한 길이다. 채널을 모르면 둘 다 안 지어내고 «글을 열면 보여 드려요»까지만. */
  /* 🔴 [C 발견 · B2 확인 2026-09-16] `canRetract` 는 2값이라 **«표에 없는 채널»과 «표에 있고 못 내리는 채널»이 같은 false** 다(화면 단추엔 그게 맞다 — «모르면 안 켠다»).
     여기선 3값이 필요하다: 표에 없는 채널(새 채널을 pieces 에 먼저 넣고 레지스트리 행을 나중에 넣는 틈)에 «채널에서 직접 바꾸세요»를 주면 **근거 없는 안내**다(AC-92 «모른다»→«못 한다»). 모르면 채널을 안 준 것과 같이 — 문장 없음. */
  const known = !!channel && !!channelSpec(channel);
  const back = !known ? "" : (canRetract(channel!) ? " 고치고 싶으면 글을 내렸다가 고쳐서 다시 올릴 수 있어요." : " 고치고 싶으면 채널에서 직접 바꾸실 수 있어요.");
  return {
    title: "이 글에서 못 낸 꾸밈이 있어요",
    body: `${pieceTitle ? `«${String(pieceTitle).slice(0, 30)}» — ` : ""}${head}${more}. 글자는 그대로 실렸고, 글을 열면 무엇이 어떻게 들어갔는지 보여 드려요.${back}`,
  };
}
export function whySay(why: string): string { return WHY_SAY[why] ?? "이 채널에서는 내지 못해 글자만 그대로 실었어요."; }

/** 종류별 수 — planned 에 적는 값. 0 인 종류는 키를 안 만든다(«없음»과 «0»을 가르는 관례 · AC-9). */
export function countMarks(blocks: Block[]): Partial<Record<MarkKind, number>> {
  const out: Partial<Record<MarkKind, number>> = {};
  for (const b of blocks) for (const m of allMarksOf(b)) out[m.kind] = (out[m.kind] ?? 0) + 1;
  return out;
}

/* ═══ [R12-5] 🔴 마크가 사는 자리가 **셋**이 됐다 — `marks`(문단) · `itemMarks`(목록 항목) · `cellMarks`(표 칸) ═══
 *   아래 세 함수(`countMarks`·`applyMarkBudget`·`stripUnsupportedMarks`)가 **문단만 훑으면**
 *   목록 안의 마크가 상한도 안 타고 채널 표(`false`)도 안 타서 «쓰레드에 형광펜»이 목록으로만 새어 나간다.
 *   🔴 그래서 «마크를 훑는다»를 한 곳으로 모은다 — 네 번째 자리가 생기면 여기만 고친다. */
/** 블록 하나가 가진 **모든** 마크를 순서대로(문단 → 목록 항목 → 표 칸). 세기·상한이 이 순서를 공유해야 «앞쪽부터 남긴다»가 말이 된다. */
function allMarksOf(b: Block): InlineMark[] {
  return [...(b.marks ?? []), ...(b.itemMarks ?? []).flatMap((x) => x.marks), ...(b.cellMarks ?? []).flatMap((x) => x.marks)];
}
/** 블록의 세 자리를 **같은 판정기**로 거른다(순수). `keep` 이 false 를 내면 그 마크는 빠진다. 🔴 셋 중 아무것도 없으면 **원래 블록 객체 그대로** 돌려준다(무회귀). */
function filterBlockMarks(b: Block, keep: (m: InlineMark, text: string) => boolean): Block {
  if (!b.marks?.length && !b.itemMarks?.length && !b.cellMarks?.length) return b;
  const nb: Block = { ...b };
  if (b.marks?.length) { const k = b.marks.filter((m) => keep(m, String(b.text ?? ""))); if (k.length) nb.marks = k; else delete nb.marks; }
  if (b.itemMarks?.length) {
    const k = b.itemMarks.map((x) => ({ ...x, marks: x.marks.filter((m) => keep(m, String(b.items?.[x.i] ?? ""))) })).filter((x) => x.marks.length);
    if (k.length) nb.itemMarks = k; else delete nb.itemMarks;
  }
  if (b.cellMarks?.length) {
    const k = b.cellMarks.map((x) => ({ ...x, marks: x.marks.filter((m) => keep(m, String(b.rows?.[x.r]?.[x.c] ?? ""))) })).filter((x) => x.marks.length);
    if (k.length) nb.cellMarks = k; else delete nb.cellMarks;
  }
  return nb;
}

/**
 * 글당 상한 적용 — 🔴 게이트가 아니다. 넘친 것은 **앞쪽부터 남기고**(독자가 먼저 보는 곳) 나머지를 `budget` 으로 적는다.
 *   `MARK_BUDGET` 이 정본(러너 계획층과 같은 수 · 서버가 더 적게 보내면 그게 이긴다).
 */
export function applyMarkBudget(blocks: Block[]): { blocks: Block[]; dropped: MarkDemotion[] } {
  const seen: Partial<Record<MarkKind, number>> = {};
  const dropped: MarkDemotion[] = [];
  /* [R12-5] 🔴 상한은 **글 전체 합**이다 — 문단·목록 항목·표 칸을 **한 카운터**로 센다(B2 지적 2026-09-17).
     항목마다 12개를 허락하면 목록 10줄짜리 글에 120개가 실린다. `seen` 이 블록 바깥에 있는 것이 그 뜻이다. */
  const out = blocks.map((b) => filterBlockMarks(b, (m, text) => {
    const n = (seen[m.kind] ?? 0) + 1; seen[m.kind] = n;
    if (n <= MARK_BUDGET[m.kind].perPost) return true;
    dropped.push({ kind: m.kind, why: "budget", sample: text.slice(m.s, m.s + 20), by: "server" });
    return false;
  }));
  return { blocks: out, dropped };
}

/**
 * 채널 표가 `false` 인 종류를 **블록에서 벗긴다**(글자는 남는다) — 저장 blocks·HTML·러너 payload 가 한 모양이 되게.
 *   `null`(모름)은 남긴다(러너가 올려 보고 적는다) · 표가 없는 채널은 손대지 않는다.
 */
export function stripUnsupportedMarks(blocks: Block[], channel: string): { blocks: Block[]; dropped: MarkDemotion[] } {
  const caps = formatCapsOf(channel);
  const dropped: MarkDemotion[] = [];
  if (!caps) return { blocks, dropped };
  /* [R12-5] 🔴 목록 항목·표 칸도 **같이** 벗긴다 — 문단만 벗기면 «쓰레드에 형광펜»이 목록으로만 새어 나간다(채널 표가 절반만 사는 상태). */
  const out = blocks.map((b) => filterBlockMarks(b, (m, text) => {
    if (caps[m.kind as FormatCapKey] !== false) return true;
    dropped.push({ kind: m.kind, why: "channel_unsupported", sample: text.slice(m.s, m.s + 20), by: "server" });
    return false;
  }));
  return { blocks: out, dropped };
}

/** `normalizeBlocks` 가 모은 파싱 강등(범위·겹침·모르는 종류)을 같은 모양으로. */
export function dropsToDemotions(drops: MarkDrop[]): MarkDemotion[] {
  return drops.map((d) => ({ kind: d.kind, why: d.why, ...(d.sample ? { sample: d.sample.slice(0, 20) } : {}), by: "server" as const }));
}

/** 생성 직후의 정본 한 벌 — `planned` 는 상한 전(모델이 낸 수), `kept` 는 상한·채널 표 뒤(실제로 내려보낸 수). */
export function buildFormatMarks(plannedBlocks: Block[], keptBlocks: Block[], demoted: MarkDemotion[]): FormatMarks {
  return { planned: countMarks(plannedBlocks), kept: countMarks(keptBlocks), demoted: demoted.map(clampDemotion) };
}

/** 자가검사 값 — 러너는 `{ total, bad, pct, red, center, italic, underline, bold?, samples? }` 를 보낸다(B2 `format-bleed.mjs`). 숫자 칸만 받고 `samples` 는 버린다. 옛 모양(숫자 하나)은 pct 로 읽는다. 못 읽으면 null(«못 쟀다»). */
export function bleedOf(v: unknown): FormatMarks["bleed"] | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? { pct: Math.round(v * 10) / 10 } : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pick = (k: string): number | undefined => { const n = Number(o[k]); return o[k] !== undefined && o[k] !== null && Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined; };
  const pct = pick("pct");
  if (pct === undefined) return null;
  const out: NonNullable<FormatMarks["bleed"]> = { pct };
  for (const k of ["total", "bad", "red", "center", "italic", "underline", "bold"] as const) { const n = pick(k); if (n !== undefined) out[k] = Math.floor(n); }
  return out;
}

const clampDemotion = (d: MarkDemotion): MarkDemotion => ({
  kind: String(d.kind ?? "?").slice(0, 24), why: String(d.why ?? "?").slice(0, 24),
  ...(d.sample ? { sample: String(d.sample).slice(0, 20) } : {}), ...(d.by ? { by: d.by } : {}),
});

/**
 * 러너 보고(`formatMarks`)를 **믿지 않고** 받아 정본에 합친다 — 숫자는 정수·음수 금지 · 강등은 kind/why 24자 · sample 20자 · 최대 60건.
 *   서버 강등은 그대로 두고 러너 강등을 **append** 한다(by:"runner"). 같은 kind·why 가 이미 러너 것으로 있으면 중복 append 하지 않는다(재보고 멱등).
 */
export function mergeRunnerFormatMarks(prev: unknown, report: unknown, now = new Date()): FormatMarks {
  const p = (prev && typeof prev === "object" ? prev : null) as FormatMarks | null;
  const base: FormatMarks = p
    ? { planned: { ...(p.planned ?? {}) }, ...(p.kept ? { kept: { ...p.kept } } : {}), ...(p.applied ? { applied: { ...p.applied } } : {}),
        demoted: [...(p.demoted ?? [])].map(clampDemotion),
        ...(typeof p.breaks === "number" ? { breaks: p.breaks } : {}), ...(typeof p.breakFails === "number" ? { breakFails: p.breakFails } : {}),
        ...(bleedOf(p.bleed) ? { bleed: bleedOf(p.bleed)! } : {}), ...(typeof p.htmlMode === "number" && p.htmlMode > 0 ? { htmlMode: p.htmlMode } : {}) }
    : { planned: {}, demoted: [] };
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const counts = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) { const n = Math.floor(Number(x)); if (Number.isFinite(n) && n >= 0 && k.length <= 24) out[k] = n; }
    return out;
  };
  const applied = counts(r.applied);
  if (Object.keys(applied).length) base.applied = applied;
  /* 러너의 `kept` 는 서버 `kept` 와 같아야 정상이다 — 다르면 러너 값을 **덮지 않고** 서버 값을 둔다(서버가 내려보낸 수가 사실이다). 서버 값이 없을 때만 받는다. */
  if (!base.kept) { const k = counts(r.kept); if (Object.keys(k).length) base.kept = k as Partial<Record<MarkKind, number>>; }
  const num = (v: unknown): number | undefined => { const n = Number(v); return v !== undefined && v !== null && Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined; };
  const breaks = num(r.breaks), breakFails = num(r.breakFails), bleed = bleedOf(r.bleed), htmlMode = num(r.htmlMode);
  if (breaks !== undefined) base.breaks = Math.floor(breaks);
  if (breakFails !== undefined) base.breakFails = Math.floor(breakFails);
  if (bleed) base.bleed = bleed;   // 🔴 없으면 안 만든다 — «못 쟀다»는 «0%»가 아니다
  if (htmlMode !== undefined && htmlMode > 0) base.htmlMode = Math.floor(htmlMode);   // [R9-11] 0 이면 키 없음
  const dem = Array.isArray(r.demoted) ? r.demoted.slice(0, 60) : [];
  for (const x of dem) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const d = clampDemotion({ kind: String(o.kind ?? "?"), why: String(o.why ?? "?"), ...(o.sample ? { sample: String(o.sample) } : {}), by: "runner" });
    if (base.demoted.some((e) => e.by === "runner" && e.kind === d.kind && e.why === d.why && e.sample === d.sample)) continue;
    base.demoted.push(d);
  }
  base.runnerReportedAt = now.toISOString();
  return base;
}

export interface FormatUnused { field: string; label: string; why: string; n: number }
/**
 * 화면용 투영 — kind×why 로 묶어 한 줄씩(같은 사유가 열 번이면 «10곳»). 영상 `refUnused` 와 같은 모양에 `label`·`n` 을 더한 것.
 *   🔴 빈 배열이면 호출부가 키 자체를 안 싣는다(«없음»을 «[]»로 보내면 화면이 빈 칸을 그린다).
 */
export function formatUnusedOf(fm: unknown): FormatUnused[] {
  const f = (fm && typeof fm === "object" ? fm : null) as FormatMarks | null;
  if (!f?.demoted?.length) return [];
  const m = new Map<string, FormatUnused>();
  for (const d of f.demoted) {
    const key = `${d.kind}|${d.why}`;
    const cur = m.get(key);
    if (cur) { cur.n++; continue; }
    m.set(key, { field: String(d.kind), label: fieldLabelOf(String(d.kind)), why: whySay(String(d.why)), n: 1 });
  }
  return [...m.values()];
}

/** 프롬프트 한 줄 — 이 채널에서 시켜도 되는 종류만 사람말+키로. 시킬 게 없으면 빈 문자열(줄 자체를 안 싣는다). */
export function marksPromptLine(allowed: readonly string[]): string {
  const kinds = allowed.filter((k) => MARK_KINDS.includes(k as MarkKind)) as MarkKind[];
  if (!kinds.length) return "";
  const say: Record<MarkKind, string> = {
    bold: "bold(굵게)", underline: "underline(밑줄)", italic: "italic(기울임)",
    value: "value(핵심 숫자·결론 낱말 한두 어절)", line: "line(문장 하나를 통째로 형광펜)", row: "row(요금·비교처럼 나란히 놓인 행)",
  };
  const caps = kinds.map((k) => `${k} ≤${MARK_BUDGET[k].perPost}`).join(" · ");
  return [
    `강조(marks): text 가 있는 블록에 marks:[{s,e,kind}] 로 적는다 — s/e 는 그 text 의 문자 위치(0부터 · e 는 끝 다음) · 겹치지 않게 · 숫자·결론·이름에만.`,
    /* [R12-5] 🔴 목록·표 «안»도 칠할 수 있게 됐다 — 이 두 줄이 없으면 모델은 문단에만 칠하고
       R12-5 는 «받을 수는 있는데 아무도 안 보내는» 칸이 된다(AC-69 의 프롬프트 판). 좌표 기준을 **한 문장에 못 박는다.** */
    `목록 항목 안(list·checklist·faq): itemMarks:[{i, marks:[{s,e,kind}]}] — i 는 items 의 인덱스이고 s/e 는 그 항목 문자열 기준(0부터). faq 항목은 "질문(줄바꿈)답" 한 덩이로 세되 질문과 답에 걸친 강조는 쓰지 않는다.`,
    `표 칸 안(table): cellMarks:[{r, c, marks:[{s,e,kind}]}] — r/c 는 rows[r][c] 이고 머리 행이 r=0. s/e 는 그 칸 문자열 기준.`,
    `쓸 수 있는 kind: ${kinds.map((k) => say[k]).join(" · ")}. 글당 ${caps}(문단·목록·표를 **다 합쳐서** 센다). 강조가 없는 문단이 더 많아야 자연스럽다(전부 칠하면 그것도 티다).`,
  ].join("\n");
}
