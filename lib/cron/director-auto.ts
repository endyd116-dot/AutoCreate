/**
 * lib/cron/director-auto.ts — 디렉터 **자동 모드** 진입점(계약 §1 `slots.produce` · DESIGN §5.3 · §5B.7).
 *   «슬롯이 이미 «무엇을 언제»를 정했다 — 디렉터는 «어떻게»만 정한다.»
 *
 *   ══ propose() 와 무엇이 다른가 ══
 *     사람 경로(`lib/director.ts propose`)는 채널을 **고르고**(최대 3) LLM 1콜로 채널별 앵글을 가른다.
 *     자동 모드는 슬롯이 채널·계정·시각을 이미 못 박았다 → 고를 것이 없다 → **결정론 부분만** 쓴다.
 *       · 앵글: 소재의 앵글 그대로(한 채널뿐이라 «가를» 상대가 없다 — LLM 1콜을 아낀다 = 크론 예산·코인 절약)
 *       · 구성: `pickFormatByPrint`(이름 로테이션 + 골격 지문 거부권 · R8 §2.2) — 사람 경로와 **같은 판정기**
 *       · 이미지 수·감성·제휴·코인: 사람 경로와 같은 규칙(`defaultImageCount`·`contractFor`·intent→coupang·`coinCostOf`)
 *       · 일정: 슬롯의 `publish_at` 그대로(디렉터가 다시 고르지 않는다 — 슬롯이 정본)
 *
 *   🔴 이 파일은 **brief 를 만들어 주기만 한다.** piece 생성·코인 차감·롤백·배경 호출은 `lib/director.ts confirm()` 한 경로다
 *      (두 벌을 만들면 «코인은 차감됐는데 piece 가 없는» 사고가 갈라진 경로에서만 난다 · PITFALLS #11-b).
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q, listAccounts, type AccountRow } from "../accounts";
import { jsonb, utcDate } from "../db-util";
import { contractFor, defaultImageCount, type FormatKey, type WritingContract } from "../writing-contracts";
import { pieceCoinCost, AI_IMAGES_INCLUDED } from "../coin-table";
import { toTopic, type Topic } from "../topics";
import { assignAccount, goalOf, type Affiliate, type PieceSpec } from "../director";
import { pausedAccountIds } from "../account-slots";
import { isHealthTopic, HEALTH_FORBIDDEN_FORMATS } from "../banned-categories";   // [R8-A §4] 건강·의료 소재엔 경험담 구성 금지(의료법 §56)
import { pickFormatByPrint } from "../format-pick";                        // [R8 §2.2] 골격 지문으로 고르기(사람 경로와 같은 함수)
import { printFromMeta, type StructurePrint } from "../structure-print";

const n = (v: unknown) => Number(v || 0);

/** 한국어 글자수 계약 → 어절 근사(사람 경로 `lib/director.ts wordsOf` 와 같은 식 · 그쪽은 비공개라 식만 맞춘다). */
function wordsOf(c: WritingContract): number {
  const w = Math.round(((c.length?.min ?? 1500) + (c.length?.max ?? 2500)) / 2 / 2.2);
  return Number.isFinite(w) && w > 0 ? w : 900;
}
/** [R8] 식은 `lib/coin-table.ts pieceCoinCost` 한 곳 — 화면 견적(`slots-list.coinCost`)과 **같은 숫자**여야 한다. */
const pieceCoin = (aiCount: number, format?: string) => pieceCoinCost("post", aiCount, { format });

/** 그 계정(없으면 그 채널)의 최근 format — 로테이션 재료. 사람 경로와 같은 질의. */
async function recentFormats(tid: number, accountId: number | null, channel: string): Promise<string[]> {
  const rows = accountId
    ? await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND account_id = ${accountId} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`)
    : await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND channel = ${channel} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`);
  return rows.map((r) => String(r.format || "")).filter(Boolean);
}

/** [P1R7 B3] `formatHint` = 그 자리를 만든 규칙(`cadence_rules.format_hint`)이 못 박은 구성. 없으면 로테이션(설계 §5B.3 «비우면 디렉터 로테이션»). */
export interface AutoSlot { id: number; channel: string; accountId: number | null; topicId: number; publishAt: Date | null; date: string; formatHint?: string }

