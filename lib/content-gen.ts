/**
 * lib/content-gen.ts — 글 생성기(하나뿐인 두뇌 · DESIGN §5C · 계약 §4). AM 원본: ../AutoMarketing/lib/content-gen.ts (프롬프트 골격·출력 형식·비계 제거 관례 2026-09-14 이식 · 블록 JSON 출력으로 재설계)
 *   입력 = piece + topic + 집필 계약(채널·감성) + 페르소나(계정 persona_id → 없으면 테넌트 기본 페르소나 자동 생성 · 가짜 구체값 0) + 제휴 여부(계정 쿠팡 키).
 *   출력 = blocks(Block[]) → renderBlocksHtml → pieces.body/blocks/title/meta.tags · 이미지 N장(piece_assets) · gate_report.
 *   프롬프트 6칸 순서 고정: ①역할(독자·말투 계약 원문) ②구성(블록 시퀀스 그대로) ③재료(소재·앵글·검색어·페르소나 사정 1~2·계절·제휴 후보) ④한국 규칙(원화·단위·제목 스타일) ⑤금지(상투 60 원문·최상급·근거 없는 수치·번역투) ⑥출력(JSON 스키마).
 *   유사도(similarity) → 같은 brief 의 다른 piece·같은 계정 30일 글과 > 임계면 앵글을 바꿔 1회 재생성. 게이트(ai-tell-gate) → 실패 항목을 재작성 지시문으로 1회 재생성 · 재실패는 in_review(gate_report).
 *   상태: generating(stage writing→checking→images→done) → in_review · 예외 → failed + meta.failReason + notifications + 코인 환급(refund:piece:{id}).
 */
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { q } from "./accounts";
import { callGeminiJson } from "./ai";
import { CHAIN_HIGH } from "./ai-models";
import { generateImage, type ImageAspect } from "./ai-image";
import { contractFor, structureFor, type WritingContract, type FormatKey } from "./writing-contracts";
import { type Block, normalizeBlocks, renderBlocksHtml, htmlToPlain, blocksToPlain, blocksCharCount, type RenderImage } from "./blocks";
import { runGate, buildRewriteInstruction, needsRewrite, CLICHES, descriptiveCaptionHit, type GateReport } from "./ai-tell-gate";
import { ensureDisclosureFirst, disclosureTextFor } from "./disclosure";
import { maxSimilarity, SAME_BODY_SIMILARITY } from "./similarity";
import { seasonLine } from "./kr-calendar";
import { toTopic, type Topic } from "./topics";
import { decryptObj } from "./creds-crypto";
import { searchProducts, deeplink, envCoupangKeys, subIdFor, type CoupangKeys, type CoupangProduct } from "./affiliate-coupang";
import { refundPiece, settlePieceCoins } from "./coin-ledger";
import { pieceCoinCost, AI_IMAGES_INCLUDED } from "./coin-table";   // [R8] 사진 값 정산 — 식은 coin-table 한 곳
import { writeAudit } from "./audit";
import { AD_LAW_BANNED } from "./banned-words";
import { structurePrint, structureHash } from "./structure-print";   // [R8-A §2] 골격 지문(순수)
import { recordOutcome, riskOf } from "./outcomes";   // [R8 §5F] 되먹임 원장 — «만들 때의 모습»을 남긴다
import { lengthFor, topicGroupOf, resolveGoalDetail, estimateChars, type TopicGroup } from "./writing-contracts";   // [R8-A §2] 주제군 갈래·수익 목적(정본 한 곳) + [R8 §2.1] 분량 추정표

const n = (v: unknown) => Number(v || 0);
type Row = Record<string, unknown>;

export interface PersonaProfile { region?: string; family?: string; job?: string; home?: string; brands?: string[]; tone?: string; interests?: string[]; banned?: string[]; signature?: string }

