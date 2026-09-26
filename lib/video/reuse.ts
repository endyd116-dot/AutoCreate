/**
 * lib/video/reuse.ts — 🔴 **한 번 만들어 여러 곳에**(R18 · 영상 재사용) 정본 한 벌.
 *
 *   사장님(2026-09-24): «쇼츠로 만든 영상을 릴스·클립에도 똑같이 올려서 한 영상으로 최대 효율을 뽑자»
 *   사장님 결정(2026-09-26): ① 처음 한 번 묻고, 그 뒤론 자동(기본 꺼짐) ② 길이가 안 맞는 채널만 빼고 왜 뺐는지 말해 준다(코인은 한 번)
 *
 *   ══ 이 파일이 정하는 것(계약 v1 · A·B2·C 에 글자 그대로 보냄) ══
 *     · `VIDEO_REUSE_TARGETS` — 재사용 대상 후보. 🔴 `youtube_long` 없음(트리거 §3 · 없는 길) · `threads` 없음(글 축 채널).
 *     · `reuseFit()` — «이 길이면 어디 가고 어디 빠지나» + 빠진 까닭 **문장**(순수 · DB 0). 화면·알림·디렉터가 전부 이 문장을 쓴다.
 *     · `deriveVideoPieces()` — 원본 영상 → 파생 piece N개. 🔴 **같은 `r2_key`** · 🔴 **코인 0**(consume 을 안 부른다).
 *     · `settings.videoReuse` 읽기·쓰기 — 🔴 `tenants.settings` 한 곳(directorAuto 옆 · 새 문 없음). 쓰는 손은 이 파일 하나.
 *
 *   ══ 🔴 지키는 것 ══
 *     1. 코인은 한 번(§4.7 «승계 무료») — 파생은 `consume` 을 부르지 않는다 → 원장 `ref LIKE 'piece:{파생id}%'` **0행**.
 *        파생의 «다시 만들기»는 `pieces-regenerate` 가 거절한다(다시 굽지 않는다).
 *     2. 발행 멱등(§4.7) — 파생은 `external_url`·`channel_ref`·발행 흔적(meta 의 fb*·tt*·th*·ig*·publish*) **없이** 태어난다.
 *        원본을 통째로 베끼면 커넥터가 «이미 나갔다»로 읽고 **조용히 영영 안 나간다**(B2 가 짚었다).
 *     3. 🔴 유튜브는 한 가족에 **최대 1건** — 원본이 `youtube_*` 면 `youtube_*` 전부가 대상에서 빠진다(B2 지적 · 트리거 §3·§6-4).
 *        유튜브는 세로 3분 이하를 전부 쇼츠로 분류해서 **같은 채널에 같은 영상이 두 번** 생기고 하루 쿼터(5)를 두 배로 먹는다.
 *     4. 캐던스·시차(§4.7 · 같은 분에 N곳 금지)는 **B2 몫**이다 — 파생은 `scheduled` · 🔴 `scheduled_for NULL` · `slot_id NULL` 로 태어나고
 *        B2 `scheduleDerived` 가 시각·자리를 박는다(아래 «B2 SEAM»). 발행 크론은 `scheduled_for IS NOT NULL` 만 줍는다(`lib/cron/publisher.ts:71`)
 *        → 시각이 박히기 전엔 **안 나간다.**
 *        🔴 `approved` 로 태우지 않은 까닭(계약 v1 → v1.2 정정): `netlify/functions/pieces.ts` STATUSES 주석(AC-178) —
 *           `approved` 는 «받아는 주는데 제품이 안 만드는 낱말»이라 **화면 어느 칸에도 안 보인다.** 편성이 한 번 밀리면 파생이 사라진 것처럼 된다.
 *           `scheduled` + 시각 없음은 «예약됨 · 시각 잡는 중»으로 **보인다.**
 *     5. §9 — 막지 않는다. «이 채널엔 안 맞아요»는 **말해 주기**다: ①사실 한 줄(`line`) ②어떻게 하면 되는지(`how`). «실패·오류·불가» 0.
 *
 *   🔎 출처: AC 신규(R18 · 2026-09-26 B) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { writeAudit } from "../audit";
import { VIDEO_CHANNEL_MAX_SEC, shortsFormOf, type ChannelMaxSecLit, type ShortsFormat, type VideoSecondsLit } from "../writing-contracts";
import { channelLabelKo } from "../channel-url";
import { VIDEO_SECONDS, isVideoFormat } from "./types";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/* ═══════════ 대상 후보 ═══════════ */

/** 재사용 대상 후보 — 순서가 화면 순서다. 🔴 `youtube_long` 은 **넣지 않는다**(세로 짧은 영상은 긴 영상이 되지 않고 쇼츠가 하나 더 생긴다 · 트리거 §3). */
export const VIDEO_REUSE_TARGETS: readonly string[] = ["youtube_shorts", "reels", "tiktok", "naver_clip", "facebook_reels"];

