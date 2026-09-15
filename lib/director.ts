/**
 * lib/director.ts — 디렉터(DESIGN §5.3 결정 규칙 6 을 결정론 함수로 · LLM 은 «앵글 가르기» 1콜). 계약 §3 v1.1.
 *   AM 관례(content-director «앞뒤만 한다»): 재료 모으기·배정·게이트만. 글은 content-gen 하나가 쓴다.
 *   propose: 채널 = topic.channelHint ∩ 계정 있는 글 채널(힌트 먼저 · 최대 3채널 · 채널당 1piece) · 계정 = active|pending_login · posts_today<daily_cap · health 높은 순
 *            · 구성 = 그 계정 직전 글과 다른 format(writing-contracts 로테이션) · 일정 = best-time(계정 간 30분·min_gap·지난 시각이면 내일)
 *            · 제휴 = intent commercial|mixed → coupang(productQuery=소재 검색어 · slot mid/end) · 이미지 = 채널 기본 · coinCost = blog 1 + image×count.
 *   confirm: 패치 적용 → 잔액 선검사 → piece(generating·meta.stage writing)+slot(manual·producing) → consume(piece:{id} · piece:{id}:img{i}) → 경합 실패 시 refund+삭제 롤백 → 배경 생성 함수 호출.
 *   Brief.goal: tistory/blogger/wordpress 계정 → adsense · naver_blog → adpost · intent commercial → affiliate · 섞이면 mixed.
 *   [P1R5 B-1] 영상 분기 — PieceSpec.kind "video" + video{format,seconds,provider,voice,variant,cuts,disclosure} · 코인 = videoCoinItem(seconds) 1회(이미지 코인 0) ·
 *     달러 캡 선검사(코인 차감 «전») · 배경 함수는 generate-video-background. 슬롯 게이트·롤백·멱등은 글과 **같은 경로**(우회 0).
 *   🔎 AM 원본: ../AutoMarketing/lib/content-director.ts (관례 이식 2026-09-14 · 결정 규칙은 AC §5.3 으로 새로)
 */
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { q, listAccounts, TEXT_CHANNELS, type AccountRow } from "./accounts";
import { VIDEO_CHANNELS, isVideoChannel, type VideoFormat, type VideoSeconds, type VideoSpec } from "./video/types";
import { HOOK_TYPES, PALETTES } from "./video/scenes";
import { GEMINI_VOICES } from "./video/tts";
import { TYPECAST_VOICE_PILJAE, typecastAvailable } from "./video/tts-typecast";
import { precheckVideoBudget, triggerVideo } from "./video/gen";
import { contractFor, defaultImageCount, shortsFormOf, videoSecondsFor, type FormatKey, type WritingContract, isCardnewsChannel, coinFormatOf } from "./writing-contracts";
import { pickPublishAt, kstDateStr } from "./best-time";
import { gapMinFor } from "./publish-gap";
import { balance, consume, refundPiece, refundPieceDetailed, refundLine } from "./coin-ledger";
import { coinCostOf, videoCoinItem, pieceCoinCost, DEFAULT_COIN_TIER, toCoinTier, plannedAiFor, postItemForCoins, COIN_TIERS, type CoinTier } from "./coin-table";   // [R10-7·9] 등급 — 표는 coin-table 한 곳
import { imageCountFor } from "./writing-contracts";   // [R10-7] 등급이 굽겠다는 AI 장수만큼 사진 자리(사람·자동 경로 같은 함수)
import { callGeminiJson } from "./ai";
import { CHAIN_DIRECTOR } from "./ai-models";
import { toTopic, type Topic } from "./topics";
import { templateOf } from "./video/reference";          // [P1R5 §1.11] 레퍼런스 구조 템플릿
import { applyReferenceStyle, applyRefPalette, type RefStyleApplied, type RefUnused } from "./video/reference-apply";   // [R8CLOSE · B2] 배워 온 것 중 **닿는 것만** 고른다
import { guardSlot, OPEN_SLOT_STATUS, type PieceOrigin } from "./slot-gate";
import { pickFormatByPrint, type FormatPick } from "./format-pick";
import { targetChannelOrder } from "./director-goal";   // [R8CLOSE-B1 §B8] 목표 매체 → 채널 선택(DESIGN §5.3-1)
import { personaFitsFor } from "./persona-fit";         // [R8CLOSE-B1 §B2] 페르소나 적합도(DESIGN §5.3-2 · 🔴 LLM 0)        // [R8 §2.2] 골격 지문으로 format 고르기
import { printFromMeta, type StructurePrint } from "./structure-print";    // 축이 쓰는 지문 그대로
import { checkAiCostCap, requireAiBudget } from "./billing/ai-cost-cap";
import { seasonalFor } from "./kr-calendar";
import { findBannedCategory, isHealthTopic, HEALTH_FORBIDDEN_FORMATS } from "./banned-categories";
import { writeAudit } from "./audit";
import { backgroundBase } from "./site-url";   // [AC-53/54] 자기 배경 함수 호출 = «이 배포» · 로컬에서 라이브면 던진다

const n = (v: unknown) => Number(v || 0);

export type Goal = "adsense" | "adpost" | "affiliate" | "ypp" | "clip_incentive" | "mixed";
export interface Affiliate { provider: "coupang"; productQuery: string; slot: "mid" | "end" | "both" }
export interface PieceSpec {
  key: string; channel: string; accountId: number | null; accountHandle: string | null;
  format: FormatKey; emotionKey: string; composition: string; lengthHint: { words: number };
  /**
   * `count` = 글에 들어갈 **사진 총 장수** · `aiCount` = 그중 **AI 로 구울 장수**(나머지는 내 사진·스톡이 채운다).
   * 🔴 [R8] **코인은 `aiCount` 로만 매긴다** — 고객 사진·스톡은 우리 원가가 0이라 0코인이다.
   *    그래서 화면에서 «사진을 더 넣을까»와 «AI 로 구울까»는 **다른 질문**이다(앞은 공짜, 뒤는 돈).
   */
  images: { count: number; style: "photo" | "illust" | "infographic"; heroNeeded: boolean; aiCount: number };
  /**
   * [R8-A §4] 대가 3종 — `adDisclosure` 는 **셋의 OR 결과**(파생값)다. 화면·서버가 따로 계산하지 않게 여기서 한 번 정한다.
   *   🔴 `sponsored`(원고료·PPL)·`gift`(제품 무상 제공)는 **우리가 알 수 없다** — 고객이 켜는 값이라 자동 경로 기본값은 false.
   */
  monetize: { affiliate: Affiliate | null; sponsored: boolean; gift: boolean; adDisclosure: boolean };
  schedule: { at: string; slotReason: string }; coinCost: number;
  /**
   * [R10-7·9] 🔴 코인 등급(간단히 1 · 보통 2 · 프리미엄 3). 기본값은 **계정마다**(`accounts.quality_tier`) · 글마다 덮어쓰기(`PieceSpecPatch.tier`).
   *   `images.aiCount` 는 이 등급이 정한다(`plannedAiFor`) · `coinCost` 는 `pieceCoinCost(…, { tier })` 한 식. 영상·카드뉴스엔 없다(값을 안 가른다).
   */
  tier?: CoinTier;
  /** [R10-4] 이 글에만 쓰는 스타일(계정의 옷장 · `text_styles.id`). 없으면 계정 기본 스타일 → 없으면 스타일 없이. */
  styleId?: number | null;
  /** 추가(계약 외 · A 무시 가능): 채널별로 가른 앵글 — content-gen 재료. */
  angle: string;
  /** [R8CLOSE-B1 §B8] 🔴 **왜 이 채널인가** 한 줄(사람말). 고객이 «왜 티스토리?»를 물으면 답할 자리다. */
  channelReason?: string;
  /** [R8CLOSE-B1 §B2] 🔴 **왜 이 계정인가** — 페르소나 적합도. `measured:false` = 못 쟀다(0 과 다르다 · AC-9). */
  personaFit?: { score: number; matched: string[]; measured: boolean; line: string };
  /**
   * [R8 §2.2] **이 구성을 왜 골랐나** — 골격 지문으로 잰 값과 사람말 사유.
   *   🔴 이게 없으면 §2.2 는 «돌긴 도는데 아무도 못 보는» 기능이다(AC-29). `pieces.meta.formatPick` 으로 내려가
   *      검수 화면·감사에서 그대로 읽힌다. 자동 경로도 같은 자리에 싣는다(둘이 다른 곳에 적으면 화면이 갈린다).
   */
  formatPick?: FormatPick;
  /** [P1R5 §1.1] 글/영상 — 기본 "post"(없으면 글 · R1~R4 호환). */
  kind?: "post" | "video";
  /** [P1R5 §1.1] kind video 일 때만. */
  video?: VideoSpec;
  /**
   * [R7 §1.6] «지금 누르면 **오늘 이 자리**에 들어간다» — 제안 응답에만 싣는다(**briefs 에 저장하지 않는다**).
   *   왜: 확정 화면이 «내일 07:30»이라 해 놓고 누르면 «오늘 08:00»에 들어가면, 고객이 **누르기 전과 후에 다른 시각**을 본다.
   *   🔴 **확정이 정본**이다. 이건 «지금 기준»이고 제안~확정 사이에 자리가 찰 수 있다 —
   *      어긋나면 확정 응답의 `usedTodaySlot` 이 이긴다(화면은 확정 값을 그대로 그린다).
   *   자리를 고르는 판정은 `findTodayOpenSlot` **한 함수**다(제안과 확정이 같은 자리를 고르게).
   */
  usesTodaySlot?: { slotId: number; publishAt: string };
}
export interface Brief { id: number; topicId: number; goal: Goal; mode: "auto" | "reviewed"; coinCost: number; coinsLeft: number; reasons: string[]; pieces: PieceSpec[] }
export interface PieceSpecPatch { key: string; accountId?: number; format?: string; emotionKey?: string; images?: { count?: number; style?: string; aiCount?: number }; monetize?: { affiliate?: { productQuery: string; slot: string } | null; sponsored?: boolean; gift?: boolean }; schedule?: { at: string }; drop?: true;
  /** [P1R5 §1.1] 영상 손보기 — 포맷·길이·보이스·팔레트·훅·컷 수. */
  video?: { format?: string; seconds?: number; voiceId?: string; palette?: string; hookType?: string; cuts?: number };
  /** [R10-9] 글마다 등급 덮어쓰기(simple|standard|premium) — 사진 자리·AI 장수·코인이 같이 바뀐다. */
  tier?: string;
  /** [R10-4] 이 글만 다른 스타일(`text_styles.id` · null = 스타일 없이). */
  styleId?: number | null }