export type AutoBrief =
  | { ok: true; briefId: number; spec: PieceSpec; topic: Topic; coinCost: number;
      /** [P1R7 B3] 규칙이 못 박은 구성을 **못 썼을 때**만 실린다 — 호출자가 슬롯 note 에 남긴다(조용한 무시 0). */
      formatHintIgnored?: { hint: string; reason: string };
      /** [R8 §2.2] 골격이 겹쳐 구성을 **갈아탔을 때만** — 감사 한 줄로 «이 절이 일했다»가 보인다(AC-29). */
      formatSwitched?: { to: string; overlap: number; compared: number; why: string } }
  | { ok: false; step: "no_topic" | "no_account" | "topic_state"; error: string };

/**
 * proposeForSlot — 슬롯 1개 → brief 1개(piece 1개). DB 에 briefs 행을 남긴다(mode 'auto' · status 'proposed').
 *   ⚠️ 계정: 슬롯이 계정을 못 박았으면 그 계정을 **그대로** 쓴다(규칙이 «고정 계정»이라고 말한 자리다).
 *      못 박지 않았으면 `assignAccount`(사람 경로와 같은 판정기 — active|pending_login · posts_today<daily_cap · health 순).
 *      슬롯이 못 박은 계정이 오늘 캡을 넘었으면 **같은 채널의 건강한 계정으로 대신**한다(하루치가 통째로 증발하지 않게 · 못 찾으면 no_account).
 */

/**
 * [R8 §2.2] 그 채널 최근 글 골격 지문 — `structure_repeat` 축과 **같은 조건**(같은 채널 · 영상 제외 · 30일 · 10편).
 *   지문이 없으면 빈 배열 → 고르기는 종전 이름 순서로 떨어진다(«못 쟀다» · AC-9).
 */
async function recentPrintsFor(tid: number, channel: string): Promise<StructurePrint[]> {
  try {
    const rows = await q(sql`SELECT meta->'structurePrint' AS sp FROM pieces
      WHERE tenant_id = ${tid} AND channel = ${channel} AND kind <> 'video'
        AND meta->'structurePrint' IS NOT NULL AND created_at > NOW() - interval '30 days'
      ORDER BY id DESC LIMIT 10`);
    return rows.map((r) => printFromMeta(r.sp)).filter((x): x is StructurePrint => !!x);
  } catch (e) { console.warn("[director-auto] 골격 지문 조회 실패 — 이름 순서로 고른다", String((e as Error)?.message ?? e).slice(0, 120)); return []; }
}