/** 같은 플랫폼 가족 — 🔴 유튜브는 쇼츠·긴 영상이 **같은 API·같은 동의·같은 쿼터**라 한 가족이다(`channel-registry.ts youtube_long` note). */
function familyOf(channel: string): string { return channel.startsWith("youtube_") ? "youtube" : channel; }

/** 이 원본에서 갈 수 있는 후보 — 원본과 **같은 가족**은 뺀다(원본 채널 자신 포함 · 원본이 youtube_* 면 youtube_* 전부). */
export function reuseTargetsFor(originChannel: string): string[] {
  const fam = familyOf(String(originChannel ?? ""));
  return VIDEO_REUSE_TARGETS.filter((c) => familyOf(c) !== fam);
}

/* ═══════════ 들어가나 · 빠지나 ═══════════ */

export interface ReuseGo { channel: string; label: string; maxSeconds: ChannelMaxSecLit }
export type ReuseSkipWhy = "too_long" | "no_account";
export interface ReuseSkip { channel: string; label: string; maxSeconds: ChannelMaxSecLit; why: ReuseSkipWhy; line: string; how: string }
/** `places` = 1(원본) + `go.length` — 🔴 «몇 곳»은 이 수 그대로다(화면이 세지 않는다). */
export interface ReuseFit { seconds: VideoSecondsLit; places: number; go: ReuseGo[]; skip: ReuseSkip[] }

/** 채널 상한 이하에서 **고를 수 있는 가장 긴 길이**(15|30|60|90) — «30초를 골라 주세요»의 30. */
function longestPickableUnder(max: number): VideoSecondsLit {
  const ok = VIDEO_SECONDS.filter((s) => s <= max);
  return (ok.length ? Math.max(...ok) : 15) as VideoSecondsLit;
}

/**
 * reuseFit — 이 길이의 영상이 고른 채널 중 **어디 가고 어디 빠지나**(순수 · DB 0).
 *   · `channels` 중 후보 밖(`youtube_long` 등)·원본과 같은 가족은 **go 에도 skip 에도 안 든다** — 없는 길이라 말할 것도 없다.
 *   · `connected` 를 주면 계정이 없는 채널은 `skip`(no_account). 안 주면 길이만 잰다.
 *   · 한 채널이 길이도 안 맞고 계정도 없으면 **길이**를 먼저 말한다 — 이 영상에 대한 사실이라서(계정은 다음 영상에도 같은 말이다).
 *   🔴 문장은 여기 한 곳 — 화면(시트·디렉터)과 알림이 같은 글자를 쓴다(두 곳이 따로 지으면 말이 갈린다 · A 요청).
 */
export function reuseFit(input: { originChannel: string; seconds: VideoSecondsLit; channels: readonly string[]; connected?: Readonly<Record<string, boolean>> }): ReuseFit {
  const want = new Set((input.channels ?? []).map(String));
  const go: ReuseGo[] = []; const skip: ReuseSkip[] = [];
  for (const channel of reuseTargetsFor(input.originChannel)) {
    if (!want.has(channel)) continue;
    const maxSeconds = VIDEO_CHANNEL_MAX_SEC[channel];
    if (!maxSeconds) continue;   // 표에 없는 채널은 잴 수 없다 — 지어내지 않는다(AC-9). 지금 후보 다섯은 전부 표에 있다(하니스가 잰다).
    const label = channelLabelKo(channel);
    if (input.seconds > maxSeconds) {
      skip.push({ channel, label, maxSeconds, why: "too_long",
        line: `이 영상은 ${input.seconds}초라 ${label}(최대 ${maxSeconds}초)엔 안 올라가요.`,
        how: `${label}에도 올리시려면 만들 때 ${longestPickableUnder(maxSeconds)}초를 골라 주세요.` });
    } else if (input.connected && !input.connected[channel]) {
      skip.push({ channel, label, maxSeconds, why: "no_account",
        line: `${label} 계정이 아직 연결되지 않았어요.`,
        how: "계정을 연결하시면 같이 올라가요." });
    } else go.push({ channel, label, maxSeconds });
  }
  return { seconds: input.seconds, places: 1 + go.length, go, skip };
}

/** 이 채널에서 고를 수 있는 초 전부(15·30·60·90 중 채널 상한 이하) — 🔴 **포맷 무관**(A 요청: 손보기에서 포맷을 바꾸면 고를 수 있는 초가 바뀐다). */
export function pickableSecondsFor(originChannel: string): VideoSecondsLit[] {
  const max = VIDEO_CHANNEL_MAX_SEC[originChannel] ?? 60;
  return VIDEO_SECONDS.filter((s) => s <= max) as VideoSecondsLit[];
}