const wordsOf = (c: WritingContract) => { const w = Math.round(((c.length?.min ?? 1500) + (c.length?.max ?? 2500)) / 2 / 2.2); return Number.isFinite(w) ? w : 900; };   // 한국어 글자→어절 근사
/** [R8] 식은 `lib/coin-table.ts pieceCoinCost` 한 곳 — 화면 견적과 실제 차감이 갈릴 수 없게. [R10-7] 등급을 **반드시** 넘긴다(안 넘기면 simple 상한으로 «1 을 말하고 3 을 뺀다»). */
const pieceCoin = (channel: string, aiCount: number, format: string | undefined, tier: CoinTier) => pieceCoinCost("post", aiCount, { format: coinFormatOf(channel, format), tier });

/* [R8CLOSE-B1 §B8] 🔴 **목표 매체 → 채널 선택**(DESIGN §5.3-1) — 판단은 `lib/director-goal.ts` 한 곳이다.
   여기서는 부르기만 한다: 그 파일 헤더에 «왜 `briefs.goal` 을 재료로 안 쓰는가»(AC-72)를 라이브 수치와 함께 적어 뒀다. */
export function goalOf(pieces: { channel: string }[], intent: string): Goal {
  const set = new Set<Goal>();
  for (const p of pieces) {
    if (p.channel === "youtube_shorts") set.add("ypp");                         // [P1R5] 쇼츠 = YPP(쇼츠 광고수익)
    else if (p.channel === "naver_clip") set.add("clip_incentive");             // [P1R5] 클립 = 인센티브
    else if (p.channel === "naver_blog") set.add("adpost");
    else if (["tistory", "blogger", "wordpress"].includes(p.channel)) set.add("adsense");
  }
  if (intent === "commercial") set.add("affiliate");
  if (set.size === 0) return "mixed";
  return set.size === 1 ? [...set][0] : "mixed";
}

/** 테넌트가 잡아 둔 발행 시각(채널별 · 계정별) — 계정 간 30분 · min_gap 계산 재료. */
async function takenTimes(tid: number): Promise<{ byChannel: Map<string, Date[]>; byAccount: Map<number, Date[]> }> {
  const rows = await q(sql`
    SELECT channel, account_id, publish_at AS at FROM slots WHERE tenant_id = ${tid} AND publish_at IS NOT NULL AND status NOT IN ('skipped','failed','published') AND publish_at > NOW() - interval '1 day'
    UNION ALL
    SELECT channel, account_id, scheduled_for AS at FROM pieces WHERE tenant_id = ${tid} AND scheduled_for IS NOT NULL AND status IN ('scheduled','approved','publishing','generating','in_review') AND scheduled_for > NOW() - interval '1 day'`);
  const byChannel = new Map<string, Date[]>(); const byAccount = new Map<number, Date[]>();
  for (const r of rows) {
    const at = utcDate(r.at); if (!at) continue;
    const ch = String(r.channel); byChannel.set(ch, [...(byChannel.get(ch) ?? []), at]);
    if (r.account_id) { const a = n(r.account_id); byAccount.set(a, [...(byAccount.get(a) ?? []), at]); }
  }
  return { byChannel, byAccount };
}

async function recentFormats(tid: number, accountId: number | null, channel: string): Promise<string[]> {
  const rows = accountId
    ? await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND account_id = ${accountId} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`)
    : await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND channel = ${channel} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`);
  return rows.map((r) => String(r.format || "")).filter(Boolean);
}

/**
 * [R8 §2.2] 그 채널의 **최근 글 골격 지문** — format 을 «생김새»로 고르는 재료.
 *   🔴 `structure_repeat` 축(`lib/content-approve.ts checkStructure`)이 보는 것과 **같은 자리·같은 조건**을 읽는다
 *      (같은 채널 · 영상 제외 · 30일 · 최신 10편). 고르는 잣대와 재는 잣대가 갈리면 둘이 영원히 싸운다(메인 지시).
 *   지문이 없는 옛 글은 빠진다 — 그래서 빈 배열이면 «못 쟀다»이고, 고르기는 종전 이름 순서로 떨어진다(AC-9).
 */
async function recentPrints(tid: number, channel: string): Promise<StructurePrint[]> {
  try {
    const rows = await q(sql`SELECT meta->'structurePrint' AS sp FROM pieces
      WHERE tenant_id = ${tid} AND channel = ${channel} AND kind <> 'video'
        AND meta->'structurePrint' IS NOT NULL AND created_at > NOW() - interval '30 days'
      ORDER BY id DESC LIMIT 10`);
    return rows.map((r) => printFromMeta(r.sp)).filter((x): x is StructurePrint => !!x);
  } catch (e) { console.warn("[director] 골격 지문 조회 실패 — 이름 순서로 고른다", String((e as Error)?.message ?? e).slice(0, 120)); return []; }
}

/** 그 계정의 직전 영상 포맷(meta.video.format) — 포맷 로테이션 재료. */
async function recentVideoFormats(tid: number, accountId: number | null, channel: string): Promise<string[]> {
  const rows = accountId
    ? await q(sql`SELECT meta->'video'->>'format' AS f FROM pieces WHERE tenant_id = ${tid} AND kind = 'video' AND account_id = ${accountId} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`)
    : await q(sql`SELECT meta->'video'->>'format' AS f FROM pieces WHERE tenant_id = ${tid} AND kind = 'video' AND channel = ${channel} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`);
  return rows.map((r) => String(r.f || "")).filter(Boolean);
}

/* ═══ [P1R5 §1.1] 영상 spec — 결정론(같은 brief·같은 계정이면 같은 값) ═══ */
/* 🔴 [2026-09-16] `videoSecondsFor` 는 `lib/writing-contracts.ts` 로 옮겼다 — 표(`VIDEO_CHANNEL_MAX_SEC`) 옆이 그 함수의 집이고,
   **디렉터 말고도 부르는 곳이 있다**(편성표 견적). 여기 두었더니 편성표가 못 부르고 «60초»를 혼자 정하고 있었다. */
/**
 * [P1R6 §2.3] 최종 길이 = **채널 상한 ∩ 포맷 상한**. 요청값에서 내려갔으면 `clampedFrom` 으로 사실을 남긴다
 * (화면이 «30초로 맞췄어요» 를 말한다 · 조용한 하향 금지).
 *
 * 🔴 겸사 수리: 종전 `buildVideoSpec` 은 **채널 상한만** 적용한 `seconds` 를 spec 에 넣고 포맷 상한은 `shortsFormOf` 안에만 있었다.
 *    그래서 유튜브 쇼츠(60) + 클립 포맷(실제 30초)이면 `spec.seconds=60` 인데 실물은 ~15~30초가 된다 →
 *    payload `out.maxSeconds=60` · 심사 `duration_fit` 은 «≥ 60×0.6 = 36초»를 요구 → **멀쩡한 클립이 P0 로 막힌다**.
 *    포맷 로테이션이 클립을 고르는 1/3 확률에서 터지는 자리였다. 이제 `shortsFormOf` 가 낸 값을 정본으로 쓴다.
 */
export function resolveVideoSeconds(channel: string, format: VideoFormat, want?: unknown): { seconds: VideoSeconds; clampedFrom?: VideoSeconds } {
  const asked = videoSecondsFor(channel, want) as VideoSeconds;       // 채널 상한(정본 = writing-contracts)
  const seconds = shortsFormOf(format, asked).seconds as VideoSeconds; // + 포맷 상한·하한
  // 사실을 남기는 건 «사용자가 골랐는데 내려간» 경우뿐이다 — 기본값(요청 없음)에서 내려간 건 알릴 것이 없다(§2.3 «자동 하향 시»).
  const explicit = want !== undefined && want !== null && Number(want) > 0;
  return explicit && seconds !== Number(want) ? { seconds, clampedFrom: Number(want) as VideoSeconds } : { seconds };
}
/** 포맷 로테이션(같은 계정 직전 영상과 다른 포맷) — 글의 pickFormat 과 같은 결. */
function pickVideoFormat(recent: string[], seed: number): VideoFormat {
  const pool: VideoFormat[] = ["graphic", "talking", "clip"];
  const fresh = pool.filter((f) => f !== recent[0]);
  const list = fresh.length ? fresh : pool;
  return list[seed % list.length];
}
/** 다계정 변주(§6.2) — 같은 brief 의 i 번째 영상 piece 는 훅·팔레트·보이스가 서로 다르다(결정론). */
export function variantFor(i: number, accountId: number | null): { hookType: string; palette: string; voiceId: string } {
  const voices = typecastAvailable() ? [TYPECAST_VOICE_PILJAE, ...GEMINI_VOICES.slice(0, 2)] : [...GEMINI_VOICES];
  return { hookType: HOOK_TYPES[i % HOOK_TYPES.length], palette: PALETTES[((accountId ?? 0) + i) % PALETTES.length], voiceId: voices[i % voices.length] };
}
/** 영상 PieceSpec.video 조립(코인·원가 계산의 근거). */
export function buildVideoSpec(a: { channel: string; accountId: number | null; index: number; recentFormats: string[]; seconds?: unknown; affiliate: boolean }): VideoSpec {
  const format = pickVideoFormat(a.recentFormats, (a.accountId ?? 0) + a.index);
  const { seconds, clampedFrom } = resolveVideoSeconds(a.channel, format, a.seconds);
  const form = shortsFormOf(format, seconds);
  const variant = variantFor(a.index, a.accountId);
  return {
    format, seconds, cuts: form.cuts.default, ...(clampedFrom ? { clampedFrom } : {}),
    provider: { tier: seconds === 15 ? "filler" : "standard", key: form.provider },
    voice: { provider: typecastAvailable() && !GEMINI_VOICES.includes(variant.voiceId as typeof GEMINI_VOICES[number]) ? "typecast" : "gemini", voiceId: variant.voiceId },
    variant,
    disclosure: { badge: a.affiliate, descriptionFirstLine: a.affiliate },
  };
}