/* ───────── 재료 ───────── */
async function loadPersona(tid: number, personaId: number | null): Promise<{ id: number; name: string; profile: PersonaProfile }> {
  if (personaId) { const [p] = await q(sql`SELECT id, name, profile FROM personas WHERE tenant_id = ${tid} AND id = ${personaId}`); if (p) return { id: n(p.id), name: String(p.name), profile: (p.profile || {}) as PersonaProfile }; }
  const [any] = await q(sql`SELECT id, name, profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  if (any) return { id: n(any.id), name: String(any.name), profile: (any.profile || {}) as PersonaProfile };
  // 기본 페르소나 자동 생성 — 가짜 구체값(지역명·상호) 금지 · 넓은 사정만
  const profile: PersonaProfile = { family: "1인 가구", job: "직장인", home: "자취", tone: "친근한 존댓말" };
  const [row] = await q(sql`INSERT INTO personas (tenant_id, name, profile) VALUES (${tid}, ${"기본"}, ${jsonb(profile)}) RETURNING id, name, profile`);
  return { id: n(row.id), name: "기본", profile };
}
export function personaTerms(p: PersonaProfile): string[] {
  const out: string[] = [];
  for (const k of ["region", "family", "job", "home"] as const) { const v = String(p[k] ?? "").trim(); if (v) out.push(...v.split(/[\s·,/]+/).filter((w) => w.length >= 2)); }
  for (const k of ["brands", "interests"] as const) for (const v of p[k] ?? []) if (String(v).trim().length >= 2) out.push(String(v).trim());
  return [...new Set(out)];
}
function personaMaterial(p: PersonaProfile, seed: number): string[] {
  const facts: string[] = [];
  if (p.region) facts.push(`사는 곳: ${p.region}`);
  if (p.family) facts.push(`가족: ${p.family}`);
  if (p.job) facts.push(`직업: ${p.job}`);
  if (p.home) facts.push(`집: ${p.home}`);
  if (p.brands?.length) facts.push(`쓰는 브랜드: ${p.brands.slice(0, 3).join(", ")}`);
  if (p.interests?.length) facts.push(`관심사: ${p.interests.slice(0, 3).join(", ")}`);
  if (facts.length <= 2) return facts;
  const a = seed % facts.length, b = (seed * 7 + 3) % facts.length;
  return [...new Set([facts[a], facts[b === a ? (b + 1) % facts.length : b]])];
}

async function coupangKeysFor(tid: number, accountId: number | null): Promise<CoupangKeys | null> {
  if (accountId) {
    const [c] = await q(sql`SELECT enc FROM account_creds WHERE tenant_id = ${tid} AND account_id = ${accountId} AND kind = 'coupang' AND purged_at IS NULL ORDER BY id DESC LIMIT 1`);
    if (c?.enc) { const o = decryptObj<{ accessKey: string; secretKey: string }>(String(c.enc)); if (o?.accessKey && o?.secretKey) return { accessKey: o.accessKey, secretKey: o.secretKey }; }
  }
  return envCoupangKeys();
}

/* ───────── 프롬프트 6칸 ───────── */
function blockSchemaLine(): string {
  return [
    "블록 JSON 모양(type 별 필수 필드):",
    "hook{text} · para{text · 2~4문장} · h2{text} · h3{text} · quote{text · 핵심 한 줄} · list{items[]} · checklist{items[]} · table{rows[][] · 첫 행은 헤더}",
    "image{prompt · 그림을 «만들기 위한» 장면 묘사 한 문장(영문 가능 · 사람·로고·글자 없는 장면 · 이건 독자에게 안 보인다) · caption? · 독자가 보는 한 줄(아래 규칙) · imageIndex 는 0부터 순서대로} · divider{} · tip{text, items?} · faq{items[] · 각 항목 \"질문 | 답\"}",
    "🔴 image.caption 규칙: 사진 대부분엔 **caption 을 넣지 않는다**(블로거는 사진마다 설명을 달지 않는다 · 3장 중 1장 정도만). 넣을 땐 **글쓴이 말투로 25자 이내의 감상·맥락**(예: «팀원들 줄 거라 포장 예쁜 걸로 골랐어요» · «이게 3만원대라니»). 🔴 «~하는 모습» «~이 놓여 있는» «~를 보여주는» 같은 **장면 설명문은 절대 금지** — 그건 prompt 에만 쓴다.",
    "hashtags{items[] · 5~10개 · # 없이} · toc{} · summary{text 또는 items[]} · disclosure{}(시스템이 채운다 · 비워 둠) · adsense{}(빈 블록) · affiliate{}(시스템이 채운다 · 비워 둠)",
  ].join("\n");
}
/** [R8 §2.1] 되짚기가 «무엇이 프롬프트에 실렸나»를 **직접** 볼 수 있게 내보낸다 — 소스를 grep 하는 것은 증거가 아니다(AC-64). */
export function buildPrompt(a: { c: WritingContract; structure: Block["type"][]; topic: Topic; angle: string; persona: PersonaProfile; personaFacts: string[]; affiliateCands: CoupangProduct[] | null; affiliateQuery: string | null; rewrite?: string; goal?: string | null; group?: TopicGroup | null }): { system: string; user: string } {
  const c = a.c;
  const len = lengthFor(c, a.group);
  /* 문단 하나가 져야 할 몫 — 계약 하한 ÷ (이 구성의 예상 분량) × (문단 하나의 예상 분량).
     🔴 숫자를 지어내지 않는다: `estimateChars` 는 우리가 이미 `expandForLength` 에서 쓰는 **같은 추정표**다(잣대 하나). */
  const estTotal = estimateChars(a.structure) || 1;
  const paraFloor = Math.max(150, Math.round((estimateChars(["para"]) * len.min / estTotal) / 10) * 10);
  /* 🔴 [R8-A §2] 수익 목적별 규칙 — 2026-09-15 확인: `briefs.goal` 이 여기까지 **한 번도 안 왔다**(grep 0).
     그래서 «애드센스 목적»과 «애드포스트 목적»이 글을 한 글자도 바꾸지 않았다(선언만 있고 분기 0 · AC-59 계열).
     사장님 질문 «같은 네이버라도 수익 목적에 따라 글 구성을 달리해야 하나?» 의 답이 이 줄들이다. */
  const goalRules = (a.goal && c.goalRules?.[a.goal as keyof typeof c.goalRules]) || [];
  const system = [
    a.rewrite || "",
    `[① 역할 — ${c.label}]`,
    `독자: ${c.reader}`, `말투: ${c.register}`,
    ...c.rules.map((r) => `· ${r}`),
    ...(goalRules.length ? ["", `[①-b 이 글의 수익 목적 — ${a.goal}]`, ...goalRules.map((r) => `· ${r}`)] : []),
    `· 분량: 본문 ${len.min.toLocaleString()}~${len.max.toLocaleString()}자(공백 포함 · 고지·해시태그 제외)${a.group ? ` — 이 글은 «${a.group === "review" ? "후기·리뷰" : a.group === "info" ? "정보성" : "생활정보"}» 라 이 폭이다` : ""}. 하한에 못 미치면 반려된다 — 모자라면 장면·사실을 더 담고 같은 말을 반복하지 않는다.`,
    /* 🔴 [R8 §2.1 · AC-63] 총량만 말하면 안 따라온다 — 실측에서 **블록을 12→17개로 늘리자 글이 오히려 짧아졌다**(1,849→1,503자).
       모델이 «총 분량 감각»을 스스로 갖고 블록이 늘면 나눠 담기 때문이다. 그래서 **문단 하나의 깊이**를 못 박는다.
       이 지시는 ②칸(«순서·개수 그대로»)과 **부딪치지 않는다** — 블록 수가 아니라 한 블록 안의 깊이를 말하기 때문이다. */
    `· 문단 깊이: 본문 문단(para) 하나는 **최소 ${paraFloor.toLocaleString()}자**(3~5문장). 문단 수를 늘려서 분량을 채우지 마라 — 블록 수는 ②가 정한다.`,
    "",
    "[② 구성 — 아래 블록 시퀀스를 «순서·개수 그대로» 채운다(타입 추가·생략 금지)]",
    a.structure.map((t, i) => `${i + 1}.${t}`).join(" → "),
    blockSchemaLine(),
    "",
    "[④ 한국 규칙]",
    "· 가격은 원화(부가세 포함) · 단위는 한국 관행(평/㎡ 병기 · ℓ · cm). 한국 브랜드·한국 계절·한국 검색 습관.",
    `· 제목 스타일: ${c.titleStyle === "naver" ? "네이버형 — 검색어를 앞에, 감정·결과를 뒤에" : c.titleStyle === "google" ? "구글형 — 연도 + 주제 + 총정리/방법" : c.titleStyle === "hook" ? "첫 줄 훅 그 자체" : c.titleStyle === "card" ? "카드 표지(30자 내)" : "대본 제목"} · 예) «${c.titleExample}» · 40자 내.`,
    "",
    "[⑤ 금지 — 하나라도 있으면 반려]",
    `· 상투 표현(전부 금지): ${CLICHES.map((x) => x.label).join(" / ")}`,
    `· 근거 없는 최상급·확정: ${AD_LAW_BANNED.join(", ")}, 최고, 1위, 완벽, 역대급`,
    "· 근거 없는 수치·통계·연구 인용. 재료에 없는 숫자는 쓰지 않는다(«약», «대략» 붙여도 금지).",
    "· 번역투: «~에 의해» «~되어지다» «~의 경우» «~로 인해» «~에 있어서» «~함에 따라» «~을 통해».",
    "· 실존 인물·타인 상호 언급, 의료·효능 단정, 이모지 남발.",
    "",
    "[⑥ 출력 — JSON 하나만]",
    `{ "title": string, "blocks": [Block…], "tags": [string×5~10]${a.affiliateCands ? `, "affiliateChoice": number(0~${a.affiliateCands.length - 1} · 본문 문맥에 가장 맞는 상품)` : ""} }`,
  ].filter((x) => x !== "").join("\n");
  const user = [
    "[③ 재료]",
    `소재: ${a.topic.title}`,
    `앵글(이 글의 관점): ${a.angle}`,
    `검색어: ${a.topic.title.replace(/[,·]/g, " ")}${a.topic.factors.volume ? ` (월 검색 ${a.topic.factors.volume.toLocaleString()})` : ""}`,
    a.personaFacts.length ? `내 사정(1~2개를 실제 장면으로 자연스럽게 · 나열 금지): ${a.personaFacts.join(" / ")}` : "내 사정: 1인 가구 직장인(넓게)",
    a.persona.tone ? `말투 힌트: ${a.persona.tone}` : "",
    a.persona.banned?.length ? `쓰지 말 것: ${a.persona.banned.join(", ")}` : "",
    a.persona.signature ? `마무리 서명(마지막 문단 끝에 그대로): ${a.persona.signature}` : "",
    `계절: ${seasonLine()}`,
    a.affiliateCands?.length ? `제휴 상품 후보(하나를 골라 본문 문맥에 자연스럽게 녹인다 · 가격은 아래 값만): ${a.affiliateCands.map((p, i) => `${i}) ${p.productName} · ${p.productPrice.toLocaleString()}원`).join(" / ")}` : a.affiliateQuery ? `제휴 의도 상품(«${a.affiliateQuery}») — 링크는 시스템이 넣는다. 본문에서 그 물건을 쓴 장면을 1곳 넣어라.` : "",
  ].filter(Boolean).join("\n");
  return { system, user };
}

/* ───────── 블록 후처리 ───────── */
/** 캡션 자리 뽑기(결정론) — 같은 글이면 늘 같은 사진에 캡션이 붙는다(재생성 때 왔다 갔다 하지 않게). */
function captionSlots(count: number, rate: number, seed: number): Set<number> {
  const want = Math.round(count * Math.max(0, Math.min(1, rate)));
  const picked = new Set<number>();
  if (!count || !want) return picked;
  let x = (seed >>> 0) || 1;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => {   // 시드 섞기(간단 LCG)
    x = (x * 1103515245 + 12345) >>> 0; const ra = (x >> 8) & 0xffff;
    x = (x * 1103515245 + 12345) >>> 0; const rb = (x >> 8) & 0xffff;
    return (ra ^ a) - (rb ^ b);
  });
  for (const i of order.slice(0, want)) picked.add(i);
  return picked;
}
const seedOf = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export function fixBlocks(raw: unknown, structure: Block["type"][], c: WritingContract, affiliate: boolean, provider: string | null, seedText = "", comp?: { sponsored?: boolean; gift?: boolean }): Block[] {
  let blocks = normalizeBlocks(raw);
  /* image 블록 — [2026-09-15 §5C 수리] **prompt(그림 지시)** 와 **caption(사람이 읽는 한 줄)** 을 가른다.
     종전엔 한 문장이 두 일을 해서 «~놓여 있는 모습» 묘사문이 캡션으로 발행됐다(사장님 실측 piece 329).
     · prompt 가 없으면(옛 모델 응답·caption 만 온 경우) 옛 caption 을 prompt 로 옮긴다 — 그림에는 묘사문이 맞다.
     · caption 은 ①묘사문이면 버리고 ②25자를 넘으면 버리고 ③`images.captionRate` 만큼만 남긴다(전부 달면 그것도 AI 티) ④앞 문단에서 지어내지 않는다. */
  const imgCount = blocks.filter((b) => b.type === "image").length;
  // 1차: prompt/caption 을 가르고 묘사문·과장(25자 초과) 캡션을 버린다
  let idx = 0;
  blocks = blocks.map((b, i) => {
    if (b.type !== "image") return b;
    const my = idx++;
    const prev = blocks.slice(0, i).reverse().find((x) => (x.type === "para" || x.type === "hook") && x.text);
    const legacyCaptionIsPrompt = !b.prompt && !!b.caption && (descriptiveCaptionHit(b.caption) !== null || [...b.caption].length > 25);
    const prompt = b.prompt || (legacyCaptionIsPrompt ? b.caption : null) || (prev?.text ? String(prev.text).split(/[.!?]\s/)[0].slice(0, 120) : c.label);
    let caption = legacyCaptionIsPrompt ? undefined : b.caption;
    if (caption && (descriptiveCaptionHit(caption) || [...caption].length > 25)) caption = undefined;
    const out: Block = { ...b, imageIndex: my, prompt };
    if (caption) out.caption = caption; else delete out.caption;
    return out;
  });
  // 2차: 비율 — **유효한 캡션이 있는 사진 중에서** `round(전체 × captionRate)` 장만 남긴다(결정론 · 같은 글이면 같은 자리).
  //       전체 사진에서 자리를 먼저 뽑으면 «캡션이 있던 사진»과 어긋나 멀쩡한 캡션을 버리고 0장이 될 수 있다.
  const withCap = blocks.filter((b) => b.type === "image" && b.caption).map((b) => b.imageIndex as number);
  const keepN = Math.round(imgCount * Math.max(0, Math.min(1, c.images.captionRate ?? 0)));
  if (withCap.length > keepN) {
    const pick = captionSlots(withCap.length, keepN / withCap.length, seedOf(seedText || c.channel));
    const keep = new Set(withCap.filter((_, k) => pick.has(k)));
    blocks = blocks.map((b) => (b.type === "image" && b.caption && !keep.has(b.imageIndex as number)) ? (({ caption: _c, ...rest }) => rest)(b) : b);
  }
  // 계약 이미지 수 이상은 자른다(코인 = 확정한 수)
  const wantImages = structure.filter((t) => t === "image").length;
  let seen = 0;
  blocks = blocks.filter((b) => { if (b.type !== "image") return true; seen++; return seen <= wantImages; });
  // 시퀀스에 있던 adsense·toc·summary 가 빠졌으면 자리에 맞춰 보충(시스템 블록)
  if (structure.includes("adsense") && !blocks.some((b) => b.type === "adsense")) {
    const firstH2 = blocks.findIndex((b) => b.type === "h2"); const lastH2 = blocks.map((b) => b.type).lastIndexOf("h2");
    if (lastH2 >= 0) blocks.splice(lastH2, 0, { type: "adsense" });
    if (firstH2 >= 0) blocks.splice(firstH2 + 2, 0, { type: "adsense" });
  }
  if (structure.includes("toc") && !blocks.some((b) => b.type === "toc")) blocks.unshift({ type: "toc" });
  if (structure.includes("hashtags") && !blocks.some((b) => b.type === "hashtags")) blocks.push({ type: "hashtags", items: [] });
  blocks = blocks.filter((b) => b.type !== "affiliate" && b.type !== "disclosure");
  /* [R8-A §4] 대가 3종 — 제휴만이 아니라 협찬(sponsored)·무상 제공(gift)도 고지를 켠다(공정위 «경제적 이해관계»). */
  return ensureDisclosureFirst(blocks, { affiliate, sponsored: comp?.sponsored === true, gift: comp?.gift === true, provider });
}

function insertAffiliate(blocks: Block[], block: Block, slot: string): Block[] {
  const out = [...blocks];
  const endAt = () => { const i = out.findIndex((b) => b.type === "hashtags" || b.type === "faq" || b.type === "summary"); return i >= 0 ? i : out.length; };
  const midAt = () => { const paras = out.map((b, i) => (b.type === "para" ? i : -1)).filter((i) => i >= 0); return paras.length ? paras[Math.floor(paras.length / 2)] + 1 : Math.floor(out.length / 2); };
  if (slot === "both") { out.splice(endAt(), 0, block); out.splice(midAt(), 0, block); }
  else if (slot === "end") out.splice(endAt(), 0, block);
  else out.splice(midAt(), 0, block);
  return out;
}

async function setStage(pieceId: number, stage: string, extra: Record<string, unknown> = {}): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ stage, ...extra })}, updated_at = NOW() WHERE id = ${pieceId}`);
}