/** 영상 piece 가 **실제로 만든** 길이 — `meta.video` 의 포맷·초를 `shortsFormOf` 로 돌린 값(15 는 30 으로 오르고 클립형은 30 으로 내려앉는다). */
export function pieceSecondsOf(meta: unknown): VideoSecondsLit {
  const v = ((meta && typeof meta === "object" ? (meta as Row).video : null) ?? {}) as { format?: unknown; seconds?: unknown };
  const s0 = Number(v.seconds);
  const s: VideoSecondsLit = s0 === 15 || s0 === 30 || s0 === 60 || s0 === 90 ? s0 : 60;   // gen.ts 와 같은 기본값(60)
  const f = (isVideoFormat(v.format) ? v.format : "graphic") as ShortsFormat;
  return shortsFormOf(f, s).seconds as VideoSecondsLit;
}

/* ═══════════ 설정(tenants.settings.videoReuse) ═══════════ */

/** 저장 모양. 🔴 키가 없으면 **꺼짐**(기본) · `askedAt` 이 NULL 이면 아직 한 번도 안 물었다(답을 받은 적이 없다). */
export interface VideoReuseSetting { on: boolean; channels: string[]; askedAt: string | null; askNotifiedAt: string | null }
export type ReuseBasis = "chosen" | "all" | "off";

export function readVideoReuse(settings: unknown): VideoReuseSetting {
  const raw = (settings && typeof settings === "object" ? (settings as Row).videoReuse : null) as Row | null | undefined;
  const r = raw && typeof raw === "object" ? raw : {};
  const channels = Array.isArray(r.channels) ? [...new Set(r.channels.map(String).filter((c) => VIDEO_REUSE_TARGETS.includes(c)))] : [];
  return { on: r.on === true, channels, askedAt: typeof r.askedAt === "string" ? r.askedAt : null, askNotifiedAt: typeof r.askNotifiedAt === "string" ? r.askNotifiedAt : null };
}

/**
 * 무엇으로 셀까(A 계약 `reuseBasis`):
 *   chosen = 켜져 있다 → 고른 채널 · all = 아직 안 물었다 → 후보 전부 · off = 물었고 껐다 → 없음.
 */
export function reuseBasisOf(s: VideoReuseSetting): ReuseBasis { return s.on ? "chosen" : s.askedAt ? "off" : "all"; }
export function basisChannels(s: VideoReuseSetting, basis: ReuseBasis = reuseBasisOf(s)): string[] {
  return basis === "chosen" ? s.channels : basis === "all" ? [...VIDEO_REUSE_TARGETS] : [];
}

export async function loadVideoReuse(tid: number): Promise<VideoReuseSetting> {
  const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  return readVideoReuse(t?.settings);
}

/**
 * 🔴 `settings.videoReuse` 를 쓰는 **유일한 손**. `videoReuse` 키 하나를 통째로 갈아 끼운다(`settings || {videoReuse}` · 다른 키 무손상 ·
 *   `lib/billing/tax.ts`·`lib/export/state.ts` 와 같은 관례). `onlyIfUnasked` 면 «아직 안 물었고 안 알렸다»일 때만 쓴다(알림 멱등 키).
 */
async function writeVideoReuse(tid: number, next: VideoReuseSetting, opts: { onlyIfUnasked?: boolean } = {}): Promise<boolean> {
  const cond = opts.onlyIfUnasked
    ? sql`AND COALESCE(settings->'videoReuse'->>'askedAt', '') = '' AND COALESCE(settings->'videoReuse'->>'askNotifiedAt', '') = ''`
    : sql``;
  const r = await q(sql`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) || ${jsonb({ videoReuse: next })}, updated_at = NOW()
    WHERE id = ${tid} ${cond} RETURNING id`);
  if (!r.length) return false;
  const [chk] = await q(sql`SELECT jsonb_typeof(settings->'videoReuse') AS t, jsonb_typeof(settings->'videoReuse'->'channels') AS c FROM tenants WHERE id = ${tid}`);
  if (chk?.t !== "object" || chk?.c !== "array") console.error("[video/reuse] settings.videoReuse 모양이 틀렸다", chk);   // PITFALLS #1 — 쓴 직후 모양 확인
  return true;
}

/**
 * 설정 저장(설정 화면 · `/api/tenant-settings { videoReuse: { on, channels } }`). 🔴 한 번 답하면 `askedAt` 이 찍혀 **다시 안 묻는다.**
 *   후보 밖 채널(`youtube_long` 등)은 **걸러 버린다** — 저장해도 갈 길이 없다.
 */