/** 계정 배정(§5.3-2): active|pending_login · posts_today < daily_cap · health 높은 순(→ id). */
/**
 * 계정 배정 — DESIGN §5.3-2 「건강도 · 캐던스 · **페르소나 적합도**」.
 *   🔴 [R8CLOSE-B1 §B2] 셋째(적합도)가 **0건**이었다. 캠핑 얘기만 하던 계정과 재테크 얘기만 하던 계정에
 *      같은 소재가 똑같이 떨어졌다. 이제 `fitBonus`(계정 id → 가산점)를 받으면 그만큼 순위가 움직인다.
 *   🔴 **막지 않는다**(§9): 적합도가 0이어도 **후보에서 빼지 않는다** — 거르는 조건은 종전 그대로(캐던스·상태)다.
 *      가산점에는 천장이 있다(`PERSONA_FIT_WEIGHT` = 20) — 적합도가 건강도를 이기면 그건 순위가 아니라 게이트다.
 *   🔴 `fitBonus` 를 안 주면 **종전과 완전히 같다**(가산점 0). 부르는 곳이 늘어도 조용히 달라지지 않는다.
 */
export function assignAccount(accounts: AccountRow[], channel: string, fitBonus?: ReadonlyMap<number, number>): AccountRow | null {
  const bonus = (a: AccountRow) => fitBonus?.get(a.id) ?? 0;
  const pool = accounts.filter((a) => a.channel === channel && (a.status === "active" || a.status === "pending_login") && a.postsToday < a.dailyCap)
    .sort((a, b) => (b.healthScore + bonus(b)) - (a.healthScore + bonus(a)) || a.id - b.id);
  return pool[0] ?? null;
}

/* ───────── propose ───────── */
/**
 * propose — 소재 1개 → 제작 지시서. `opts.origin` 은 **누가 부르는가**다(계약 R7 §1.2).
 *   🔴 기본값은 `"auto"`(fail-closed · `confirm` 과 같은 규율) — 아무 말 없이 부르면 보수적으로 군다.
 *   `"manual"` = 사람이 만들기 화면에서 누른 것. 이때만 «계정 없이 영상» 이 열린다.
 */
/* ───────── [R7 §1.6] «오늘 자리» 고르기 — 제안과 확정이 **같은 함수**를 본다 ───────── */

export interface TodaySlotPick { slotId: number; prevStatus: string; slotPublishAt: Date | null }

/**
 * 사람이 지금 «만들기»를 누르면 들어갈 **오늘(KST) 자리**. 없으면 null(= 새 자리를 만든다).
 *   고르는 규칙: 오늘 · 같은 채널 · 아직 글이 안 붙은 자리(`OPEN_SLOT_STATUS` — **슬롯 게이트와 같은 어휘**) ·
 *   같은 계정 자리를 먼저, 그다음 이른 시각 순, 1칸만.
 *   🔴 두 곳(제안 미리보기 · 확정 실행)이 이 함수를 같이 쓴다 — 두 벌로 적으면 «미리 말한 자리»와 «실제로 쓴 자리»가 갈라진다.
 */
export async function findTodayOpenSlot(tid: number, channel: string, accountId: number | null): Promise<TodaySlotPick | null> {
  const [row] = await q(sql`SELECT id, status, publish_at FROM slots
    WHERE tenant_id = ${tid} AND channel = ${channel} AND piece_id IS NULL
      AND slot_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date
      AND status IN (${sql.join([...OPEN_SLOT_STATUS].map((x) => sql`${x}`), sql`, `)})
    ORDER BY (account_id IS DISTINCT FROM ${accountId}), publish_at NULLS LAST, id
    LIMIT 1`);
  if (!row) return null;
  return { slotId: n(row.id), prevStatus: String(row.status), slotPublishAt: utcDate(row.publish_at) };
}

/**
 * 그 자리에 들어갔을 때 **나가는 시각**. 자리의 시각이 아직 안 지났으면 그 시각(자동 편성이 고른 좋은 시간을 버리지 않는다),
 * 이미 지났으면 이 글이 원래 잡았던 시각(과거로 예약하면 누르자마자 나가 버린다).
 */
export function resolveSlotAt(pick: TodaySlotPick, wantAt: Date): Date {
  return pick.slotPublishAt && pick.slotPublishAt.getTime() > Date.now() ? pick.slotPublishAt : wantAt;
}