/* ───────── 메인 ───────── */
export async function generatePiece(tid: number, pieceId: number): Promise<{ ok: boolean; status: string; reason?: string }> {
  const [p] = await q(sql`SELECT * FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  if (!p) return { ok: false, status: "missing", reason: "piece 없음" };
  if (String(p.status) !== "generating") return { ok: true, status: String(p.status), reason: "already_done" };   // 멱등
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  try {
    const [trow] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${n(p.topic_id)}`);
    if (!trow) throw new Error("소재를 찾을 수 없어요.");
    const topic = toTopic(trow);
    const channel = String(p.channel);
    const accountId = p.account_id ? n(p.account_id) : null;
    const [acc] = accountId ? await q(sql`SELECT id, handle, persona_id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`) : [undefined];
    const persona = await loadPersona(tid, acc?.persona_id ? n(acc.persona_id) : null);
    const c = await contractFor(channel, meta.emotionKey ? String(meta.emotionKey) : null);
    const format = (c.formats.includes(String(p.format) as FormatKey) ? String(p.format) : c.formats[0]) as FormatKey;
    const imageCount = Math.max(0, Math.trunc(n(meta.imageCount ?? c.images.default)));
    const aff = (meta.affiliate && typeof meta.affiliate === "object" ? meta.affiliate : null) as { provider: string; productQuery: string; slot: string } | null;
    const affiliate = !!aff;
    /* [R8-A §2] 🔴 골격을 **글마다 다르게** 낸다 — 계약이 내는 골격이 3~5가지뿐이라 4편째부터 반드시 겹쳤다(스모크 실측).
       seed 는 pieceId — 같은 글은 다시 만들어도 같은 골격이다(재생성 멱등). 3단(필수/선택/억제)은 `applyTiers` 가 적용한다. */
    const group = topicGroupOf({ format, intent: topic.factors?.intent ?? null, title: topic.title });
    const structure = structureFor(c, format, imageCount, affiliate, pieceId, group);
    /* 이 글의 수익 목적 — brief 에 있으면 그걸, 없으면 채널 기본(네이버=애드포스트 · 나머지=애드센스). 제휴가 붙은 글은 affiliate 가 이긴다. */
    const [bg] = p.brief_id ? await q(sql`SELECT goal FROM briefs WHERE id = ${n(p.brief_id)}`) : [undefined];
    /* 🔴 정본 한 곳 — 검수 화면(pieces-get)도 같은 함수를 본다. 출처까지 받아 **왜 이 목적인지**를 meta 에 남긴다(C · R8-A §1.2).
       brief 가 `mixed` 라 채널 기본으로 떨어진 경우가 라이브의 절반이 넘는다 — 안 남기면 다음 사람이 그 차이를 또 추적한다. */
    const goalRes = resolveGoalDetail({ affiliate, briefGoal: bg?.goal as string | null, channel });
    const goal = goalRes.goal;
    if (goalRes.briefGoalIgnored) console.log(`[content-gen] piece ${pieceId} — brief goal «${goalRes.briefGoalIgnored}» 는 ${channel} 에 규칙이 없어 채널 기본 «${goal}» 로 썼다`);
    const angle = String(meta.angle || topic.angle || "");
    const pFacts = personaMaterial(persona.profile, pieceId);
    const terms = personaTerms(persona.profile);

    // 제휴 후보(계정 쿠팡 키 → 3후보)
    let affCands: CoupangProduct[] | null = null; let keys: CoupangKeys | null = null;
    if (aff) { keys = await coupangKeysFor(tid, accountId); if (keys) { const list = await searchProducts(keys, aff.productQuery, 3, subIdFor(pieceId)); if (list.length) affCands = list; } }

    // 유사도 비교 대상 — 같은 brief 의 다른 piece · 같은 계정 최근 30일
    const others = await q(sql`SELECT id, body FROM pieces WHERE tenant_id = ${tid} AND id <> ${pieceId} AND body IS NOT NULL AND (
        brief_id = ${p.brief_id ? n(p.brief_id) : -1} OR (account_id = ${accountId ?? -1} AND created_at > NOW() - interval '30 days')) ORDER BY id DESC LIMIT 12`);
    const otherPlain = others.map((o) => ({ id: n(o.id), text: htmlToPlain(String(o.body)) }));

    await setStage(pieceId, "writing");
    const write = async (rewrite?: string, angleOverride?: string) => {
      const pr = buildPrompt({ c, structure, topic, angle: angleOverride ?? angle, persona: persona.profile, personaFacts: pFacts, affiliateCands: affCands, affiliateQuery: aff && !affCands ? aff.productQuery : null, rewrite, goal, group });
      const r = await callGeminiJson<{ title?: string; blocks?: unknown; tags?: unknown; affiliateChoice?: unknown }>({ purpose: "content", chain: CHAIN_HIGH, role: "high", system: pr.system, user: pr.user, tenantId: tid, ref: `piece:${pieceId}`, mode: "pro", maxOutputTokens: 12_000, timeoutMs: 180_000 });
      if (!r.ok) throw new Error(`글 생성 실패(${r.reason})`);
      const blocks = fixBlocks(r.data?.blocks, structure, c, affiliate, aff?.provider ?? null, `${pieceId}:${topic.title}`, { sponsored: meta.sponsored === true, gift: meta.gift === true });   // seed = 같은 글 · [R8-A §4] 대가 3종이면 캡션 자리가 늘 같다
      const title = String(r.data?.title ?? topic.title).trim().slice(0, 80) || topic.title;
      const tags = (Array.isArray(r.data?.tags) ? r.data.tags : []).map((t) => String(t ?? "").replace(/^#/, "").trim()).filter(Boolean).slice(0, 10);
      const choice = Number.isInteger(Number(r.data?.affiliateChoice)) ? Number(r.data?.affiliateChoice) : 0;
      return { blocks, title, tags, choice, model: r.model };
    };

    let draft = await write();
    const simOf = (d: typeof draft) => maxSimilarity(blocksToPlain(d.blocks), otherPlain.map((o) => o.text));
    let sim = simOf(draft);

    await setStage(pieceId, "checking");
    const gateInput = (blocks: Block[], title: string, s: typeof sim) => ({ blocks, contract: c, personaTerms: terms, meta: { affiliate: aff, adDisclosure: affiliate }, similarity: { score: s.score, against: s.index >= 0 ? `글 #${otherPlain[s.index]?.id}` : undefined }, title, group });   // [R8 §2.1] group — 분량 축이 계약과 **같은 폭**으로 재게(안 주면 채널 기본 폭이라 잣대가 갈린다)
    let report: GateReport = runGate(gateInput(draft.blocks, draft.title, sim));

    /* 🔴 [R8 §2.1 + §9] 다시 쓰기는 **한 번**이고, **좁은 축에서만** 돈다. 두 수리가 여기서 만난다.
       ① [§2.1 · B-1] 종전엔 ①유사도 재생성 ②게이트 재작성이 **따로** 있었고, ①이 돌면 `rewritten` 이 서서 ②가 통째로 건너뛰었다 —
          즉 겹쳐서 다시 쓴 글은 **고지·금칙이 걸려도** 다시 쓰라는 말을 한 번도 못 들었다(C 가 main 에서 독립으로 같은 것을 찾았다).
          ⇒ 게이트를 **먼저** 돌리고 겹침과 게이트 지적을 **한 프롬프트에 합쳐** 한 번만 다시 쓴다(호출 수는 그대로 2).
       ② [§9 · B3] 그 «한 번»도 **계정이 다치는 축**에서만 돈다(`REWRITE_KEYS`) — 상투 표현 하나로 글 값을 두 배 만들지 않는다.
          🔴 축을 지운 게 아니다: 판정은 다 돌고 `gate_report` 에 남는다. **재작성을 부르는 조건만** 좁혔다.
       🔴 지시문(`buildRewriteInstruction`)은 **좁히지 않는다** — 어차피 한 번 쓰는 값이라, 이왕 고칠 때 품질 지적도 같이 말해 주는 편이 낫다. */
    const simBad = sim.score >= SAME_BODY_SIMILARITY && otherPlain.length > 0;
    let rewritten = false;
    if (simBad || needsRewrite(report)) {
      const simInst = simBad
        ? `[다시 쓰기 — 이 글은 이미 있는 글(#${otherPlain[sim.index].id})과 ${Math.round(sim.score * 100)}% 겹친다. 도입 장면·소제목·예시·순서를 전부 다른 관점으로 새로 써라. 같은 문장 재사용 금지.]\n`
        : "";
      const inst = `${simInst}${buildRewriteInstruction(report)}`;
      const second = await write(inst, simBad ? `${angle} — 다른 관점: 반대 경험이나 실패담에서 출발` : undefined);
      const sim2 = simOf(second);
      const r2 = runGate(gateInput(second.blocks, second.title, sim2));
      /* 채택 기준: 겹쳐서 다시 썼으면 **덜 겹치는 쪽**이 우선(그게 다시 쓴 이유다) · 아니면 통과 수가 많은 쪽.
         나빠졌으면 첫 원고를 사람에게 보낸다 — 둘 다 나쁘면 고르는 것이 아니라 사람에게 넘기는 것이 맞다. */
      const better = simBad ? (sim2.score < sim.score || r2.ok) : (r2.ok || r2.checks.filter((x) => x.pass).length >= report.checks.filter((x) => x.pass).length);
      if (better) { draft = second; report = r2; sim = sim2; }
      report = { ...report, rewritten: true };
      rewritten = true;
    }

    // 제휴 링크 블록(딥링크 · affiliate_links)
    let affiliateMeta: { provider: string; url: string; subId: string; productName?: string } | null = null;
    if (aff && affCands && keys) {
      const prod = affCands[Math.max(0, Math.min(affCands.length - 1, draft.choice))];
      const subId = subIdFor(pieceId);
      const url = (await deeplink(keys, prod.productUrl, subId)) || prod.productUrl;
      await q(sql`INSERT INTO affiliate_links (tenant_id, piece_id, provider, sub_id, url, product) VALUES (${tid}, ${pieceId}, ${"coupang"}, ${subId}, ${url}, ${jsonb(prod)})`);
      const block: Block = { type: "affiliate", affiliate: { productName: prod.productName, url, imageUrl: prod.productImage || undefined, price: prod.productPrice || undefined } };
      draft.blocks = insertAffiliate(draft.blocks, block, aff.slot);
      affiliateMeta = { provider: "coupang", url, subId, productName: prod.productName };
    }

    // 이미지
    await setStage(pieceId, "images");
    const images: RenderImage[] = [];
    const imageBlocks = draft.blocks.filter((b) => b.type === "image");
    let okImages = 0;
    await q(sql`DELETE FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'image'`);
    for (const b of imageBlocks) {
      const i = b.imageIndex ?? images.length;
      /* [§5C 수리] 그림은 **prompt** 로 만든다(묘사문은 여기서만 쓴다). caption 은 사람이 읽는 한 줄이고 대부분 없다.
         alt 는 접근성용 — prompt 에서 짧게 파생(화면에 안 보이고 러너는 alt 를 타이핑하지 않는다 · naver-blog.mjs 확인). */
      const scene = b.prompt || b.caption || topic.title;
      const prompt = `${scene}. Context: ${topic.title}. Style: ${c.images.style === "illust" ? "flat illustration" : c.images.style === "infographic" ? "clean infographic without text" : "natural photo"}.`;
      const alt = String(scene).replace(/\s+/g, " ").trim().slice(0, 60);
      const r = await generateImage({ prompt, aspect: c.images.aspect as ImageAspect, tenantId: tid, ref: `piece:${pieceId}:img${i + 1}`, keyPrefix: `autocreate/${tid}/${pieceId}` });
      if (r.ok) {
        okImages++;
        images[i] = { url: r.url, caption: b.caption, alt };
        await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort) VALUES (${tid}, ${pieceId}, ${"image"}, ${r.key}, ${b.caption ?? null}, ${jsonb({ url: r.url, model: r.model, mime: r.mime, alt, prompt: String(scene).slice(0, 300) })}, ${i})`);
      } else {
        console.warn(`[content-gen] piece ${pieceId} 이미지 ${i} 실패: ${r.reason}`);
        images[i] = { url: "", caption: b.caption, alt };
      }
    }
    if (imageBlocks.length && okImages === 0) throw new Error("이미지를 한 장도 만들지 못했어요.");
    const imageFailures = imageBlocks.length - okImages;

    const bodyHtml = renderBlocksHtml(draft.blocks, channel, images);
    /* [R8-A §2 · B-1] 골격 지문을 같이 남긴다 — 🔴 **여기서 안 적으면 `structure_repeat` 축은 견줄 재료가 0 이라 영영 «못 쟀어요» 다**(AC-29).
       영상의 `meta.frameHash` 와 같은 자리·같은 뜻(그림 지문 ↔ 골격 지문). 추가형이라 옛 글엔 없고, 없는 글은 견주기에서 빠진다. */
    const sPrint = structurePrint(draft.blocks);
    const nextMeta = { ...meta, stage: "done", tags: draft.tags, disclosure: (affiliate || meta.sponsored === true || meta.gift === true) ? disclosureTextFor({ affiliate, sponsored: meta.sponsored === true, gift: meta.gift === true, provider: aff?.provider ?? null }) : null, affiliate: affiliateMeta, affiliateHint: aff && !affiliateMeta ? aff.productQuery : undefined, imageFailures, model: draft.model, rewritten,
      structurePrint: sPrint, structureHash: structureHash(sPrint),
      /* [R8 §2.1] 🔴 주제군을 **적어 둔다**. 검수·재검사가 다시 계산하면 재료가 달라 값이 갈린다 —
         여기서는 `intent` 를 알지만(소재에서 온다) 검수 시점엔 없어서 `intent:null` 로 계산되고 있었다.
         분량 폭이 주제군에 달렸으니, 갈리면 **잰 값은 같은데 기준이 다른** 상태가 된다. */
      topicGroup: group,
      goal, goalSource: goalRes.source, ...(goalRes.briefGoalIgnored ? { briefGoalIgnored: goalRes.briefGoalIgnored } : {}) };
    await q(sql`UPDATE pieces SET title = ${draft.title}, body = ${bodyHtml}, blocks = ${jsonb(draft.blocks)}, meta = ${jsonb(nextMeta)}, gate_report = ${jsonb(report)}, status = ${"in_review"}, updated_at = NOW() WHERE id = ${pieceId}`);
    const [chk] = await q(sql`SELECT jsonb_typeof(blocks) AS b, jsonb_typeof(meta) AS m, jsonb_typeof(gate_report) AS g FROM pieces WHERE id = ${pieceId}`);
    if (chk?.b !== "array" || chk?.m !== "object" || chk?.g !== "object") console.error("[content-gen] jsonb_typeof 이상", chk);

    /* [R8 §5F · B-1] 🔴 **되먹임 원장** — «이 글이 어떤 모습이었나»를 **만든 자리에서** 남긴다.
       발행 뒤에 piece 를 되읽으면 그 사이 수정·재생성으로 달라진다. 지금 안 박으면 나중에 복원할 길이 없다.
       성과(조회·수익)는 여기 복사하지 않는다 — 읽을 때 `posts.stats`·`revenue_daily` 와 join 한다.
       🔴 원장이 실패해도 글은 그대로 간다(원장은 «있으면 좋은 것»). 대신 조용히 넘기지 않는다(AC-58 · `recordOutcome` 안에서 크게 적는다). */
    const lenRange = lengthFor(c, group);
    /* 사진 출처 — 스톡·고객 사진이 붙는 경로(B-1(신) `lib/stock/`)가 `meta.photoMix` 를 남기면 그 값이 정본이다.
       🔴 없으면 **우리가 실제로 구운 수**만 적는다(지어내지 않는다 — 지금은 전부 AI 다). */
    const mixFromLoop = { ai: okImages, ...(imageFailures ? { failed: imageFailures } : {}) };
    const photoMix = (meta.photoMix && typeof meta.photoMix === "object" ? meta.photoMix : mixFromLoop) as Record<string, number>;

    /* ══ [R8 · 사장님 승인 2026-09-15] 🔴 **사진 값 정산 — 덜 썼으면 돌려준다. 더 받지는 않는다.** ══
       코인은 **AI 로 구운 사진**에만 붙는다(고객 사진·스톡은 우리 원가가 0이라 0코인). 그런데 사진은
       «내 사진 → 스톡 → AI» 순서로 채워져서 **실제로 AI 를 몇 장 구웠는지는 만들어 봐야 안다.**
       그래서 선차감은 계획값(`meta.aiImageCount`)으로 하고 여기서 실제 값으로 맞춘다.
       🔴 **실제가 계획보다 많아도 더 받지 않는다** — 그 몫은 우리가 안고, 감사에 숫자로 남긴다(조용히 먹지 않는다).
          그래야 «스톡이 비어서 AI 가 다 구웠다»가 운영에 보이고, 재고를 채울 신호가 된다. */
    try {
      const plannedAi = Math.max(0, Math.floor(Number(meta.aiImageCount ?? AI_IMAGES_INCLUDED) || 0));
      const actualAi = Math.max(0, Math.floor(Number(photoMix.ai ?? 0) || 0));
      const want = pieceCoinCost("post", Math.min(plannedAi, actualAi), { format });
      const back = await settlePieceCoins(tid, pieceId, want);
      if (back > 0) {
        await writeAudit({ tenantId: tid, action: "piece_coin_settled", actorType: "system", target: `piece:${pieceId}`,
          detail: { plannedAi, actualAi, want, refunded: back, photoMix } });
      } else if (actualAi > plannedAi) {
        /* 🔴 우리가 안은 몫 — 더 받지 않기로 한 값이다. 숫자로 남겨야 «스톡 재고가 비었다»를 운영이 본다. */
        await writeAudit({ tenantId: tid, action: "piece_ai_over_plan", actorType: "system", riskLevel: "low", target: `piece:${pieceId}`,
          detail: { plannedAi, actualAi, absorbed: pieceCoinCost("post", actualAi, { format }) - pieceCoinCost("post", plannedAi, { format }), photoMix } });
      }
    } catch (e) { console.error("[content-gen] 사진 값 정산 실패 — 글은 그대로 간다", String((e as Error)?.message ?? e).slice(0, 120)); }
    await recordOutcome({
      tenantId: tid, pieceId, accountId,
      features: {
        channel, origin: String(p.origin ?? "auto"), format, topicGroup: group, goal, goalSource: goalRes.source,
        /* [§5F + §라] 이 글이 노린 **검색어** — `lib/topics.ts` 가 `factors.keyword` 를 저장하기 시작하면 **저절로** 실린다(B-1(신) 몫).
           🔴 타입에 아직 없어서 느슨하게 읽는다 — 그 파일을 내가 건드리면 두 세션이 같은 파일에서 부딪친다.
           🔴 없으면 **안 싣는다**: 소재 제목으로 대신하면 모델이 «틀린 문구»를 노린다(AC-57 · 그게 지금 나 있는 구멍이다). */
        ...(() => { const kw = (topic.factors as unknown as Record<string, unknown>)?.keyword; return kw ? { keyword: String(kw).slice(0, 80) } : {}; })(),
        structureHash: structureHash(sPrint),
        structure: { seq: sPrint.seq, h2: sPrint.h2, h3: sPrint.h3, images: sPrint.images, toc: sPrint.toc, ending: sPrint.ending, blocks: sPrint.blocks },
        chars: blocksCharCount(draft.blocks), lengthMin: lenRange.min, lengthMax: lenRange.max,
        photoMix,
        paid: { affiliate: !!affiliateMeta || affiliate, sponsored: meta.sponsored === true, gift: meta.gift === true },
        ...(meta.formatPick && typeof meta.formatPick === "object"
          ? { formatPick: { overlap: n((meta.formatPick as Record<string, unknown>).overlap), compared: n((meta.formatPick as Record<string, unknown>).compared), switched: (meta.formatPick as Record<string, unknown>).switched === true } }
          : {}),
        rewritten, model: draft.model,
      },
      risk: riskOf(report),
    });
    if (p.slot_id) await q(sql`UPDATE slots SET status = 'in_review', updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
    return { ok: true, status: "in_review" };
  } catch (e) {
    const reason = String((e as Error)?.message ?? e).slice(0, 300);
    console.error(`[content-gen] piece ${pieceId} 실패:`, reason);
    const refunded = await refundPiece(tid, pieceId);
    await q(sql`UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", failReason: reason, refunded })}, updated_at = NOW() WHERE id = ${pieceId}`);
    if (p.slot_id) await q(sql`UPDATE slots SET status = 'failed', note = ${reason}, updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"piece_failed"}, ${"글을 만들지 못했어요"}, ${`«${String(meta.angle || "").slice(0, 40) || "글"}» 을(를) 만들다 문제가 생겼어요. 코인 ${refunded}개는 돌려드렸어요.`}, ${`/app/pieces.html?status=failed`})`);
    return { ok: false, status: "failed", reason };
  }
}