export async function saveVideoReuse(tid: number, patch: { on?: unknown; channels?: unknown }): Promise<VideoReuseSetting> {
  const cur = await loadVideoReuse(tid);
  const channels = Array.isArray(patch.channels)
    ? [...new Set(patch.channels.map(String).filter((c) => VIDEO_REUSE_TARGETS.includes(c)))]
    : cur.channels;
  const on = typeof patch.on === "boolean" ? patch.on : cur.on;
  const next: VideoReuseSetting = { on, channels, askedAt: cur.askedAt ?? new Date().toISOString(), askNotifiedAt: cur.askNotifiedAt };
  await writeVideoReuse(tid, next);
  return next;
}

/* ═══════════ 계정 ═══════════ */

type Acc = { id: number; channel: string; personaId: number | null; handle: string };
/** 쓸 수 있는 계정 — 🔴 `lib/director.ts` 의 규칙과 같다(`removed` · `suspended` · `disconnected` 제외). */
async function usableAccounts(tid: number): Promise<Map<string, Acc[]>> {
  const rows = await q(sql`SELECT id, channel, persona_id, handle FROM accounts WHERE tenant_id = ${tid}
    AND channel IN (${sql.join(VIDEO_REUSE_TARGETS.map((c) => sql`${c}`), sql`, `)})
    AND COALESCE(last_error_kind,'') <> 'removed' AND status NOT IN ('suspended','disconnected') ORDER BY id`);
  const m = new Map<string, Acc[]>();
  for (const r of rows) {
    const a: Acc = { id: n(r.id), channel: String(r.channel), personaId: r.persona_id == null ? null : n(r.persona_id), handle: String(r.handle ?? "") };
    m.set(a.channel, [...(m.get(a.channel) ?? []), a]);
  }
  return m;
}
function connectedOf(m: Map<string, Acc[]>): Record<string, boolean> {
  return Object.fromEntries(VIDEO_REUSE_TARGETS.map((c) => [c, (m.get(c)?.length ?? 0) > 0]));
}
/** 대상 채널에서 어느 계정으로 갈까 — 원본 계정과 **같은 페르소나** 먼저(같은 사람이 여러 곳에 올리는 모양), 없으면 먼저 연결한 계정. */
function pickAccount(list: Acc[] | undefined, personaId: number | null): Acc | null {
  if (!list?.length) return null;
  return (personaId != null ? list.find((a) => a.personaId === personaId) : undefined) ?? list[0];
}

/* ═══════════ 화면이 읽는 모양 ═══════════ */

export interface VideoReuseView {
  on: boolean; channels: string[]; asked: boolean; askedAt: string | null;
  targets: { channel: string; label: string; maxSeconds: ChannelMaxSecLit; connected: boolean }[];
}
/** `/api/tenant-settings` GET·POST 의 `videoReuse` — 후보 목록·상한·연결 여부를 **서버가** 준다(화면이 표를 베끼지 않는다 · AC-52). */
export async function videoReuseView(tid: number, s?: VideoReuseSetting): Promise<VideoReuseView> {
  const cur = s ?? await loadVideoReuse(tid);
  const conn = connectedOf(await usableAccounts(tid));
  return {
    on: cur.on, channels: cur.channels, asked: !!cur.askedAt, askedAt: cur.askedAt,
    targets: VIDEO_REUSE_TARGETS.map((channel) => ({ channel, label: channelLabelKo(channel), maxSeconds: VIDEO_CHANNEL_MAX_SEC[channel], connected: conn[channel] })),
  };
}

/**
 * 디렉터 길이 칩 옆 «30초면 네 곳» — 이 원본 채널에서 고를 수 있는 초마다 `ReuseFit` 하나(A 계약 `pieces[i].reuseFit`·`reuseBasis`).
 *   🔴 basis `all`(아직 안 물었다)에서도 계정 없는 후보는 **조용히 빼지 않고** `skip(no_account)` 에 넣는다(A 요청 —
 *      라이브는 영상 계정이 0개라 조용히 빼면 시트가 빈 채로 뜬다). `places` 는 `go` 만 센다(= 실제로 나가는 곳).
 */
export async function reuseFitsForDirector(tid: number, originChannel: string): Promise<{ reuseBasis: ReuseBasis; reuseFit: ReuseFit[] }> {
  const s = await loadVideoReuse(tid);
  const basis = reuseBasisOf(s);
  const connected = connectedOf(await usableAccounts(tid));
  const channels = basisChannels(s, basis);
  return { reuseBasis: basis, reuseFit: pickableSecondsFor(originChannel).map((seconds) => reuseFit({ originChannel, seconds, channels, connected })) };
}