export async function propose(tid: number, topicId: number, opts: { origin?: PieceOrigin } = {}): Promise<{ ok: true; brief: Brief } | { ok: false; step: string; error: string }> {
  const [trow] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${topicId}`);
  if (!trow) return { ok: false, step: "not_found", error: "소재를 찾을 수 없어요." };
  const topic = toTopic(trow);
  if (!["candidate", "picked"].includes(topic.status)) return { ok: false, step: "topic_state", error: "이미 쓴 소재예요. 다른 소재를 골라 주세요." };
  // ★C(P1R4) fix: 금칙 카테고리(성인·도박·의료 과장·비방 · §1.5)는 «소재 단계에서 거부» — 편성 자리(slots-assign-topic)만 막고 디렉터 제안은 열려 있었다.
  { const banned = findBannedCategory(`${topic.title} ${topic.angle ?? ""}`); if (banned) { await writeAudit({ tenantId: tid, action: "topic_banned_category", actorType: "system", riskLevel: "medium", detail: { category: banned.category, word: banned.word, topicId } }); return { ok: false, step: "banned_category", error: `${banned.label} 주제는 만들 수 없어요.` }; } }
  const accounts = await listAccounts(tid);
  /* [P1R5 §1.1] 영상 축 — 테넌트가 settings.kinds 에 "video" 를 켰고 영상 채널 계정이 있으면 영상 piece 도 낸다(글과 섞일 수 있다). */
  const [trow2] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  const tset = ((trow2?.settings ?? {}) as Record<string, unknown>);
  const kinds = Array.isArray(tset.kinds) ? (tset.kinds as unknown[]).map(String) : ["text"];
  const wantVideo = kinds.includes("video");
  const alive = (a: AccountRow) => a.status !== "suspended" && a.status !== "disconnected";
  const textCh = [...new Set(accounts.filter((a) => TEXT_CHANNELS.has(a.channel) && alive(a)).map((a) => a.channel))];
  const videoCh = wantVideo ? [...new Set(accounts.filter((a) => VIDEO_CHANNELS.has(a.channel) && alive(a)).map((a) => a.channel))] : [];
  /* 🔴 [R7 §1.2] **계정 없이 영상 만들기** — 영상을 켠 고객은 계정이 없어도 영상을 만들어 «앱에서 직접» 올릴 수 있어야 한다
     (유튜브 앱 심사 전이라 OAuth 연결이 막혀 있고, 클립은 원래 앱에서 올린다 · 전수조사 §A).
     🔴 **수동 «만들기» 경로만**이다: 자동 편성(`origin:"auto"`)은 종전대로 계정이 있어야 한다 — 슬롯 게이트(§4.7)와 별개로,
        아무도 안 보는 사이에 올릴 곳 없는 영상을 코인 써 가며 쌓지 않는다.
     채널은 소재 힌트가 영상 채널이면 그것, 아니면 `youtube_shorts`(60초 · 가장 흔한 규격)로 둔다 — 길이·최적시간·계약이 채널에 달려 있어 «무채널»로는 만들 수 없다. */
  const noAccountVideo = wantVideo && opts.origin === "manual" && !videoCh.length;
  const fallbackVideoCh = isVideoChannel(topic.channelHint) ? topic.channelHint : "youtube_shorts";
  const connected = [...textCh, ...videoCh, ...(noAccountVideo ? [fallbackVideoCh] : [])];
  if (!connected.length) return { ok: false, step: "no_account", error: wantVideo ? "먼저 글 또는 영상 채널 계정을 하나 연결해 주세요." : "먼저 글 채널 계정을 하나 연결해 주세요." };
  /* ══ [R8CLOSE-B1 §B8] 🔴 **목표 매체가 여기서 0건이었다.** ══
     종전: `channel_hint` × 켠 채널 **둘뿐** — 설계 §5.3-1 의 셋째 재료(목표 매체)가 한 줄도 없었다.
     🔴 순서만 바꾼다: 켠 채널은 **하나도 빼지 않는다**(§9 — 목표에 안 맞아도 뒤로 갈 뿐 그대로 후보다).
     `monetize` 원본이 필요해서 따로 읽는다 — `listAccounts` 는 불리언만 주고(그 파일 헤더 «monetize 불리언만»),
     «붙었다/심사 중/없다»를 가르려면 상태 글자가 있어야 한다. */
  const monRows = await q(sql`SELECT channel, monetize FROM accounts WHERE tenant_id = ${tid}
    AND COALESCE(last_error_kind,'') <> 'removed' AND status NOT IN ('suspended','disconnected')`);
  /* 🔴 [2026-09-16] 고객이 고른 **목표 매체**를 넘긴다 — 없으면 `null`(지금 동작 그대로).
     위에서 이미 읽은 `tset` 를 쓴다(같은 값을 두 번 묻지 않는다). */
  const chosenGoal = (() => {
    const g = tset.goal;
    return typeof g === "string" && g ? (g as Parameters<typeof targetChannelOrder>[0]["goal"]) : null;
  })();
  const order = targetChannelOrder({ connected, channelHint: topic.channelHint, goal: chosenGoal,
    accounts: monRows.map((r) => ({ channel: String(r.channel), monetize: (r.monetize ?? {}) as Record<string, unknown> })) });
  const channels = order.channels.slice(0, 3);

  const taken = await takenTimes(tid);
  /* [R8CLOSE-B1 §B2] 🔴 **페르소나 적합도** — 소재를 «이 계정 이야기»와 견준다. LLM 은 안 부른다(글자 겹침 · 값 0원).
     계정마다 읽지 않고 **한 번에** 읽는다(계정 30개면 쿼리 30번이 된다). */
  const fit = await personaFitsFor(tid, accounts, { title: topic.title, angle: topic.angle, keyword: (topic.factors as unknown as Record<string, unknown>)?.keyword as string | undefined });
  const intent = topic.factors.intent;
  const affiliateBase: Affiliate | null = intent === "commercial" ? { provider: "coupang", productQuery: topic.title, slot: "mid" } : intent === "mixed" ? { provider: "coupang", productQuery: topic.title, slot: "end" } : null;
  const specs: PieceSpec[] = [];
  for (const ch of channels) {
    const c = await contractFor(ch);
    const acc = assignAccount(accounts, ch, fit.bonus);
    /* [R8-A §4] 건강·의료 소재엔 «경험담» 구성을 빼고 고른다 — 자동 경로(`director-auto`)와 **같은 규칙**이어야 한다
       (사람이 누른 글만 의료법 §56 을 비껴가면 게이트가 아니라 구멍이다). */
    const healthTopic = isHealthTopic(`${topic.title} ${topic.angle ?? ""}`);
    const cPick = healthTopic
      ? { ...c, formats: (c.formats.filter((f) => !HEALTH_FORBIDDEN_FORMATS.includes(f)) as FormatKey[]).length ? (c.formats.filter((f) => !HEALTH_FORBIDDEN_FORMATS.includes(f)) as FormatKey[]) : c.formats }
      : c;
    /* [R8 §2.2] 🔴 **골격 지문을 보고 고른다** — 이름 로테이션만으로는 «생김새가 닮은 글»을 못 피한다.
       축이 «겹친다»고 말해도 고르는 쪽이 안 들으면 다음 글도 또 겹쳤다(재기만 하고 피하지 않던 상태). */
    const fp = pickFormatByPrint(cPick, await recentFormats(tid, acc?.id ?? null, ch), `${topic.id}:${ch}:${acc?.id ?? 0}`, null, await recentPrints(tid, ch),
      { imageCount: defaultImageCount(ch), affiliate: !!affiliateBase, intent, title: topic.title });   // 넷 다 여기서 이미 정해져 있다(지어낸 값 0)
    const format = fp.format;
    if (fp.switched) console.info(`[director] 골격 겹침으로 구성 갈아탐 tid=${tid} ch=${ch} → ${fp.format} (${fp.why})`);
    const chTaken = taken.byChannel.get(ch) ?? [];
    /* [R8] 🔴 간격은 **`publish-gap.ts` 한 곳**에서 온다 — 계정마다 «우리가 무엇을 아는가»가 달라서다
       (전용 IP 가 **실제로 다른 것이 확인된** 계정끼리만 좁힐 수 있다 · `docs/.../proxy-cost.md` §6.3b).
       ⚠️ 계정이 없으면(자동 배정 전) 가장 안전한 기본을 쓴다 — 모를 때 좁히지 않는다. */
    const gap = acc ? await gapMinFor(tid, acc.id) : null;
    const sched = pickPublishAt({
      channel: ch, goldenHours: acc?.goldenHours ?? null, taken: chTaken,
      takenSameAccount: acc ? (taken.byAccount.get(acc.id) ?? []) : [], minGapMin: acc?.minGapMin,
      ...(gap ? { gapMin: gap.gapMin } : {}),
      /* 🔴 계정마다 **다른** 흔들림 — 전 계정이 같은 폭으로 흔들리면 «같이 흔들리는 것»이 다시 신호가 된다. */
      ...(acc ? { jitterSeed: `acc:${acc.id}` } : {}),
      avoidNight: true,
    });
    taken.byChannel.set(ch, [...chTaken, sched.at]);
    if (acc) taken.byAccount.set(acc.id, [...(taken.byAccount.get(acc.id) ?? []), sched.at]);
    if (isVideoChannel(ch)) {
      /* [P1R5] 영상 piece — 이미지 코인 0 · 코인은 길이 구간제 1회 · 변주 인덱스는 지금까지 만든 영상 수. */
      const vIndex = specs.filter((x) => x.kind === "video").length;
      const video = buildVideoSpec({ channel: ch, accountId: acc?.id ?? null, index: vIndex, recentFormats: await recentVideoFormats(tid, acc?.id ?? null, ch), seconds: tset.videoSeconds, affiliate: !!affiliateBase });
      specs.push({
        key: `${ch}:${acc?.id ?? 0}`, channel: ch, accountId: acc?.id ?? null, accountHandle: acc?.handle ?? null,
        kind: "video", video,
        format: (video.format === "clip" ? "story" : video.format === "talking" ? "qna" : "info") as FormatKey,
        emotionKey: "script", composition: `${video.seconds}초 ${video.format === "graphic" ? "그래픽 스토리" : video.format === "talking" ? "토킹" : "클립"}`,
        lengthHint: { words: Math.round(video.seconds * 4.6 * 0.85 / 2.2) },
        images: { count: 0, style: "photo", heroNeeded: false, aiCount: 0 },
        monetize: { affiliate: affiliateBase ? { ...affiliateBase } : null, sponsored: false, gift: false, adDisclosure: !!affiliateBase },   // [R8-A §4] 협찬·무상 제공은 고객이 켠다(자동 기본 false)
        schedule: { at: sched.at.toISOString(), slotReason: sched.reason }, coinCost: coinCostOf(videoCoinItem(video.seconds)), angle: topic.angle,
      });
      continue;
    }
    /* [R10-7·9] 🔴 등급 = **계정 기본값**(안 골랐으면 simple = 오늘까지의 글값). 사진 자리는 «계약 기본»과 «등급이 굽겠다는 AI 장수» 중 큰 쪽(`imageCountFor`) ·
       AI 장수는 등급 상한 안에서(`plannedAiFor`) · 코인은 그 둘로 한 식(`pieceCoin`). 자동 경로(director-auto)와 **같은 세 함수**다. */
    const tier: CoinTier = acc?.defaultTier ?? DEFAULT_COIN_TIER;
    const imageCount = imageCountFor(c, null, tier);
    const aiCount = plannedAiFor(tier, imageCount);
    specs.push({
      key: `${ch}:${acc?.id ?? 0}`, channel: ch, accountId: acc?.id ?? null, accountHandle: acc?.handle ?? null,
      kind: "post",
      format, emotionKey: c.emotionKey, composition: c.formatLabel[format] || format, lengthHint: { words: wordsOf(c) },
      /* [R8] 🔴 간단히 = **AI 1장 + 나머지는 스톡** — 글 한 편 1코인(사장님 승인값). 보통·프리미엄은 AI 를 더 굽고(2~3 · 4~5) 그만큼(2 · 3) 든다.
         고객 사진이 자리를 먹으면 그만큼 덜 굽고 돌려준다(`settlePieceCoins`). */
      images: { count: imageCount, style: c.images.style, heroNeeded: ch === "naver_blog" || ch === "tistory", aiCount },
      tier, styleId: acc?.defaultStyleId ?? null,   // [R10-4] 계정에 걸어 둔 스타일이 기본 · 글마다 덮어쓰기는 patch
      monetize: { affiliate: affiliateBase ? { ...affiliateBase } : null, sponsored: false, gift: false, adDisclosure: !!affiliateBase },   // [R8-A §4] 협찬·무상 제공은 고객이 켠다(자동 기본 false)
      schedule: { at: sched.at.toISOString(), slotReason: sched.reason }, coinCost: pieceCoin(ch, aiCount, format, tier), angle: topic.angle,
      formatPick: fp,   // [R8 §2.2] 왜 이 구성인지 — 글 piece 만. 영상은 위에서 format 을 **제 규칙으로 덮어쓰므로** 달지 않는다
      ...(ch === channels[0] ? { channelReason: order.reason } : {}),   // [R8CLOSE-B1 §B8] 순서를 정한 이유는 **맨 앞 채널**에 붙는다
      /* [R8CLOSE-B1 §B2] 🔴 **이 계정에 왜 갔는지** — 낮아도 배정은 됐다. 낮으면 낮다고 말해 준다(막지 않는다 · §9). */
      ...(acc && fit.fits.get(acc.id) ? { personaFit: { score: Number(fit.fits.get(acc.id)!.score.toFixed(2)), matched: fit.fits.get(acc.id)!.matched.slice(0, 5), measured: fit.fits.get(acc.id)!.measured, line: fit.fits.get(acc.id)!.line } } : {}),
    });
  }

  // LLM 1콜 — 채널별로 앵글을 가른다(같은 소재 두 채널이면 다른 관점) + 이유 3줄(사람말)
  const reasons: string[] = [];
  try {
    const system = "너는 콘텐츠 디렉터다. 같은 소재를 채널마다 «다른 관점»으로 갈라 준다(같은 문장·같은 구조 금지). 근거 없는 수치·최상급 금지. 출력 JSON: { \"pieces\": [ { \"key\": string, \"angle\": string(그 채널 독자에게 맞춘 관점 한 문장 · 60자 내) } ], \"reasons\": [string×3 · 왜 이 배치인지 사용자에게 말하듯 한 문장씩 · 시스템 용어 금지] }";
    const user = [
      `[소재] ${topic.title}\n[기본 앵글] ${topic.angle}\n[검색 의도] ${intent}${topic.factors.volume ? ` · 월 검색 ${topic.factors.volume.toLocaleString()}` : ""}${topic.factors.seasonal ? ` · 시즌 ${topic.factors.seasonal}` : ""}`,
      `[배치]\n${specs.map((s) => `- key ${s.key} · ${s.channel} · ${s.composition} · 계정 ${s.accountHandle ?? "미정"} · ${s.monetize.affiliate ? "제휴 상품 포함" : "제휴 없음"} · ${s.schedule.slotReason}`).join("\n")}`,
    ].join("\n\n");
    const r = await callGeminiJson<{ pieces?: { key: string; angle: string }[]; reasons?: string[] }>({ purpose: "director", chain: CHAIN_DIRECTOR, role: "director", system, user, tenantId: tid, ref: `topic:${topic.id}`, mode: "pro", maxOutputTokens: 1500, budgetMs: 20_000 });
    if (r.ok) {
      for (const p of r.data?.pieces ?? []) { const s = specs.find((x) => x.key === p?.key); if (s && p?.angle) s.angle = String(p.angle).trim().slice(0, 200); }
      for (const x of r.data?.reasons ?? []) if (typeof x === "string" && x.trim()) reasons.push(x.trim().slice(0, 120));
    }
  } catch (e) { console.warn("[director] 앵글 LLM 실패 — 기본 앵글 유지", String((e as Error)?.message ?? e).slice(0, 100)); }
  /* [R8CLOSE-B1 §B8] 채널을 **왜 이 순서로** 골랐는지 — 🔴 LLM 이 지어낸 줄보다 앞에 둔다(이건 우리가 실제로 잰 값이다). */
  if (channels.length > 1 && order.reason) reasons.unshift(order.reason);
  if (reasons.length < 3) {
    const season = seasonalFor(topic.title);
    const fill = [
      specs.length > 1 ? `${specs.map((s) => s.accountHandle ? `@${s.accountHandle}` : s.channel).join(" · ")}에 서로 다른 관점으로 나눠 실어요.` : `${specs[0].accountHandle ? `@${specs[0].accountHandle}` : specs[0].channel}에 ${specs[0].composition} 구성으로 써요.`,
      topic.factors.volume ? `«${topic.title}»는 한 달에 ${topic.factors.volume.toLocaleString()}번 검색돼요${topic.factors.competition === "low" ? " · 경쟁이 낮은 편이에요" : ""}.` : season.label ? `${season.label} 시즌이라 지금 올리면 좋아요.` : `직전 글과 다른 구성이라 계정이 단조로워 보이지 않아요.`,
      specs[0].schedule.slotReason + "에 나가요.",
    ];
    for (const f of fill) if (reasons.length < 3) reasons.push(f);
  }

  const goal = goalOf(specs, intent);
  const coinCost = specs.reduce((a, s) => a + s.coinCost, 0);
  const [b] = await q(sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost)
    VALUES (${tid}, ${topic.id}, ${goal}, ${jsonb(specs)}, ${jsonb(reasons)}, ${"reviewed"}, ${"proposed"}, ${coinCost}) RETURNING id`);
  const briefId = n(b?.id);
  const [chk] = await q(sql`SELECT jsonb_typeof(pieces) AS t FROM briefs WHERE id = ${briefId}`);
  if (chk?.t !== "array") console.error("[director] briefs.pieces jsonb_typeof !== array", chk);
  const bal = await balance(tid);
  /* [R7 §1.6 · 메인 지시 2026-09-15] 확정 **전에** 미리 알려 준다 — «누르면 오늘 그 자리에 들어가요».
     이게 없으면 화면은 «내일 07:30»이라 해 놓고, 누르면 «오늘 08:00»에 들어간다(고객이 누르기 전과 후에 다른 시각을 본다).
     🔴 **응답에만 싣는다** — `briefs.pieces` 에는 저장하지 않는다(위 INSERT 는 이미 끝났다). 저장하면 «그때의 자리»가 굳어
        나중에 확정할 때 실제로 고른 자리와 어긋난 채로 남는다.
     🔴 자리는 **한 칸**이라 첫 spec 에만 붙인다(confirm 의 `takeChannel` 규칙과 같다). 확정이 정본이다. */
  let outPieces = specs;
  if ((opts.origin === "manual") && specs.length) {
    const pick = await findTodayOpenSlot(tid, specs[0].channel, specs[0].accountId ?? null);
    if (pick) {
      const at = resolveSlotAt(pick, new Date(specs[0].schedule.at)).toISOString();
      outPieces = specs.map((s, i) => (i === 0 ? { ...s, usesTodaySlot: { slotId: pick.slotId, publishAt: at } } : s));
    }
  }
  return { ok: true, brief: { id: briefId, topicId: topic.id, goal, mode: "reviewed", coinCost, coinsLeft: bal.balance, reasons, pieces: outPieces } };
}

