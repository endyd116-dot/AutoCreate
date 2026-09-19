/**
 * lib/piece-self.ts — **내가 직접 쓴 글**을 만드는 한 함수(DESIGN §5D ① · 사장님 «주요 골자» · B-1 2026-09-15).
 *
 *   ══ 🔴 왜 별도 경로인가(§5D.3-1 · AC-65) ══
 *     `director.ts` 의 생성 호출에 «건너뛰기»를 달면 그 문은 나중에 안 닫힌다.
 *     여기는 **AI 를 부르는 코드가 한 줄도 없는** 다른 길이고, 그 대신 아래 것들을 **하나씩 명시적으로** 지난다:
 *       ① 받은 값 → ② 계정 → ③ 언제 → ④ **캐던스** → ⑤ piece → ⑥ **코인 0 기록** → ⑦ 자리 → ⑧ **게이트**.
 *
 *   ══ 지키는 것 ══
 *     · 🔴 코인 0 은 «안 깎음»이 아니라 **«0 으로 기록»**(§5D.3-2) — 원장에 흔적이 있어야 «왜 공짜였나»를 나중에 답한다.
 *     · 🔴 게이트는 **그대로 지난다**(고지·금칙 3층·제휴 상한·최상급·중복·링크·분량·시각 요소). 법과 검색은 «누가 썼나»를 안 따진다.
 *       AI 티 축만 «안 쟀다»로 **표시**한다(`SELF_SKIPPED_GATE_KEYS` · 목록은 서버 한 곳 · «조용히 다 끄기» 금지).
 *     · 🔴 캐던스는 ①에도 그대로(§7.3b) — 계정이 죽는 이유는 자동이든 수동이든 같다.
 *     · `format` 은 **null 로 둔다** — 우리가 구성을 고른 적이 없다(없는 것을 «info» 로 위장하지 않는다 · AC-57).
 *
 *   ══ 왜 핸들러가 아니라 여기인가 ══
 *     HTTP 없이 되짚을 수 있어야 한다. 핸들러 안에 두면 `netlify dev` 를 띄워야 하고, 그건 AC-53 사고가 난 자리다.
 *   🔎 출처: AC 신규(DESIGN §5D · B-1 · 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q, TEXT_CHANNELS } from "./accounts";
import { jsonb, utcDate } from "./db-util";
import { checkCadenceAt, type CadenceVerdict } from "./cadence-check";
import { recheckPiece } from "./content-approve";
import { compensationOfMeta, disclosureTextFor } from "./disclosure";
import { kstDateStr } from "./best-time";
import type { GateReport } from "./ai-tell-gate";
import { blocksCharCount, htmlToPlain } from "./blocks";
import { recordOutcome, riskOf } from "./outcomes";   // [R8 §5F] 되먹임 원장 — 직접 쓴 글도 같은 자리에

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 사용자 HTML 소독 — script·on속성·iframe 제거(`pieces.ts pieces-update` 와 **같은 규칙**). */
export function sanitizeUserHtml(html: string): string {
  return String(html || "").replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "").replace(/javascript:/gi, "").slice(0, 200_000);
}
/** 대가를 받은 글이면 고지를 **첫 요소로** 되돌린다(§16B.4 — 고객이 안 넣었어도 우리가 넣는다). */
function withDisclosure(html: string, comp: { affiliate?: boolean; sponsored?: boolean; gift?: boolean; provider?: string | null }): string {
  const stripped = html.replace(/<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*/gi, "");
  return `<div class="disclosure">${disclosureTextFor({ ...comp, provider: comp.provider ?? null })}</div>\n${stripped}`;
}
/** 태그를 뺀 글자 수 — «본문이 비었나»만 본다(분량 판정은 게이트의 `length` 축이 한다). */
export const plainLen = (html: string) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().length;

export interface SelfPieceInput {
  tenantId: number; userId: number | null;
  channel: string; accountId?: number | null;
  title: string; bodyHtml: string;
  slotId?: number | null; scheduleAt?: string | null;
  monetize?: { sponsored?: boolean; gift?: boolean; affiliate?: unknown } | null;
  /** [R10-4 · §5D] «내가 쓰되 구성만 그 틀로» — 빌려 쓴 스타일(`text_styles.id`). 되먹임 원장이 «이 스타일로 쓴 글»로 묶는다. */
  styleId?: number | null;
  /** 🔴 [2026-09-20 B2] 고객이 «그래도 올릴래요»를 **직접 눌렀나** — 워밍업이 깎은 몫만 그 회차만 넘긴다.
   *  `publish-now` 와 **같은 키 이름**이다(화면이 두 곳에 다른 낱말을 쓰면 그게 갈림이다 · AC-52). 기본은 false(무회귀). */
  warmupOverride?: boolean;
}
export type SelfPieceResult =
  | { ok: true; pieceId: number; status: "in_review"; origin: "self"; coins: { charged: number; ref: string };
      gate: GateReport; slot: { id: number; publishAt: string } | null; notice?: string }
  /** 🔴 `canOverride` 를 **그대로 흘려 보낸다** — 이 값이 여기서 끊기면 화면은 «그래도 올릴래요» 단추를 못 띄우고,
   *  그러면 우리가 방금 낸 문이 **고객에게는 없는 문**이 된다(만들어 놓고 부르는 자리가 없는 것 · AC-69). */
  | { ok: false; step: string; error: string; retryAt?: string; gapMin?: number; dailyCap?: number; postsToday?: number; capped?: boolean; canOverride?: boolean };