export interface ReuseDerivedRow { pieceId: number; channel: string; label: string; status: string; scheduledFor: string | null; accountId: number | null; handle: string | null }
export type PieceReuseView =
  | { role: "origin"; ask: boolean; seconds: VideoSecondsLit; basis: ReuseBasis; fit: ReuseFit; derived: ReuseDerivedRow[]; skipped: ReuseSkip[] }
  | { role: "derived"; origin: { pieceId: number; channel: string; label: string }; coin: 0; line: string };

/** «처음 한 번 묻기»를 띄울 수 있는 원본 상태 — 영상이 **다 만들어진 뒤**(검수·예약·발행). 만드는 중·실패·버림엔 묻지 않는다. */
const ASKABLE_STATUSES: readonly string[] = ["in_review", "edited", "approved", "scheduled", "publishing", "published"];
/** 파생을 만들 수 있는 원본 상태 — 🔴 **승인된 뒤**. 검수 중이면 고른 채널을 적어 두고 승인 때 만든다. */
const DERIVABLE_STATUSES: readonly string[] = ["approved", "scheduled", "publishing", "published"];

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? "" : "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** `pieces-get` 의 `reuse` — 영상 piece 가 아니면 null. */
export async function pieceReuseView(tid: number, p: Row): Promise<PieceReuseView | null> {
  if (String(p.kind ?? "") !== "video") return null;
  if (p.origin_piece_id != null && n(p.origin_piece_id)) {
    const [o] = await q(sql`SELECT id, channel FROM pieces WHERE tenant_id = ${tid} AND id = ${n(p.origin_piece_id)}`);
    const r = ((p.meta && typeof p.meta === "object" ? (p.meta as Row).reuse : null) ?? {}) as Row;
    const channel = String(o?.channel ?? r.originChannel ?? "");   // 원본 행이 사라졌어도 파생이 들고 있는 이름으로 말한다
    const label = channelLabelKo(channel);
    return { role: "derived", origin: { pieceId: n(p.origin_piece_id), channel, label }, coin: 0, line: `이 영상은 ${label}에서 왔어요 · 코인은 더 안 들어요` };
  }
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Row;
  const s = await loadVideoReuse(tid);
  const accs = await usableAccounts(tid);
  const picked = Array.isArray(meta.reuseChannels) ? (meta.reuseChannels as unknown[]).map(String) : null;
  const basis: ReuseBasis = picked ? "chosen" : reuseBasisOf(s);
  const channels = picked ?? basisChannels(s, basis);
  const seconds = pieceSecondsOf(meta);
  const fit = reuseFit({ originChannel: String(p.channel), seconds, channels, connected: connectedOf(accs) });
  const rows = await q(sql`SELECT p.id, p.channel, p.status, p.scheduled_for, p.account_id, a.handle
    FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id AND a.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tid} AND p.origin_piece_id = ${n(p.id)} ORDER BY p.id`);
  const derived: ReuseDerivedRow[] = rows.map((r) => ({ pieceId: n(r.id), channel: String(r.channel), label: channelLabelKo(r.channel), status: String(r.status),
    scheduledFor: isoOrNull(r.scheduled_for), accountId: r.account_id == null ? null : n(r.account_id), handle: r.handle == null ? null : String(r.handle) }));
  const result = (meta.reuseResult && typeof meta.reuseResult === "object" ? meta.reuseResult : {}) as { skip?: ReuseSkip[] };
  const ask = !s.askedAt && !picked && !derived.length && ASKABLE_STATUSES.includes(String(p.status));
  return { role: "origin", ask, seconds, basis, fit, derived, skipped: Array.isArray(result.skip) ? result.skip : [] };
}

/* ═══════════ 파생 만들기 ═══════════ */

/**
 * 파생 piece 의 meta — 원본 meta 에서 **만들기·발행의 흔적을 뺀 것**.
 *   🔴 발행 멱등 키(`fbReelId`·`ttPublishId`·`thCreationId`·`igCreationId` …)를 그대로 베끼면 커넥터가 «이미 올렸다»로 읽고
 *      파생이 **조용히 영영 안 나간다**(B2 ③). 그래서 접두(fb·tt·th·ig·yt·publish·chain·render)로 통째로 뺀다 — 새 커넥터가 키를 늘려도 새지 않게.
 *   🔴 코인 흔적(`coinItem`·`coinPlanned`·`regenCount`·`refunded`)도 뺀다 — 파생은 코인과 무관하다(§4.7 승계 무료).
 */