/* ───────── confirm ───────── */
export type ConfirmResult =
  | { ok: true; briefId: number; pieceIds: number[]; coinsCharged: number; coinsLeft: number;
      /**
       * [R7 §1.6] 사람이 «만들기»를 눌러 만든 글이 **오늘 이미 잡혀 있던 편성 자리에 들어갔을 때**만 실린다.
       *   화면은 이걸 보고 «오늘 자리에 넣었어요 — 19:00 에 나가요» 라고 말한다(없으면 종전대로 «새로 잡았어요»).
       */
      usedTodaySlot?: { slotId: number; channel: string; publishAt: string; prevStatus: string } }
  | { ok: false; step: "coin_short"; error: string; need: number; have: number }
  | { ok: false; step: string; error: string };

/**
 * confirm 옵션(P1R2 — 자동 편성).
 *   🔴 `origin` 기본값은 **"auto"(fail-closed)**: 아무 말 없이 부르면 게이트를 탄다(CLAUDE §4.7 · PITFALLS AC-2).
 *      사람이 누르는 경로(`/api/director-confirm`)는 `origin:"manual"` 을 **명시**한다. 빼먹으면 열리는 설계는 결국 열린다.
 *   `slotId` 가 오면 **새 슬롯을 만들지 않고 그 편성 자리를 쓴다**(크론 경로) — 없으면 지금처럼 새 슬롯을 만든다(사람 경로).
 */
export interface ConfirmOpts { slotId?: number | null; origin?: PieceOrigin }

async function applyPatches(tid: number, specs: PieceSpec[], patches: PieceSpecPatch[]): Promise<{ ok: true; specs: PieceSpec[] } | { ok: false; error: string }> {
  const accounts = await listAccounts(tid);
  const out: PieceSpec[] = [];
  for (const s of specs) {
    const p = patches.find((x) => x?.key === s.key);
    if (!p) { out.push(s); continue; }
    if (p.drop) continue;
    const c = await contractFor(s.channel, p.emotionKey || s.emotionKey);
    const next: PieceSpec = { ...s, images: { ...s.images }, monetize: { ...s.monetize }, schedule: { ...s.schedule } };
    if (p.accountId !== undefined) {
      const a = accounts.find((x) => x.id === n(p.accountId) && x.channel === s.channel);
      if (!a) return { ok: false, error: "그 채널의 계정이 아니에요." };
      next.accountId = a.id; next.accountHandle = a.handle; next.key = `${s.channel}:${a.id}`;
    }
    if (p.format !== undefined) { if (!c.formats.includes(p.format as FormatKey)) return { ok: false, error: "이 채널에서 쓸 수 없는 구성이에요." }; next.format = p.format as FormatKey; next.composition = c.formatLabel[next.format] || next.format; }
    if (p.emotionKey) next.emotionKey = String(p.emotionKey).slice(0, 40);
    /* [R10-9] 글마다 등급 덮어쓰기 — 🔴 모르는 값은 거절한다(«premium!» 같은 오타를 simple 로 조용히 접으면 고객은 프리미엄을 골랐다고 믿는다 · AC-92).
       등급을 바꾸면 사진 자리·AI 장수가 그 등급 기본으로 다시 선다(고객이 images 를 같이 보내면 그게 이긴다 — 아래에서 덮는다). 영상은 등급이 없다. */
    if (p.tier !== undefined && next.kind !== "video") {
      const t = toCoinTier(p.tier);
      if (!t) return { ok: false, error: "등급은 간단히·보통·프리미엄 중 하나예요." };
      next.tier = t;
      next.images.count = imageCountFor(c, null, t);
      next.images.aiCount = plannedAiFor(t, next.images.count);
    }
    /* [R10-4] 이 글만 다른 스타일 — 남의 집 스타일은 못 쓴다(교차 누수 · CLAUDE §4.6). null = «스타일 없이». */
    if (p.styleId !== undefined) {
      const sid = p.styleId === null ? 0 : Math.floor(Number(p.styleId) || 0);
      if (sid) { const [st] = await q(sql`SELECT id FROM text_styles WHERE tenant_id = ${tid} AND id = ${sid} AND deleted_at IS NULL`); if (!st) return { ok: false, error: "그 스타일을 찾지 못했어요." }; }
      next.styleId = sid || null;
    }
    const tierMax = next.tier ? Math.max(c.images?.max ?? 10, next.images.count) : (c.images?.max ?? 10);   // 등급이 자리를 계약 상한 위로 올렸으면 그 값까지 허용
    if (p.images?.count !== undefined) next.images.count = Math.max(c.images?.min ?? 0, Math.min(tierMax, Math.trunc(n(p.images.count))));
    /* [R8] AI 로 구울 장수 — 총 장수를 넘을 수 없다. 🔴 **이 값만 코인을 움직인다**(사진을 더 넣는 것 자체는 공짜). */
    if (p.images?.aiCount !== undefined) next.images.aiCount = Math.max(0, Math.min(next.images.count, Math.trunc(n(p.images.aiCount))));
    if (next.images.aiCount > next.images.count) next.images.aiCount = next.images.count;
    if (p.images?.style && ["photo", "illust", "infographic"].includes(p.images.style)) next.images.style = p.images.style as PieceSpec["images"]["style"];
    /* [R8-A §4] 협찬·무상 제공 — 🔴 **끄는 길을 두지 않는다**: 여기서는 «켜기»만 받는다(false 를 보내도 내려가지 않는다).
       켜고 만든 뒤 끄면 «고지 없는 글»이 남기 때문이다. 내리려면 글을 버리거나 재검수로 다시 만든다(메인 판정 2026-09-15). */
    if (p.monetize?.sponsored === true) next.monetize.sponsored = true;
    if (p.monetize?.gift === true) next.monetize.gift = true;
    if (p.monetize && "affiliate" in p.monetize) {
      const af = p.monetize.affiliate;
      next.monetize.affiliate = af && af.productQuery ? { provider: "coupang", productQuery: String(af.productQuery).slice(0, 120), slot: (["mid", "end", "both"].includes(String(af.slot)) ? af.slot : "mid") as Affiliate["slot"] } : null;
      next.monetize.adDisclosure = !!next.monetize.affiliate || next.monetize.sponsored || next.monetize.gift;   // [R8-A §4] 셋의 OR
    }
    if (p.schedule?.at) { const d = new Date(p.schedule.at); if (Number.isNaN(d.getTime())) return { ok: false, error: "시각 형식을 확인해 주세요." }; if (d.getTime() < Date.now() + 10 * 60_000) return { ok: false, error: "지금보다 10분 이상 뒤로 잡아 주세요." }; next.schedule = { at: d.toISOString(), slotReason: "직접 고른 시각" }; }
    /* [P1R5 §1.1] 영상 손보기 — 포맷·길이·보이스·팔레트·훅·컷 수. 길이가 바뀌면 코인 구간도 바뀐다(계약 §0.1-4). */
    if (next.kind === "video" && next.video) {
      const v: VideoSpec = { ...next.video, provider: { ...next.video.provider }, voice: { ...next.video.voice }, variant: { ...next.video.variant }, disclosure: { ...next.video.disclosure } };
      const pv = p.video ?? {};
      if (pv.format && ["graphic", "talking", "clip"].includes(String(pv.format))) v.format = String(pv.format) as VideoFormat;
      /* [P1R6 §2.3] 손보기에서 길이를 고르면 **채널 ∩ 포맷** 상한을 다시 적용하고, 내려갔으면 `clampedFrom` 으로 남긴다.
         포맷만 바꿔도(예: 60초 유지 + 클립 포맷) 상한이 달라지므로 **포맷 패치만 와도 다시 푼다**. */
      if (pv.seconds !== undefined || pv.format) {
        const r = resolveVideoSeconds(s.channel, v.format, pv.seconds !== undefined ? pv.seconds : v.seconds);
        v.seconds = r.seconds;
        if (r.clampedFrom) v.clampedFrom = r.clampedFrom; else delete v.clampedFrom;
      }
      const form = shortsFormOf(v.format, v.seconds);
      v.provider = { tier: v.seconds === 15 ? "filler" : "standard", key: form.provider };
      v.cuts = pv.cuts !== undefined ? Math.max(form.cuts.min, Math.min(form.cuts.max, Math.trunc(n(pv.cuts)))) : form.cuts.default;
      if (pv.voiceId) { const id = String(pv.voiceId).slice(0, 60); v.variant = { ...v.variant, voiceId: id }; v.voice = { provider: GEMINI_VOICES.includes(id as typeof GEMINI_VOICES[number]) ? "gemini" : "typecast", voiceId: id }; }
      if (pv.palette) v.variant = { ...v.variant, palette: String(pv.palette).slice(0, 60) };
      if (pv.hookType && HOOK_TYPES.includes(String(pv.hookType) as typeof HOOK_TYPES[number])) v.variant = { ...v.variant, hookType: String(pv.hookType) };
      v.disclosure = { badge: next.monetize.adDisclosure, descriptionFirstLine: next.monetize.adDisclosure };   // [R8-A §4] 영상도 대가 3종 같은 조건
      next.video = v;
      next.composition = `${v.seconds}초 ${v.format === "graphic" ? "그래픽 스토리" : v.format === "talking" ? "토킹" : "클립"}`;
      next.coinCost = coinCostOf(videoCoinItem(v.seconds));
      out.push(next); continue;
    }
    /* [R10-7] 🔴 옛 spec(등급 전)엔 tier 가 없다 — 그때는 simple 로 **적어서** 셈한다(모르는 것을 모자라게 받는 쪽 · AC-93). 화면엔 그 값이 그대로 실린다. */
    if (!next.tier) next.tier = DEFAULT_COIN_TIER;
    next.coinCost = pieceCoin(next.channel, next.images.aiCount, next.format, next.tier);
    out.push(next);
  }
  return { ok: true, specs: out };
}