const bad = (step: string, error: string): SelfPieceResult => ({ ok: false, step, error });

export async function createSelfPiece(a: SelfPieceInput): Promise<SelfPieceResult> {
  const tid = a.tenantId;

  /* ── ① 받은 값 ── */
  const channel = String(a.channel ?? "").trim();
  if (!TEXT_CHANNELS.has(channel)) return bad("channel", "이 채널에는 글을 올릴 수 없어요.");
  const title = String(a.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) return bad("title", "제목을 적어 주세요.");
  let body = sanitizeUserHtml(a.bodyHtml);
  if (plainLen(body) < 30) return bad("body", "본문이 너무 짧아요. 30자 이상 적어 주세요.");

  const mon = a.monetize ?? {};
  const meta: Record<string, unknown> = {
    stage: "done", origin: "self",
    /* 🔴 HTML 이 정본이다 — 재검사가 블록 대신 HTML 을 본다(`content-approve.ts` 의 `editedByUser` 경로와 같은 자리). */
    editedByUser: true,
    sponsored: mon.sponsored === true, gift: mon.gift === true,
    ...(mon.affiliate && typeof mon.affiliate === "object" ? { affiliate: mon.affiliate } : {}),
  };
  /* [R10-4] 빌려 쓴 스타일 — 남의 집·지운 스타일은 못 쓴다. 있으면 meta 에 적고(검수 화면 «이 스타일로 썼어요») 원장에 실린다. */
  if (n(a.styleId)) {
    const [st] = await q(sql`SELECT id FROM text_styles WHERE tenant_id = ${tid} AND id = ${n(a.styleId)} AND deleted_at IS NULL`);
    if (!st) return bad("style", "그 스타일을 찾지 못했어요.");
    meta.styleId = n(a.styleId);
  }
  const comp = compensationOfMeta(meta);
  if (comp.need) body = withDisclosure(body, { affiliate: comp.affiliate, sponsored: comp.sponsored, gift: comp.gift, provider: comp.provider ?? "coupang" });
  meta.adDisclosure = comp.need;

  /* ── ② 계정 — 안 주면 그 채널의 **활성 계정이 딱 하나일 때만** 고른다(여럿이면 고객이 고른다 · 짐작 금지) ── */
  let accountId = n(a.accountId);
  if (accountId) {
    const [acc] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} AND channel = ${channel}`);
    if (!acc) return bad("account", "고른 계정을 찾지 못했어요.");
  } else {
    const rows = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND channel = ${channel} AND status IN ('active','pending_login') ORDER BY id`);
    if (rows.length === 1) accountId = n(rows[0].id);
    else if (rows.length > 1) return bad("account", "어느 계정에 올릴지 골라 주세요.");
    /* 0개면 계정 없이 만든다 — 만들어 두고 나중에 손으로 올리는 길이 있다(영상 §1.3 과 같은 결). */
  }

  /* ── ③ 언제 — 자리를 빌리거나(slotId) 새 시각(scheduleAt) ── */
  let at: Date;
  let slotRow: Record<string, unknown> | null = null;
  const slotId = n(a.slotId);
  if (slotId) {
    const [s] = await q(sql`SELECT id, channel, publish_at, status, piece_id, account_id FROM slots WHERE tenant_id = ${tid} AND id = ${slotId}`);
    if (!s) return bad("slot", "그 편성 자리를 찾지 못했어요.");
    if (s.piece_id) return bad("slot", "그 자리엔 이미 다른 글이 들어가 있어요.");
    if (String(s.channel) !== channel) return bad("slot", "그 자리는 다른 채널의 자리예요.");
    const parsed = utcDate(s.publish_at);
    if (!parsed) return bad("slot", "그 자리의 시각을 읽지 못했어요.");
    at = parsed; slotRow = s;
    if (!accountId && s.account_id) accountId = n(s.account_id);
  } else {
    const parsed = a.scheduleAt ? new Date(String(a.scheduleAt)) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return bad("when", "언제 올릴지 골라 주세요.");
    if (parsed.getTime() < Date.now() - 60_000) return bad("when", "지난 시각으로는 예약할 수 없어요.");
    at = parsed;
  }

  /* ── ④ 🔴 캐던스 — ①에도 그대로 건다(§5D.5 · §7.3b). 계정이 없으면 걸 대상이 없다. ── */
  if (accountId) {
    const cad: CadenceVerdict = await checkCadenceAt({ tenantId: tid, accountId, channel, at, warmupOverride: a.warmupOverride === true });
    if (!cad.ok) return cad;
  }

  /* ── ⑤ piece — `format` 은 null(우리가 고른 적이 없다) · `origin:"self"` ── */
  const [ins] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, status, origin, title, body, meta, scheduled_for)
    VALUES (${tid}, ${accountId || null}, ${channel}, 'post', 'in_review', 'self', ${title}, ${body}, ${jsonb(meta)},
            ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC') RETURNING id`);
  const pieceId = n(ins?.id);
  if (!pieceId) return bad("insert", "글을 저장하지 못했어요.");

  /* ── ⑥ 🔴 코인 0 **기록**(§5D.3-2) — «안 깎았다»가 아니라 «0 이었다»가 원장에 남아야 한다 ── */
  const coinRef = `self:piece:${pieceId}`;
  await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason, actor_id)
    VALUES (${tid}, 'consume', 'included', 0, 'self', ${coinRef}, ${"직접 쓴 글 — AI 를 쓰지 않았어요"}, ${a.userId ?? null})`);
  /* 🔴 화면에 주는 값은 **원장에서 읽는다** — 리터럴 0 을 돌려주면 나중에 1코인이 붙는 날 화면만 0 이라고 계속 말한다(A 지적). */
  const [coinRow] = await q(sql`SELECT COALESCE(SUM(delta), 0)::int AS sum FROM coin_ledger WHERE tenant_id = ${tid} AND ref = ${coinRef}`);
  const charged = -n(coinRow?.sum);   // 원장은 «쓴 만큼 음수» — 화면엔 «얼마 들었나»로 뒤집어 준다

  /* ── ⑦ 자리 — 빌리거나 새로 만든다 ── */
  let slot: { id: number; publishAt: string } | null = null;
  if (slotRow) {
    const [up] = await q(sql`UPDATE slots SET piece_id = ${pieceId}, account_id = ${accountId || null}, status = 'in_review', origin = 'self', note = NULL, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${n(slotRow.id)} AND piece_id IS NULL RETURNING id, publish_at`);
    if (!up) { await q(sql`DELETE FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`); return bad("slot", "그 자리를 그새 다른 글이 차지했어요."); }
    slot = { id: n(up.id), publishAt: (utcDate(up.publish_at) ?? at).toISOString() };
  } else if (accountId) {
    const [ns] = await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, piece_id, publish_at, status, origin)
      VALUES (${tid}, ${kstDateStr(at)}::date, ${channel}, 'post', ${accountId}, ${pieceId}, ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC', 'in_review', 'self') RETURNING id, publish_at`);
    slot = { id: n(ns?.id), publishAt: (utcDate(ns?.publish_at) ?? at).toISOString() };
  }
  if (slot) await q(sql`UPDATE pieces SET slot_id = ${slot.id} WHERE tenant_id = ${tid} AND id = ${pieceId}`).catch(() => {});

  /* ── ⑧ 게이트 — **그대로 지난다**. ① 정책(안 잰 축 표시)은 `recheckPiece` 안에서 입혀 온다 ── */
  const [row] = await q(sql`SELECT * FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  const gate = await recheckPiece(tid, row as Record<string, unknown>);
  await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);

  /* [R8 §5F] 🔴 **되먹임 원장** — 직접 쓴 글도 같은 자리에 남긴다. `origin:"self"` 가 이 원장의 핵심 칸이다:
     «사람이 쓴 글»과 «AI 가 쓴 글»의 성과를 가를 수 있어야 사장님 지시(«어떻게 쓰는 것이 잘 되나»)에 답할 수 있다.
     🔴 `format` 은 null 그대로 둔다 — 우리가 고른 적이 없다(«info» 로 채우면 원장이 거짓이 된다). */
  const plainBody = htmlToPlain(body);
  await recordOutcome({
    tenantId: tid, pieceId, accountId: accountId || null,
    features: {
      channel, origin: "self", format: null,
      chars: blocksCharCount([{ type: "para", text: plainBody }]),
      paid: { affiliate: comp.affiliate, sponsored: comp.sponsored, gift: comp.gift },
      /* 사진은 이 시점엔 **아직 안 붙었다**(글을 만든 뒤 `piece-photo-add` 로 올린다) — 그래서 **안 싣는다**.
         0 으로 채우면 «사진 없는 글»과 «아직 안 올린 글»이 구별되지 않는다(AC-9). */
    },
    risk: riskOf(gate),
  });

  return {
    ok: true, pieceId, status: "in_review", origin: "self",
    coins: { charged, ref: coinRef }, gate, slot,
    ...(slot ? {} : { notice: "계정을 아직 연결하지 않아 편성표 자리는 잡지 못했어요. 계정을 연결하면 예약할 수 있고, 지금도 글은 저장돼 있어요." }),
  };
}