const STRIP_EXACT = new Set(["stage", "failReason", "refunded", "coinItem", "coinPlanned", "regenCount", "rejectReason", "reuseChannels", "reuseResult", "reuse", "scheduleAt"]);
const STRIP_PREFIX = /^(chain|render|publish|fb|tt|th|ig|yt)[A-Z]/;
export function derivedMetaOf(originMeta: unknown, reuse: { originPieceId: number; originChannel: string; seconds: VideoSecondsLit; at: string }, scheduleAt: string | null): Row {
  const src = (originMeta && typeof originMeta === "object" ? originMeta : {}) as Row;
  const out: Row = {};
  for (const [k, v] of Object.entries(src)) if (!STRIP_EXACT.has(k) && !STRIP_PREFIX.test(k)) out[k] = v;
  return { ...out, stage: "done", reuse: { ...reuse, coin: 0 }, ...(scheduleAt ? { scheduleAt } : {}) };
}

export interface DeriveCreated { pieceId: number; channel: string; accountId: number }
export type DeriveResult =
  | { ok: true; originPieceId: number; created: DeriveCreated[]; existing: DeriveCreated[]; skip: ReuseSkip[] }
  | { ok: false; originPieceId: number; reason: "not_found" | "is_derived" | "not_ready" | "no_video"; error: string };

/**
 * deriveVideoPieces — 원본 영상 하나 → 파생 piece N개. 🔴 **멱등**(유니크 `(origin_piece_id, channel)` · 이미 있으면 `existing`).
 *   채널: `opts.channels` → 이 글에 고객이 고른 것(`meta.reuseChannels`) → 설정이 켜져 있으면 `settings.videoReuse.channels` → 없으면 아무것도 안 만든다.
 *   파생: status `scheduled` · `scheduled_for`·`slot_id`·`external_url`·`channel_ref`·`published_at` NULL — 시각·자리는 B2 `scheduleDerived`.
 *   파일: 원본 `piece_assets`(video·thumb)를 파생 id 로 복사 — 🔴 **같은 `r2_key`**(다시 굽지 않는다) · meta 통째(durationMs 등) + `reusedFrom`.
 *   🔴 코인: `consume` 을 **부르지 않는다.** 이 함수에 코인 원장 import 가 없는 것이 그 증거다.
 */