/**
 * [R8 · 사장님 코인값 승인 2026-09-15] estimate — **누르기 전에 몇 코인인지.** 아무것도 쓰지 않는다(견적만).
 *   🔴 왜 서버가 재는가: 화면이 «1 + AI 장수 − 1» 을 **다시 적으면** 값을 바꿀 때 한 쪽이 썩는다(AC-47).
 *      `confirm` 과 **같은 `applyPatches`** 를 타므로 «견적에서 본 숫자»와 «실제로 빠진 숫자»가 갈릴 수 없다.
 *   🔴 사진을 더 넣는 것은 **공짜**다(내 사진·스톡). `images.aiCount` 만 코인을 움직인다 — 화면에서 다른 질문으로 물어야 한다.
 */
export async function estimate(tid: number, briefId: number, patches: PieceSpecPatch[] = []): Promise<
  | { ok: true; coinCost: number; coinsLeft: number; enough: boolean; need: number; pieces: { key: string; channel: string; kind: "post" | "video"; coinCost: number; imageCount: number; aiCount: number; tier?: CoinTier; styleId?: number | null }[] }
  | { ok: false; step: string; error: string }> {
  const [b] = await q(sql`SELECT * FROM briefs WHERE tenant_id = ${tid} AND id = ${Math.floor(Number(briefId) || 0)}`);
  if (!b) return { ok: false, step: "not_found", error: "지시서를 찾을 수 없어요." };
  const base = (Array.isArray(b.pieces) ? b.pieces : []) as PieceSpec[];
  const ap = await applyPatches(tid, base, Array.isArray(patches) ? patches : []);
  if (!ap.ok) return { ok: false, step: "patch", error: ap.error };
  const coinCost = ap.specs.reduce((a, s) => a + s.coinCost, 0);
  const bal = await balance(tid);
  return {
    ok: true, coinCost, coinsLeft: bal.balance, enough: bal.balance >= coinCost, need: Math.max(0, coinCost - bal.balance),
    /* [R10-9] 등급·스타일도 같이 — 화면이 «이 글은 프리미엄 3코인»을 서버 값으로 그린다(셈 안 한다 · AC-74). 영상엔 tier 가 없다(키 자체를 안 싣는다). */
    pieces: ap.specs.map((s) => ({ key: s.key, channel: s.channel, kind: s.kind ?? "post", coinCost: s.coinCost, imageCount: s.images.count, aiCount: s.images.aiCount,
      ...(s.kind !== "video" && s.tier ? { tier: s.tier } : {}), ...(s.kind !== "video" && s.styleId !== undefined ? { styleId: s.styleId } : {}) })),
  };
}