export async function proposeForSlot(tid: number, slot: AutoSlot): Promise<AutoBrief> {
  const [trow] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${slot.topicId}`);
  if (!trow) return { ok: false, step: "no_topic", error: "배정된 소재를 찾을 수 없어요." };
  const topic = toTopic(trow);
  if (!["candidate", "picked"].includes(topic.status)) return { ok: false, step: "topic_state", error: "이미 쓴 소재예요." };

  /* [P1R7 §3.6] 코인이 모자라 «쉬는» 계정 슬롯의 계정은 자동 편성에서 뺀다 — 그 계정만 쉬고 나머지는 그대로 돈다.
     🔴 사람이 만드는 경로(director.propose)는 막지 않는다(고객이 직접 누르는 건 자기 판단). */
  const paused = new Set(await pausedAccountIds(tid));
  const accounts = (await listAccounts(tid)).filter((a) => !paused.has(a.id));
  let acc: AccountRow | null = null;
  if (slot.accountId) {
    const fixed = accounts.find((a) => a.id === slot.accountId) ?? null;
    const usable = fixed && (fixed.status === "active" || fixed.status === "pending_login") && fixed.postsToday < fixed.dailyCap;
    acc = usable ? fixed : assignAccount(accounts, slot.channel);
  } else {
    acc = assignAccount(accounts, slot.channel);
  }
  if (!acc) return { ok: false, step: "no_account", error: `${slot.channel} 에 오늘 글을 올릴 수 있는 계정이 없어요.` };

  const c = await contractFor(slot.channel);
  /* [P1R7 B3] 규칙의 `format_hint` 를 **실제로 읽는다**(전수조사: 저장은 되는데 읽는 코드가 0이었다).
     그 채널 계약에 없는 구성이면 로테이션으로 돌아가되 **왜 못 썼는지**를 호출자에게 돌려준다(슬롯 note → 화면). */
  const hint = String(slot.formatHint ?? "").trim();
  const hintOk = !!hint && c.formats.includes(hint as FormatKey);
  /* [R8-A §4] 🔴 **건강·의료 소재엔 «경험담» 구성을 쓰지 않는다** — 의료법 §56·시행령 §23 은 «환자에 관한 치료경험담 등
     소비자로 하여금 치료 효과를 오인하게 할 우려가 있는 내용»을 막는다. 우리 네이버 기본 구성이 경험담이라, 이 줄이 없으면
     «병원 다녀온 후기» 같은 글이 **구조적으로** 나온다(표현을 아무리 걸러도 형식 자체가 위반). 규칙의 `format_hint` 보다 이게 세다. */
  const health = isHealthTopic(`${topic.title} ${topic.angle ?? ""}`);
  const safeFormats = health ? c.formats.filter((f) => !HEALTH_FORBIDDEN_FORMATS.includes(f)) : c.formats;
  const contractForPick: WritingContract = safeFormats.length && safeFormats.length !== c.formats.length ? { ...c, formats: safeFormats as FormatKey[] } : c;
  const hintBlockedByHealth = hintOk && health && HEALTH_FORBIDDEN_FORMATS.includes(hint);
  /* [R8 §2.2] 자동 편성도 **골격 지문을 보고** 고른다 — 사람 경로(director.propose)와 **같은 함수**를 쓴다.
     둘이 다른 규칙으로 고르면 «자동으로 만든 글»과 «손으로 만든 글»의 생김새가 갈린다. */
  const fpick = pickFormatByPrint(contractForPick, await recentFormats(tid, acc.id, slot.channel), `${topic.id}:${slot.channel}:${acc.id}`, hintOk && !hintBlockedByHealth ? hint : null, await recentPrintsFor(tid, slot.channel),
    { imageCount: defaultImageCount(slot.channel), affiliate: topic.factors.intent === "commercial" || topic.factors.intent === "mixed", intent: topic.factors.intent, title: topic.title });   // 사람 경로와 **같은 규칙**(director.ts affiliateBase)
  const format = fpick.format as FormatKey;
  /* 못 쓴 구성은 «사람말»로 남긴다 — 그 구성의 한국어 이름은 그 채널 계약에만 있어서(못 쓰는 채널엔 없다) **고른 구성**을 말한다.
     원래 힌트 문자열은 감사(detail.formatHint)에 남는다. */
  const formatHintIgnored = hint && !hintOk
    /* 조사(으로/로)가 라벨 끝 글자에 따라 달라져 «…구성으로» 로 고정한다(«비교 후기»으로 같은 어색한 문장 0). */
    ? { hint, reason: `규칙에 정해 둔 구성은 ${(c.label.split(" · ")[0] || slot.channel)}에서 쓸 수 없어 «${c.formatLabel[format] || format}» 구성으로 만들었어요.` }
    : undefined;
  const imageCount = defaultImageCount(slot.channel);
  const intent = topic.factors.intent;
  const affiliate: Affiliate | null = intent === "commercial" ? { provider: "coupang", productQuery: topic.title, slot: "mid" }
    : intent === "mixed" ? { provider: "coupang", productQuery: topic.title, slot: "end" } : null;
  const at = (slot.publishAt ?? new Date(Date.now() + 24 * 3600_000)).toISOString();

  const spec: PieceSpec = {
    key: `${slot.channel}:${acc.id}`, channel: slot.channel, accountId: acc.id, accountHandle: acc.handle,
    format, emotionKey: c.emotionKey, composition: c.formatLabel[format] || format, lengthHint: { words: wordsOf(c) },
    /* [R8] 기본 = **AI 1장 + 나머지 스톡** — 글 한 편 1코인(사장님 승인값). 자동 경로는 고객이 고를 자리가 없으니 언제나 기본값이다. */
    images: { count: imageCount, style: c.images.style, heroNeeded: slot.channel === "naver_blog" || slot.channel === "tistory", aiCount: Math.min(imageCount, AI_IMAGES_INCLUDED) },
    /* [R8-A §4] 자동 경로는 «협찬·무상 제공»을 알 수 없다 — 기본 false. 고객이 검수에서 켠다(켜면 고지가 첫머리에 박힌다). */
    monetize: { affiliate, sponsored: false, gift: false, adDisclosure: !!affiliate },
    schedule: { at, slotReason: "편성표가 정한 시각" }, coinCost: pieceCoin(Math.min(imageCount, AI_IMAGES_INCLUDED), format), angle: topic.angle,
    formatPick: fpick,   // [R8 §2.2] 왜 이 구성인지 — 사람 경로와 **같은 자리**(pieces.meta.formatPick)
  };

  /* [R8 §2.2] «단조로워 보이지 않아요»는 여태 **재지 않고 하던 말**이었다. 이제 잰 값이 있으면 그 값으로 말한다(AC-9).
     갈아탄 경우는 검색량·시즌보다 앞세운다 — 이 글의 생김새가 바뀐 이유라 고객이 알아야 한다. */
  const structureLine = fpick.switched
    ? `최근 ${fpick.compared}편과 구성이 겹쳐서 «${c.formatLabel[format] || format}» 구성으로 바꿔 골랐어요.`
    : fpick.compared ? `최근 ${fpick.compared}편과 구성이 ${Math.round(fpick.overlap * 100)}%만 겹쳐요 — 계정이 단조로워 보이지 않아요.`
      : "직전 글과 다른 구성이라 계정이 단조로워 보이지 않아요.";

  // 사람말 3줄(LLM 0 · 결정론) — 검수 화면이 «왜 이렇게 만들었나»를 말할 수 있어야 한다.
  const reasons = [
    `편성표에 잡힌 ${slot.date.slice(5).replace("-", "/")} 자리라 ${acc.handle ? `@${acc.handle}` : slot.channel}에 ${spec.composition} 구성으로 써요${hintOk ? "(규칙에서 정한 구성이에요)" : ""}.`,
    fpick.switched ? structureLine
      : topic.factors.volume ? `«${topic.title}»는 한 달에 ${topic.factors.volume.toLocaleString()}번 검색돼요${topic.factors.competition === "low" ? " · 경쟁이 낮은 편이에요" : ""}.`
        : topic.factors.seasonal ? `${topic.factors.seasonal} 시즌이라 지금 올리면 좋아요.` : structureLine,
    affiliate ? "상품을 찾는 글이라 제휴 링크와 고지 문구를 넣어요." : "발행 3일 전에 미리 만들어 두고, 조용하면 그대로 나가요.",
  ];

  const goal = goalOf([spec], intent);
  const [b] = await q(sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost)
    VALUES (${tid}, ${topic.id}, ${goal}, ${jsonb([spec])}, ${jsonb(reasons)}, ${"auto"}, ${"proposed"}, ${spec.coinCost}) RETURNING id`);
  const briefId = n(b?.id);
  const [chk] = await q(sql`SELECT jsonb_typeof(pieces) AS t FROM briefs WHERE tenant_id = ${tid} AND id = ${briefId}`);
  if (chk?.t !== "array") console.error("[director-auto] briefs.pieces jsonb_typeof !== array", chk);   // 쓴 직후 확인까지가 쓰기다(PITFALLS #1)
  return { ok: true, briefId, spec, topic, coinCost: spec.coinCost, ...(formatHintIgnored ? { formatHintIgnored } : {}), ...(fpick.switched ? { formatSwitched: { to: format, overlap: fpick.overlap, compared: fpick.compared, why: fpick.why } } : {}) };
}

/** 슬롯 행(DB) → AutoSlot. */
export function toAutoSlot(r: Record<string, unknown>): AutoSlot {
  return {
    id: n(r.id), channel: String(r.channel), accountId: r.account_id ? n(r.account_id) : null,
    topicId: n(r.topic_id), publishAt: utcDate(r.publish_at), date: String(r.d ?? "").slice(0, 10),
    ...(r.format_hint ? { formatHint: String(r.format_hint) } : {}),   // [P1R7 B3] produce 의 SELECT 가 규칙에서 함께 읽어 온다
  };
}