export async function deriveVideoPieces(tid: number, originPieceId: number, opts: { channels?: readonly string[]; actorId?: number | null } = {}): Promise<DeriveResult> {
  const [o] = await q(sql`SELECT * FROM pieces WHERE tenant_id = ${tid} AND id = ${originPieceId} AND kind = 'video'`);
  if (!o) return { ok: false, originPieceId, reason: "not_found", error: "그 영상을 찾지 못했어요." };
  if (o.origin_piece_id != null && n(o.origin_piece_id)) return { ok: false, originPieceId, reason: "is_derived", error: "이 영상은 다른 영상에서 왔어요 — 원본에서 골라 주세요." };
  if (!DERIVABLE_STATUSES.includes(String(o.status))) return { ok: false, originPieceId, reason: "not_ready", error: "영상이 올라갈 준비가 되면 같이 올려 드릴게요." };
  const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Row;
  const s = await loadVideoReuse(tid);
  const channels = opts.channels ? [...opts.channels]
    : Array.isArray(meta.reuseChannels) ? (meta.reuseChannels as unknown[]).map(String)
    : s.on ? s.channels : [];
  if (!channels.length) return { ok: true, originPieceId, created: [], existing: [], skip: [] };

  const [vid] = await q(sql`SELECT id FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${originPieceId} AND kind = 'video' LIMIT 1`);
  if (!vid) return { ok: false, originPieceId, reason: "no_video", error: "올릴 영상 파일이 아직 없어요 — 다 만들어지면 같이 올려 드릴게요." };

  const originChannel = String(o.channel);
  const seconds = pieceSecondsOf(meta);
  const accs = await usableAccounts(tid);
  const fit = reuseFit({ originChannel, seconds, channels, connected: connectedOf(accs) });
  const [oa] = o.account_id ? await q(sql`SELECT persona_id FROM accounts WHERE tenant_id = ${tid} AND id = ${n(o.account_id)}`) : [];
  const personaId = oa?.persona_id == null ? null : n(oa.persona_id);
  const at = new Date().toISOString();
  const scheduleAt = isoOrNull(o.scheduled_for);

  const have = new Map((await q(sql`SELECT id, channel, account_id FROM pieces WHERE tenant_id = ${tid} AND origin_piece_id = ${originPieceId}`))
    .map((r) => [String(r.channel), { pieceId: n(r.id), channel: String(r.channel), accountId: n(r.account_id) }]));
  const created: DeriveCreated[] = []; const existing: DeriveCreated[] = [];
  for (const g of fit.go) {
    const prev = have.get(g.channel);
    if (prev) { existing.push(prev); continue; }
    const acc = pickAccount(accs.get(g.channel), personaId);
    if (!acc) continue;   // fit 이 connected 로 이미 걸렀다 — 여기 올 일은 없다(방어)
    const dmeta = derivedMetaOf(meta, { originPieceId, originChannel, seconds, at }, scheduleAt);
    /* 🔴 원본 행에서 **SELECT 로** 베낀다 — title·body·blocks·gate_report 를 JS 로 한 바퀴 돌리지 않는다(jsonb 모양이 그대로 간다 · PITFALLS #1).
       `ON CONFLICT` 가 유니크 부분 인덱스 `pieces_origin_channel_uq` 를 짚는다 — 사람 승인과 마감 크론이 겹쳐도 한 채널에 하나. */
    const [ins] = await q(sql`INSERT INTO pieces (tenant_id, origin, brief_id, topic_id, account_id, channel, kind, format, title, body, blocks, meta, status, gate_report, created_by, origin_piece_id)
      SELECT tenant_id, origin, brief_id, topic_id, ${acc.id}, ${g.channel}, 'video', format, title, body, blocks, ${jsonb(dmeta)}, 'scheduled', gate_report, created_by, id
        FROM pieces WHERE tenant_id = ${tid} AND id = ${originPieceId}
      ON CONFLICT (origin_piece_id, channel) WHERE origin_piece_id IS NOT NULL DO NOTHING
      RETURNING id`);
    if (!ins) {
      const [r] = await q(sql`SELECT id, account_id FROM pieces WHERE tenant_id = ${tid} AND origin_piece_id = ${originPieceId} AND channel = ${g.channel}`);
      if (r) existing.push({ pieceId: n(r.id), channel: g.channel, accountId: n(r.account_id) });
      continue;
    }
    const pieceId = n(ins.id);
    await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort)
      SELECT tenant_id, ${pieceId}, kind, r2_key, caption, COALESCE(meta, '{}'::jsonb) || ${jsonb({ reusedFrom: originPieceId })}, sort
        FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${originPieceId} AND kind IN ('video','thumb') ORDER BY sort, id`);
    created.push({ pieceId, channel: g.channel, accountId: acc.id });
  }
  if (created.length) {
    const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS t, jsonb_typeof(meta->'reuse') AS r FROM pieces WHERE id = ${created[0].pieceId}`);
    if (chk?.t !== "object" || chk?.r !== "object") console.error("[video/reuse] 파생 meta 모양이 틀렸다", chk);   // PITFALLS #1
  }
  /* 원본이 «어디로 갔고 어디서 빠졌나»를 들고 있는다 — 원본 화면의 «클립 — 한 줄»이 이걸 읽는다(`pieceReuseView.skipped`). */
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ reuseResult: { at, seconds, go: [...existing, ...created].map((c) => ({ channel: c.channel, pieceId: c.pieceId })), skip: fit.skip } })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${originPieceId}`);
  await writeAudit({ tenantId: tid, action: "video_reuse_derived", actorType: opts.actorId ? "user" : "system", ...(opts.actorId ? { actorId: opts.actorId } : {}),
    target: `piece:${originPieceId}`, detail: { seconds, created, existing: existing.map((e) => e.pieceId), skip: fit.skip.map((x) => ({ channel: x.channel, why: x.why })), coin: 0 }, riskLevel: "low" });

  /* ─── B2 SEAM ───  🔴 [계약 v1] 파생의 **시각·자리·`scheduled` 전이**는 B2 `scheduleDerived(tid, originPieceId)`(lib/derived-schedule.ts)가 한다.
     B 가 먼저 머지된다 — 없는 파일을 여기서 import 하면 tsc 가 빨갛다. **B2 가 이 줄에 호출을 넣는다.**
     그 전까지 파생은 `scheduled` · `scheduled_for NULL` 이라 발행 크론(`scheduled_for IS NOT NULL` 만 줍는다)이 **안 줍는다**(같은 분에 N곳 0).
     크론으로 줍는 조건: `origin_piece_id IS NOT NULL AND status = 'scheduled' AND scheduled_for IS NULL`. */

  return { ok: true, originPieceId, created, existing, skip: fit.skip };
}

/* ═══════════ 고객의 답(첫 한 번 · 설정 밖) ═══════════ */

/**
 * `/api/pieces-reuse { id, channels, remember }` — 원본 화면의 시트에서 «이대로 예약».
 *   · remember=true  → 설정 켜고(고른 게 있으면) 채널 저장 · askedAt.  remember=false → 이번 영상만 · askedAt 은 찍는다(처음 한 번은 끝났다).
 *   · 원본이 아직 검수 중이면 고른 채널을 `meta.reuseChannels` 에 적어 두고 **승인 때** 만든다(`approvePiece`). 이미 승인됐으면 지금 만든다.
 *   · 🔴 이번 영상에 안 맞는 채널(too_long·no_account)을 보내도 거절하지 않는다 — 설정엔 저장되고 이번엔 `skip` 으로 돌려준다(A 계약 ④).
 */
export async function answerReuse(tid: number, originPieceId: number, body: { channels?: unknown; remember?: unknown }, actorId: number | null): Promise<
  { ok: true; setting: VideoReuseSetting; derive: DeriveResult | null } | { ok: false; status: number; step: string; error: string }> {
  const [o] = await q(sql`SELECT id, kind, status, origin_piece_id FROM pieces WHERE tenant_id = ${tid} AND id = ${originPieceId}`);
  if (!o || String(o.kind) !== "video") return { ok: false, status: 404, step: "not_found", error: "그 영상을 찾지 못했어요." };
  if (o.origin_piece_id != null && n(o.origin_piece_id)) return { ok: false, status: 400, step: "is_derived", error: "이 영상은 다른 영상에서 왔어요 — 원본에서 골라 주세요." };
  const channels = Array.isArray(body.channels) ? [...new Set(body.channels.map(String).filter((c) => VIDEO_REUSE_TARGETS.includes(c)))] : [];
  const remember = body.remember === true;
  const cur = await loadVideoReuse(tid);
  const setting: VideoReuseSetting = remember
    ? { on: channels.length > 0, channels, askedAt: cur.askedAt ?? new Date().toISOString(), askNotifiedAt: cur.askNotifiedAt }
    : { ...cur, askedAt: cur.askedAt ?? new Date().toISOString() };
  await writeVideoReuse(tid, setting);
  /* 🔴 빈 배열도 **답**이다(«이번엔 여기만») — 적어 두면 승인 때 설정이 켜져 있어도 이 영상은 한 곳에만 간다. */
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ reuseChannels: channels })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${originPieceId}`);
  await writeAudit({ tenantId: tid, action: "video_reuse_answer", actorType: "user", ...(actorId ? { actorId } : {}), target: `piece:${originPieceId}`,
    detail: { channels, remember, on: setting.on }, riskLevel: "low" });
  const derive = DERIVABLE_STATUSES.includes(String(o.status)) ? await deriveVideoPieces(tid, originPieceId, { channels, actorId }) : null;
  return { ok: true, setting, derive };
}