export async function confirm(tid: number, briefId: number, patches: PieceSpecPatch[] = [], actorId: number | null = null, opts: ConfirmOpts = {}): Promise<ConfirmResult> {
  const origin: PieceOrigin = opts.origin === "manual" ? "manual" : "auto";   // 기본 auto = fail-closed
  const reuseSlotId = Math.floor(Number(opts.slotId) || 0) || null;
  const [b] = await q(sql`SELECT * FROM briefs WHERE tenant_id = ${tid} AND id = ${briefId}`);
  if (!b) return { ok: false, step: "not_found", error: "지시서를 찾을 수 없어요." };
  if (String(b.status) !== "proposed") {
    // 재확정 = 멱등: 이미 만든 piece 들을 돌려준다(코인 재차감 0)
    const ex = await q(sql`SELECT id FROM pieces WHERE tenant_id = ${tid} AND brief_id = ${briefId} ORDER BY id`);
    const bal = await balance(tid);
    return { ok: true, briefId, pieceIds: ex.map((r) => n(r.id)), coinsCharged: 0, coinsLeft: bal.balance };
  }
  const base = (Array.isArray(b.pieces) ? b.pieces : []) as PieceSpec[];
  const ap = await applyPatches(tid, base, Array.isArray(patches) ? patches : []);
  if (!ap.ok) return { ok: false, step: "patch", error: ap.error };
  const specs = ap.specs;
  if (!specs.length) return { ok: false, step: "empty", error: "만들 글이 없어요. 하나는 남겨 주세요." };
  const total = specs.reduce((a, s) => a + s.coinCost, 0);
  const bal0 = await balance(tid);
  if (bal0.balance < total) return { ok: false, step: "coin_short", error: `코인이 ${total - bal0.balance}개 부족해요.`, need: total - bal0.balance, have: bal0.balance };

  /* 🔴 슬롯 게이트(CLAUDE §4.7 절대 게이트) — 자동 경로가 piece 를 만들려면 «어느 편성 자리의 몫인지» 말해야 한다.
     사람 경로(origin:"manual")는 통과. 거부는 감사 + 홈 «해야 할 일»에 남는다(조용한 0건 금지 · AC-2). */
  const gate = await guardSlot({ tenantId: tid, channel: specs[0].channel, origin, slotId: reuseSlotId, source: "director.confirm", topic: String(b.topic_id ?? "") });
  /* P1R4 §1.5 — AI 원가 일 상한(코인을 차감하기 전에 잰다 · 환율 없으면 잴 수 없어 막지 않는다).
     🔴 [2026-09-14 C 수리] **재는 것과 알리는 것을 가른다.** `requireAiBudget` 은 초과를 보면 고객 알림(«오늘 만들 수 있는 양을
     다 썼어요 · 내일 다시 이어서 만들어요»)을 **부수효과로 넣는다**. 그걸 무조건 먼저 부르면, 바로 아래에서 영상을 소프트로
     통과시켜 **영상은 만들어지고 코인도 빠졌는데 알림함엔 «오늘은 못 만들어요»** 가 남는다(실측: notifications#209).
     고객은 그걸 «돈만 빠지고 안 만들어졌다»로 읽는다 — 계약 v5.6 의 «소프트 = 고객 무영향» 과도 어긋난다.
     ⇒ 판정은 순수 검사 `checkAiCostCap` 으로 하고, **글만 있는 확정일 때만** 알림까지 하는 `requireAiBudget` 를 부른다.
     `requireAiBudget` 자체는 그대로다(R4 글 경로가 계속 쓴다). */
  const hasVideo = specs.some((s) => s.kind === "video" && s.video);
  const capCheck = await checkAiCostCap(tid);
  /* 🔴 [P1R5 §1.4c(1)] 영상이 섞인 확정은 여기서 막지 않는다 — 일일 상한 초과는 영상에서 **소프트**(운영 알림만)다.
     고객은 이미 코인을 냈고, 여기서 막으면 «돈은 받고 안 만들어 주는» 사고가 된다. 폭주는 아래 영상 관문의 **하드(상한 ×3)**·전역 월 상한이 잡는다.
     글만 있는 확정은 R4 규칙 그대로(막고 + 고객 알림 1건/일). */
  if (!capCheck.ok && !hasVideo) { const budget = await requireAiBudget(tid); return { ok: false, step: "ai_cost_cap", error: budget.ok ? "오늘 AI 사용 상한에 닿았어요." : budget.error }; }
  /* `textPiecesPassed` = 같은 확정에 묻어 통과한 글 piece 수(메인 지시) — «영상을 끼워 글 상한을 우회»가 이론상 가능해 운영센터에서 보이게 남긴다.
     글 원가는 영상의 ~1/150 이라 실질 누수는 없다는 판단(메인 승인). */
  if (!capCheck.ok && hasVideo) await writeAudit({ tenantId: tid, action: "ai_cost_soft_video_pass", actorType: "system", riskLevel: "medium", detail: { usedKrw: capCheck.usedKrw, capKrw: capCheck.capKrw, videoPieces: specs.filter((s) => s.kind === "video").length, textPiecesPassed: specs.filter((s) => s.kind !== "video").length, note: "영상 확정 — 일일 상한 초과를 소프트로 통과(§1.4c(1))" } });
  /* [P1R5 §1.2·§1.6] 영상 원가 관문 — **코인 차감 전**에 잰다(코인과 별개 관문). 초과면 원장 무접촉. */
  for (const vs of specs) {
    if (vs.kind !== "video" || !vs.video) continue;
    const pb = await precheckVideoBudget(tid, vs.video.format, vs.video.seconds, vs.video.provider.key, vs.video.cuts);
    if (!pb.ok) return { ok: false, step: "budget", error: pb.error };
  }
  if (!gate.ok) return { ok: false, step: "slot_gate", error: gate.reason ?? "편성표에 없는 자동 생성이에요." };

  const topicId = n(b.topic_id);
  /* [P1R5 §1.11] 레퍼런스 구조 — 소재에 `factors.structureTemplateId` 가 붙어 있으면 그 서사 단계를 영상 meta 에 싣는다.
     `gen.ts` 가 `meta.structure` 를 대본 프롬프트의 «서사 단계 A → B → C» 로 넘긴다(안 실으면 배운 구조가 어디에도 쓰이지 않는다). */
  let refStructure: string[] | null = null; let refTemplateId: number | null = null;
  /* [R8CLOSE · B2] 🔴 여기가 **«배워 놓고 안 읽던» 자리**다. `templateOf` 는 `style`(그림·색·자막·호흡·카메라·규칙·훅원리)을
     통째로 들고 오는데 종전엔 `tpl.structure` 하나만 꺼내고 **나머지를 그 자리에서 버렸다.**
     이제 `applyReferenceStyle` 이 「지금 닿는 것」과 「못 내는 것」으로 갈라, 닿는 것만 piece 에 싣는다.
     🔴 못 낸 것도 **이름과 이유로 남긴다**(`refUnused`) — 렌더가 좋아지면 그게 할 일 목록이다(AC-9). */
  let refStyle: RefStyleApplied | null = null; let refUnused: RefUnused[] = [];
  if (hasVideo) {
    const [tr] = await q(sql`SELECT factors FROM topics WHERE tenant_id = ${tid} AND id = ${topicId}`);
    const tplId = n(((tr?.factors ?? {}) as Record<string, unknown>).structureTemplateId);
    if (tplId) { const tpl = await templateOf(tid, tplId); if (tpl?.structure.length) { refStructure = tpl.structure; refTemplateId = tpl.id;
      const ap = applyReferenceStyle(tpl.style); refStyle = Object.keys(ap.applied).length ? ap.applied : null; refUnused = ap.unused; } }
  }
  // 빌려 쓸 자리의 원래 상태·채널(롤백 복원용 · 채널 대조용). 게이트를 이미 통과했으니 행은 있다.
  let reuseSlotPrevStatus = "topic_assigned", reuseChannel = specs[0].channel, usedReuseSlot = false;
  if (reuseSlotId) {
    const [rs] = await q(sql`SELECT status, channel FROM slots WHERE tenant_id = ${tid} AND id = ${reuseSlotId}`);
    if (rs) { reuseSlotPrevStatus = String(rs.status); reuseChannel = String(rs.channel); }
  }

  /* ══════════ [R7 §1.6] 수동 «만들기»는 **그날 자동 자리를 쓴다** ══════════
     종전엔 사람 경로가 늘 **새 자리를 만들었다**. 자동 편성이 잡아 둔 오늘 자리는 그대로 남아,
     같은 채널에 **하루 두 편**이 나갔다 — 계정 캐던스(daily_cap)를 사람 손으로 우회하는 길이었고,
     사장님 눈엔 «한 번 눌렀는데 두 개가 올라간» 사고로 보인다.
     🔴 자동 경로(origin auto)는 손대지 않는다 — 크론은 `opts.slotId` 로 자리를 못 박아 부른다.
     🔴 코인은 **재차감 0** — 자리를 바꿔 쓰는 것뿐이고 글 1편 값은 아래에서 한 번만 나간다.
        오히려 그 자리를 나중에 크론이 또 만들 일이 없어져 **한 편 값을 아낀다**.
     고르는 규칙: 오늘(KST) · 같은 채널 · 아직 글이 안 붙은 자리(`OPEN_SLOT_STATUS` — 슬롯 게이트와 **같은 어휘**) ·
     같은 계정 자리를 먼저, 그다음 이른 시각 순. */
  const autoSlot = origin === "manual" && !reuseSlotId ? await findTodayOpenSlot(tid, specs[0].channel, specs[0].accountId ?? null) : null;
  /* 이 아래부터는 «크론이 못 박아 준 자리»와 «오늘 찾아낸 자리»를 한 벌로 다룬다(뒤 로직을 두 벌로 만들지 않는다). */
  const takeSlotId = reuseSlotId ?? (autoSlot ? autoSlot.slotId : null);
  const takeChannel = reuseSlotId ? reuseChannel : specs[0].channel;
  const takePrevStatus = reuseSlotId ? reuseSlotPrevStatus : (autoSlot ? autoSlot.prevStatus : "topic_assigned");
  let usedTodaySlot: { slotId: number; channel: string; publishAt: string; prevStatus: string } | undefined;
  const created: { pieceId: number; slotId: number; isVideo?: boolean; reused?: { prevStatus: string } }[] = [];
  let charged = 0;
  const rollback = async (reason: string) => {
    for (const c of created) {
      await refundPiece(tid, c.pieceId);
      // 빌려 쓴 편성 자리는 **지우지 않는다** — 원래 상태로 돌려놓는다(달력에서 자리가 증발하면 그날은 영영 비어 있다).
      if (c.reused) await q(sql`UPDATE slots SET status = ${c.reused.prevStatus}, piece_id = NULL, brief_id = NULL, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${c.slotId}`);
      else await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND id = ${c.slotId}`);
      await q(sql`DELETE FROM piece_assets WHERE piece_id = ${c.pieceId}`);
      await q(sql`DELETE FROM pieces WHERE tenant_id = ${tid} AND id = ${c.pieceId}`);
    }
    console.warn(`[director] confirm 롤백 brief=${briefId} reason=${reason} pieces=${created.map((c) => c.pieceId).join(",")}`);
  };
  try {
    for (const s of specs) {
      const isVideo = s.kind === "video" && !!s.video;
      /* [R8 §2.5] 🔴 카드뉴스 — DESIGN §5B.3 의 세 종류 중 하나. 글 축이라 `content-gen` 으로 만들지만
         **편성·코인·검수에서 «글»과 구분된다.** 판정은 `isCardnewsChannel` 하나만 본다(목록을 여기 또 적지 않는다 · AC-57). */
      const isCard = !isVideo && isCardnewsChannel(s.channel);
      /* [R10-7] 🔴 글은 등급 항목 **한 행**(post_simple|post_standard|post_premium) — 값은 spec 의 `coinCost`(= `pieceCoinCost(aiCount, tier)` · 견적과 같은 식).
         옛 spec(등급 전)은 simple 로 적어서 받는다(AC-93). 사진 항목(`image`)을 따로 세던 줄은 내렸다. */
      const postTier: CoinTier = toCoinTier(s.tier) ?? DEFAULT_COIN_TIER;
      const postCoins = isVideo || isCard ? 0 : pieceCoinCost("post", s.images.aiCount, { format: coinFormatOf(s.channel, s.format), tier: postTier });
      const coinItem = isVideo ? videoCoinItem(s.video!.seconds) : isCard ? "cardnews" : postItemForCoins(postCoins);
      const meta = isVideo
        ? { stage: "script", key: s.key, emotionKey: "script", format: s.format, composition: s.composition, video: applyRefPalette(s.video, refStyle), affiliate: s.monetize.affiliate, sponsored: s.monetize.sponsored, gift: s.monetize.gift, adDisclosure: s.monetize.adDisclosure, scheduleAt: s.schedule.at, slotReason: s.schedule.slotReason, angle: s.angle, coinItem, regenCount: 0, chainResume: { count: 0 }, chainLock: null, ...(refStructure ? { structure: refStructure, structureTemplateId: refTemplateId, ...(refStyle ? { refStyle } : {}), ...(refUnused.length ? { refUnused } : {}) } : {}) }
        : { stage: "writing", key: s.key, emotionKey: s.emotionKey, format: s.format, composition: s.composition, imageCount: s.images.count, aiImageCount: s.images.aiCount, imageStyle: s.images.style, heroNeeded: s.images.heroNeeded, affiliate: s.monetize.affiliate, sponsored: s.monetize.sponsored, gift: s.monetize.gift, adDisclosure: s.monetize.adDisclosure, scheduleAt: s.schedule.at, slotReason: s.schedule.slotReason, angle: s.angle, lengthWords: s.lengthHint.words, coinItem, regenCount: 0,
            /* [R10-7·9] 🔴 등급·계획 코인·스타일을 **글이 들고 있는다** — 정산(`settlePieceCoins`)·재차감·검수 화면이 다시 정하지 않고 이 값을 읽는다(«고르는 자리»가 갈리면 그게 곧 사고 · AC-71·74). */
            ...(isCard ? {} : { tier: postTier, coinPlanned: postCoins }), ...(s.styleId ? { styleId: s.styleId } : {}),
            ...(s.formatPick ? { formatPick: s.formatPick } : {}), ...(s.channelReason ? { channelReason: s.channelReason } : {}), ...(s.personaFit ? { personaFit: s.personaFit } : {}) };
      /* 🔴 [R8 §4.5] **누가 만들었나**를 적는다 — 자동(크론)은 `actorId` 가 없어 **NULL** 이다.
         기계가 만든 글에 «누가»를 지어내지 않는다(AC-9). 이 값이 없으면 «팀원이 만든 글»을 가릴 수 없다. */
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, brief_id, topic_id, account_id, channel, kind, format, status, meta, scheduled_for, created_by)
        VALUES (${tid}, ${briefId}, ${topicId}, ${s.accountId}, ${s.channel}, ${isVideo ? "video" : isCard ? "cardnews" : "post"}, ${s.format}, ${"generating"}, ${jsonb(meta)}, ${s.schedule.at}::timestamptz AT TIME ZONE 'UTC', ${actorId ?? null}) RETURNING id`);
      const pieceId = n(p?.id);
      /* 편성 자리를 빌려 쓰는가(크론) — 아니면 지금처럼 새 자리를 만든다(사람이 «만들기»로 끼워 넣는 글).
         빌려 쓰는 자리는 **채널이 같은 첫 spec 하나**에만 준다(한 자리에 두 글이 들어갈 수 없다). */
      let slotId: number, reused: { prevStatus: string } | undefined;
      if (takeSlotId && !usedReuseSlot && s.channel === takeChannel) {
        usedReuseSlot = true;
        /* [R7 §1.6] 나가는 시각 — 자리의 시각이 **아직 안 지났으면 그 시각**으로 간다(자동 편성이 고른 좋은 시간을 버리지 않는다).
           이미 지난 자리면(09시 자리인데 22시에 눌렀다) 이 글이 원래 잡았던 시각을 쓴다 — 과거로 예약하면 누르자마자 나가 버린다.
           두 행(piece.scheduled_for · slot.publish_at)이 **같은 값**을 갖게 아래에서 둘 다 쓴다(값이 갈라지면 편성표와 실제가 어긋난다). */
        const slotAt = autoSlot ? resolveSlotAt(autoSlot, new Date(s.schedule.at)) : new Date(s.schedule.at);
        const [sl] = await q(sql`UPDATE slots SET piece_id = ${pieceId}, brief_id = ${briefId}, topic_id = ${topicId}, account_id = ${s.accountId},
            status = ${"producing"}, note = NULL, publish_at = ${slotAt.toISOString()}::timestamptz AT TIME ZONE 'UTC', updated_at = NOW()
          WHERE tenant_id = ${tid} AND id = ${takeSlotId} AND piece_id IS NULL RETURNING id`);
        if (!sl) { await rollback("slot_taken"); return { ok: false, step: "slot_gate", error: "편성 자리를 그새 다른 글이 차지했어요." }; }
        slotId = takeSlotId; reused = { prevStatus: takePrevStatus };
        if (autoSlot) {
          await q(sql`UPDATE pieces SET scheduled_for = ${slotAt.toISOString()}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${pieceId}`);
          usedTodaySlot = { slotId, channel: s.channel, publishAt: slotAt.toISOString(), prevStatus: takePrevStatus };
          /* 감사 1행 — 🔴 **await**(응답을 돌려주면 인보케이션이 끝난다 · `void writeAudit` 금지).
             «왜 새 자리가 안 생겼나»를 나중에 설명할 수 있어야 한다(편성표에서 자리 수가 안 늘어난 이유). */
          await writeAudit({ tenantId: tid, action: "manual_used_auto_slot", actorType: "user", actorId, target: `piece:${pieceId}`,
            detail: { slotId, briefId, channel: s.channel, prevStatus: takePrevStatus, publishAt: slotAt.toISOString(), accountId: s.accountId ?? null }, riskLevel: "low" });
        }
      } else {
        const slotDate = kstDateStr(new Date(s.schedule.at));
        const [sl] = await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, topic_id, brief_id, piece_id, publish_at, status, origin)
          VALUES (${tid}, ${slotDate}::date, ${s.channel}, ${isVideo ? "shorts" : isCard ? "cardnews" : "post"}, ${s.accountId}, ${topicId}, ${briefId}, ${pieceId}, ${s.schedule.at}::timestamptz AT TIME ZONE 'UTC', ${"producing"}, ${origin}) RETURNING id`);
        slotId = n(sl?.id);
      }
      await q(sql`UPDATE pieces SET slot_id = ${slotId} WHERE id = ${pieceId}`);
      created.push({ pieceId, slotId, isVideo, ...(reused ? { reused } : {}) });
      /* [R10-7] 🔴 글 한 편 = 등급 항목 한 행. 사유에 등급·AI 장수를 적어 «최근 사용»에서 «글 1편(보통) · AI 사진 3장»으로 읽힌다.
         옛 «포함분을 뺀 사진마다 image 한 행» 은 내렸다 — AI 5장이 5코인이던 식(사장님: «6코인 7코인 지불할 사람은 없다»). */
      const c1 = await consume(tid, coinItem, `piece:${pieceId}`, { actorId, auto: origin === "auto", reason: isVideo ? `${s.video!.seconds}초 영상(${s.channel})` : isCard ? `카드뉴스 ${s.images.count}장(${s.channel})` : `글 1편(${COIN_TIERS[postTier].label} · AI 사진 ${s.images.aiCount}장 · ${s.channel})` });
      if (!c1.ok) { await rollback(c1.reason); return c1.reason === "insufficient" ? { ok: false, step: "coin_short", error: `코인이 ${c1.need}개 부족해요.`, need: c1.need, have: c1.have } : { ok: false, step: "coin_write", error: "코인 차감에 실패했어요. 잠시 후 다시 해 주세요." }; }
      charged += c1.charged;
    }
    const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS t FROM pieces WHERE id = ${created[0].pieceId}`);
    if (chk?.t !== "object") console.error("[director] pieces.meta jsonb_typeof !== object", chk);
    await q(sql`UPDATE briefs SET status = 'confirmed', pieces = ${jsonb(specs)}, coin_cost = ${total} WHERE id = ${briefId}`);
    await q(sql`UPDATE topics SET status = 'used', used_at = NOW() WHERE tenant_id = ${tid} AND id = ${topicId}`);
  } catch (e) {
    await rollback(String((e as Error)?.message ?? e));
    throw e;
  }
  await Promise.all(created.map((c) => (c.isVideo ? triggerVideo(c.pieceId, tid) : triggerGenerate(c.pieceId, tid))));   // ★C4 fix · [P1R5] 영상은 generate-video-background: 호출 실패를 삼키지 않는다(배경 함수는 202 즉답) · piece 여럿이면 동시에
  const bal = await balance(tid);
  return { ok: true, briefId, pieceIds: created.map((c) => c.pieceId), coinsCharged: charged, coinsLeft: bal.balance, ...(usedTodaySlot ? { usedTodaySlot } : {}) };
}