/* ═══════════ 승인 때(사람·마감 자동 승인 한 곳 · `approvePiece`) ═══════════ */

/**
 * 원본 영상이 승인된 직후 부른다. 🔴 실패해도 **승인을 되돌리지 않는다** — 원본은 원래 자리로 나가고, 파생만 못 만든 것이다(감사에 남긴다).
 *   · 이 집이 아직 한 번도 답하지 않았으면(§1 ① «처음 한 번») **알림으로 한 번 묻는다** — 자동 승인처럼 사람이 안 보는 경로에도 닿게(§9 ②).
 *     🔴 답이 없으면 **꺼진 채로 둔다**(모르면 안 켠다) — 알림은 `askNotifiedAt` 으로 한 집에 한 번.
 *   · 답이 있으면(설정 켜짐 또는 이 글에 고른 채널) 파생을 만든다.
 */
export async function onOriginApproved(tid: number, p: Row): Promise<DeriveResult | null> {
  if (String(p.kind ?? "") !== "video" || (p.origin_piece_id != null && n(p.origin_piece_id))) return null;
  const id = n(p.id);
  try {
    const s = await loadVideoReuse(tid);
    const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Row;
    const picked = Array.isArray(meta.reuseChannels);
    if (!s.askedAt && !picked) {
      const claimed = await writeVideoReuse(tid, { ...s, askNotifiedAt: new Date().toISOString() }, { onlyIfUnasked: true });
      if (claimed) {
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"video_reuse_ask"}, ${"영상을 다른 곳에도 올릴 수 있어요"},
          ${"첫 영상이 올라갈 준비가 됐어요. 같은 영상을 다른 채널에도 올릴지 한 번만 골라 주세요 — 고르시기 전까지는 지금처럼 한 곳에만 올라가요."},
          ${`/app/piece.html?id=${id}&reuse=ask`})`);
        await writeAudit({ tenantId: tid, action: "video_reuse_ask_notified", actorType: "system", target: `piece:${id}`, detail: { originChannel: String(p.channel) }, riskLevel: "low" });
      }
      return null;
    }
    if (!picked && !s.on) return null;
    return await deriveVideoPieces(tid, id);
  } catch (e) {
    console.error("[video/reuse] 승인 뒤 파생 실패", String((e as Error)?.message ?? e).slice(0, 160));
    await writeAudit({ tenantId: tid, action: "video_reuse_error", actorType: "system", target: `piece:${id}`, detail: { error: String((e as Error)?.message ?? e).slice(0, 300) }, riskLevel: "high" }).catch(() => {});
    return null;
  }
}