/**
 * 배경 생성 호출 실패 처리 — piece 를 failed 로 내리고 코인 환급·알림·슬롯 표시(content-gen 실패 경로와 같은 처치).
 *   ★C4 fix(2026-09-14 · PITFALLS AC-16): 호출이 실패해도 piece 가 generating 에 남으면 «코인은 빠졌는데 화면은 영원히 만드는 중»이 된다 —
 *   홈 «해야 할 일»은 in_review 만 세므로 사용자에게 아무 신호도 가지 않는다(조용한 0건 금지).
 */
async function failTrigger(tid: number, pieceId: number, reason: string): Promise<void> {
  try {
    const [p] = await q(sql`SELECT slot_id, meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} AND status = 'generating'`);
    if (!p) return;   // 이미 다른 경로가 처리함(멱등)
    const rf = await refundPieceDetailed(tid, pieceId);
    const refunded = rf.granted;
    const meta = (p.meta || {}) as Record<string, unknown>;
    /* 🔴 문장은 `refundLine` 한 곳 — «못 돌려줬다»를 «0개 돌려드렸다»로 말하지 않는다. */
    const body = `«${String(meta.angle || "").slice(0, 40) || "글"}» 을(를) 시작하지 못했어요. ${refundLine(rf)}`;
    // piece·slot·알림을 한 왕복으로(왕복이 늘면 동기 함수 한도 안에서 중간에 잘려 «failed 로만 바뀌고 알림은 없는» 반쪽 상태가 된다 — 실측 2026-09-14)
    await q(sql`WITH up AS (
        UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", failReason: reason, refunded })}, updated_at = NOW()
        WHERE id = ${pieceId} AND tenant_id = ${tid} RETURNING slot_id
      ), sl AS (
        UPDATE slots SET status = 'failed', note = ${reason}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = (SELECT slot_id FROM up) RETURNING id
      )
      INSERT INTO notifications (tenant_id, kind, title, body, link)
      SELECT ${tid}, ${"piece_failed"}, ${"글을 만들지 못했어요"}, ${body}, ${"/app/pieces.html?status=failed"} FROM up`);
  } catch (e) { console.error("[director] failTrigger 실패", String((e as Error)?.message ?? e)); }
}

/** 배경 생성 함수 호출(POST · x-internal-secret). 실패는 전부 정직하게 piece failed + 환급 + 알림(폴백 0). */
export async function triggerGenerate(pieceId: number, tid: number): Promise<boolean> {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) {
    console.error("[director] INTERNAL_SECRET 미설정 — 배경 생성 호출 불가");
    await failTrigger(tid, pieceId, "서버 설정(INTERNAL_SECRET)이 없어 생성을 시작하지 못했어요.");
    return false;
  }
  /* 🔴 [AC-53/54] 자기 배경 함수는 «지금 돌고 있는 이 배포»를 부른다 — `SITE_URL`(정본=라이브)을 먼저 보면 로컬 netlify dev 가
     라이브를 불러 스텁 없이 진짜 LLM·이미지가 돈다(2026-09-15 B-1 실측 $3.63). `backgroundBase` 는 로컬에서 라이브면 **던진다**. */
  let site: string;
  try { site = backgroundBase(); }
  catch (e) { console.error(`[director] ${String((e as Error)?.message ?? e)}`); await failTrigger(tid, pieceId, String((e as Error)?.message ?? "서버 주소가 없어 생성을 시작하지 못했어요.")); return false; }
  // 응답을 기다리되 6초까지만(호출이 «닿았는지»만 보면 된다). 프로덕션의 background 함수는 202 를 즉시 준다.
  //   ⚠️ `netlify dev` 는 -background 함수를 **동기로** 실행한다(PITFALLS AC-12) — 끝까지 기다리면 이 함수가 먼저 타임아웃한다.
  //   따라서 시간 초과(Abort)는 «호출은 닿았다»로 본다 — 생성 결과의 실패는 배경 함수 자신이 failed+환급+알림으로 남긴다.
  try {
    const r = await fetch(`${site}/api/generate-piece-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret }, body: JSON.stringify({ pieceId, tenantId: tid }), signal: AbortSignal.timeout(6_000) });
    if (r.status !== 202 && !r.ok) {
      console.error(`[director] 배경 함수 호출 ${r.status}`);
      await failTrigger(tid, pieceId, `생성을 시작하지 못했어요(서버 응답 ${r.status}).`);
      return false;
    }
    return true;
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") { console.warn(`[director] 배경 함수 응답 대기 6s 초과 — 호출은 닿은 것으로 본다(piece ${pieceId})`); return true; }
    console.error("[director] 배경 함수 호출 실패", String(err?.message ?? e));
    await failTrigger(tid, pieceId, "생성을 시작하지 못했어요(서버에 연결하지 못했어요).");
    return false;
  }
}
