/**
 * 검수 API(계약 P1R1 §4 v1.1/1.3):
 *   GET  /api/pieces-list?status=generating|in_review|scheduled|published|failed|rejected|all(기본 all) → { pieces:[PieceRow] }
 *   GET  /api/pieces-get?id=                      → { piece:PieceDetail }
 *   POST /api/pieces-approve { id }               → { status:"scheduled", scheduledFor } | ✗ { step:"gate", error, gate }   // 고지·금칙어·제휴 링크 수·유사도 재검사
 *   POST /api/pieces-reject { id, reason? }       → { status:"rejected" }
 *   POST /api/pieces-regenerate { id, note? }     → { status:"generating" } | ✗ step regen_limit   // 코인 0(같은 ref) · 1회
 *   POST /api/pieces-update { id, title?, bodyHtml?, monetize? } → { gate:GateReport, bodyHtml }   // bodyHtml 정본 승격(meta.editedByUser) · 고지 첫 요소 재삽입 · 게이트 재검사(정보)
 *     [R8-A] `monetize:{sponsored?,gift?}` = **대가 켜기**(글·영상 **둘 다**). 켜기만 한다(false 는 안 내린다) · **monetize 만 보내도 된다** ·
 *     🔴 `meta.editedByUser` 는 **본문이 실제로 온 경우에만** 찍는다(그 값이 서면 재검사가 블록→HTML 로 바뀐다 · 읽는 곳 `lib/content-approve.ts:155` 한 곳).
 *   GET  /api/pieces-get 응답에 [R8-A] `topicGroup`(없으면 null) · `goal` · `contract`(그 글에 **적용된** 분량·사진·goalRules) 3축.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { claimsLine, type ClaimSummary } from "../../lib/fact-claims";   // [R8 §2.4] 수치 주장 표시 — 문구 한 출처
import { clientIp } from "../../lib/auth";
import { jsonb, utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { type GateReport } from "../../lib/ai-tell-gate";
import { disclosureTextFor, videoDescriptionFirstLine, isDisclosureText, compensationOfMeta, videoBadgeText, videoOpeningCaption } from "../../lib/disclosure";
/* 🔴 발행 직전 재검사·승인 전이는 `lib/content-approve.ts` 한 벌이 정본이다 — 크론(`slots.review_deadline` 자동 승인)이
   같은 판정기·같은 전이를 부른다(사람 승인과 자동 승인의 기준이 갈라지지 않게 · PITFALLS #11-b). */
import { recheckPiece, approvePiece, REVIEW_PIECE_STATUSES, EDITED_PIECE_STATUS } from "../../lib/content-approve";   // [R9-9 C4] «봐주세요» 상태 정본(in_review·edited)
import { triggerGenerate } from "../../lib/director";
import { triggerVideo } from "../../lib/video/gen";
import { paletteLabelKo, hookLabelKo } from "../../lib/video/types";
import { r2PublicUrl, r2PresignGet, r2Configured } from "../../lib/r2";
import { contractFor, topicGroupOf, resolveGoal, lengthFor, imagesFor } from "../../lib/writing-contracts";
import { htmlToPlain, blocksCharCount } from "../../lib/blocks";   // [2026-09-16] 🔴 글자 세는 자는 **하나**다 — 게이트와 같은 함수
import { formatUnusedOf } from "../../lib/format-marks";           // [R9-5] «못 낸 서식» 사람말 투영(정본은 meta.formatMarks)
import { formatCapsOf } from "../../lib/channel-registry";         // [R9-4] 채널 꾸밈 표
import { toCoinTier } from "../../lib/coin-table";                 // [R10-7] 등급 — 글이 들고 있는 값 그대로
import { sql } from "drizzle-orm";

export const config = { path: ["/api/pieces-list", "/api/pieces-get", "/api/pieces-approve", "/api/pieces-reject", "/api/pieces-regenerate", "/api/pieces-update"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
type Row = Record<string, unknown>;
const STATUSES = new Set(["generating", "draft", "in_review", "edited", "approved", "scheduled", "publishing", "published", "awaiting_manual", "failed", "rejected"]);   // [R9-9 C4] edited = 사람이 고친 «봐주세요»

/** 글 스텝 3(writing·images·checking) · [P1R5] 영상 스텝 6(`VideoStage` = script·tts·clips·render·judging·done — A 가 «대본→목소리→장면→합성→검사→완료» 로 그린다). */
const VIDEO_STAGES = ["script", "tts", "clips", "render", "judging", "done", "failed"];
function stageOf(r: Row): string {
  const st = String(r.status); const m = (r.meta || {}) as Record<string, unknown>;
  const isVideo = String(r.kind || "post") === "video";
  if (st === "failed") return "failed";
  if (st !== "generating") return "done";
  const s = String(m.stage || (isVideo ? "script" : "writing"));
  if (isVideo) return VIDEO_STAGES.includes(s) ? s : "script";
  return ["writing", "images", "checking", "done"].includes(s) ? s : "writing";
}
function pieceRow(r: Row): Record<string, unknown> {
  const m = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>;
  const g = (r.gate_report && typeof r.gate_report === "object" ? r.gate_report : null) as GateReport | null;
  const o: Record<string, unknown> = {
    id: n(r.id), channel: String(r.channel), accountHandle: r.handle ? String(r.handle) : null, kind: String(r.kind || "post"), format: String(r.format || ""),
    /* [R8 §5D] 어떻게 만들어졌나 — `self` 면 화면이 «내가 쓴 글»로 그리고 AI 티 얘기를 꺼내지 않는다(A 요청). 옛 글은 "auto". */
    origin: String(r.origin || "auto"),
    title: String(r.title || ""), status: String(r.status), stage: stageOf(r), gateOk: g ? !!g.ok : false, createdAt: utcDate(r.created_at)?.toISOString() ?? "",
  };
  const sf = utcDate(r.scheduled_for); if (sf) o.scheduledFor = sf.toISOString();
  const pa = utcDate(r.published_at); if (pa) o.publishedAt = pa.toISOString();
  if (r.external_url) o.externalUrl = String(r.external_url);
  const cover = r.cover_url ? String(r.cover_url) : r.cover_key ? r2PublicUrl(String(r.cover_key)) : "";
  if (cover) o.coverUrl = cover;
  if (m.failReason) o.failReason = String(m.failReason);
  if (String(r.kind || "post") === "video") {
    // [P1R5] 영상 전용 — 만드는 중 진행(컷 n/N)·목소리 provider·이어달리기 횟수. 화면 스텝 바가 읽는다.
    const cs = (m.chainStage ?? null) as { cutsDone?: unknown; cutsTotal?: unknown } | null;
    if (cs && (cs.cutsDone !== undefined || cs.cutsTotal !== undefined)) o.progress = { done: n(cs.cutsDone), total: n(cs.cutsTotal) };
    const v = (m.video ?? null) as { format?: unknown; seconds?: unknown } | null;
    if (v) o.video = { format: String(v.format ?? ""), seconds: n(v.seconds) };
    const tts = (m.tts ?? null) as { provider?: unknown } | null;
    if (tts?.provider) o.ttsProvider = String(tts.provider);
    const cr = (m.chainResume ?? null) as { count?: unknown } | null;
    if (n(cr?.count) > 0) o.resumeCount = n(cr?.count);
  }
  return o;
}
/* 포스터: 영상은 `thumb`(finalizeRender 가 남긴 것)가 먼저 · 없으면 `image`(글의 대표 사진 · 영상의 정지 컷).
   meta.url 이 없는 자산(영상 쪽)은 r2_key 로 공개 URL 을 만든다(§1.4-6 · pieceRow 에서). */
const PIECE_SELECT = sql`p.*, a.handle,
  (SELECT (c.meta->>'url') FROM piece_assets c WHERE c.piece_id = p.id AND c.kind IN ('thumb','image') ORDER BY (c.kind <> 'thumb'), c.sort LIMIT 1) AS cover_url,
  (SELECT c.r2_key FROM piece_assets c WHERE c.piece_id = p.id AND c.kind IN ('thumb','image') ORDER BY (c.kind <> 'thumb'), c.sort LIMIT 1) AS cover_key`;


/** 사용자가 고지를 지웠어도 첫 요소로 되돌린다(§16B.4). */
function ensureDisclosureHtml(html: string, provider: string | null | undefined, comp?: { affiliate?: boolean; sponsored?: boolean; gift?: boolean }): string {
  const text = comp ? disclosureTextFor({ ...comp, provider: provider ?? null }) : disclosureTextFor(provider);
  const stripped = html.replace(/<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*/gi, "");
  return `<div class="disclosure">${text}</div>\n${stripped}`;
}
/** 사용자 HTML 소독 — script · on속성 · iframe 제거. */
function sanitizeHtml(html: string): string {
  return String(html || "").replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "").replace(/javascript:/gi, "").slice(0, 200_000);
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/pieces-list")) {
      const status = url.searchParams.get("status") || "all";
      const rows = status === "all"
        ? await q(sql`SELECT ${PIECE_SELECT} FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tid} ORDER BY p.id DESC LIMIT 200`)
        /* [R9-9 C4] `?status=in_review` 는 고친 글(edited)도 같이 — «봐주세요» 화면이 사람 손이 닿은 글을 잃지 않게(정본 `REVIEW_PIECE_STATUSES`). */
        : STATUSES.has(status) ? await q(sql`SELECT ${PIECE_SELECT} FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tid}
            AND p.status IN (${sql.join((status === "in_review" ? REVIEW_PIECE_STATUSES : [status]).map((s) => sql`${s}`), sql`, `)}) ORDER BY p.id DESC LIMIT 200`) : [];
      return json({ ok: true, pieces: rows.map(pieceRow) });
    }
    if (path.endsWith("/pieces-get")) {
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [p] = await q(sql`SELECT ${PIECE_SELECT}, t.title AS topic_title FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN topics t ON t.id = p.topic_id WHERE p.tenant_id = ${tid} AND p.id = ${id}`);
      if (!p) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);
      const m = (p.meta || {}) as Record<string, unknown>;
      const isVideo = String(p.kind || "post") === "video";
      /* [P1R5 §1.4-6] 영상은 image 말고 **video·thumb·srt·clip** 도 읽어야 A 가 플레이어·SRT·컷 목록을 그린다.
         URL 은 `meta.url`(글 이미지) 우선 · 없으면 r2_key 로 공개 URL(영상 자산은 키만 있다). */
      const assets = await q(sql`SELECT id, kind, caption, meta, sort, r2_key FROM piece_assets WHERE piece_id = ${id} AND kind IN (${isVideo ? sql.join(["video", "thumb", "srt", "clip", "image", "audio"].map((k) => sql`${k}`), sql`, `) : sql`'image'`}) ORDER BY kind, sort`);
      /* 🔴 영상 자산 URL 은 **서버가 presigned GET 으로 채운다**(계약 §2.1 · A 전제 — 화면이 presign 을 따로 요청하지 않는다).
         `/api/r2-image` 는 png/jpg/webp 만 서빙하고 인증이 없어 영상·나레이션·자막을 거기 태울 수 없다(테넌트 자산 · §4.6). */
      const signed = new Map<string, string>();
      if (isVideo && r2Configured()) {
        await Promise.all([...new Set(assets.map((x) => String(x.r2_key ?? "")).filter(Boolean))].map(async (k) => {
          try { signed.set(k, await r2PresignGet(k)); } catch (e) { console.warn("[pieces] presign 실패", k, String((e as Error)?.message ?? e).slice(0, 80)); }
        }));
      }
      const urlOf = (x: Row) => {
        const key = String(x.r2_key ?? "");
        return signed.get(key) || String(((x.meta || {}) as Record<string, unknown>).url || "") || (key ? r2PublicUrl(key) : "");
      };
      const g = (p.gate_report && typeof p.gate_report === "object" ? p.gate_report : { ok: false, checks: [], rewritten: false }) as GateReport;
      const meta: Record<string, unknown> = { tags: Array.isArray(m.tags) ? m.tags : [], disclosure: m.disclosure ?? null };
      if (m.affiliate && typeof m.affiliate === "object") { const af = m.affiliate as Record<string, unknown>; meta.affiliate = { provider: af.provider, url: af.url, subId: af.subId }; }
      if (m.scheduleAt) meta.scheduleAt = m.scheduleAt;
      if (m.slotReason) meta.slotReason = m.slotReason;
      /* [R8CLOSE-B1 §B8] 🔴 **왜 이 채널인가** — 채널이 둘 이상인 집에서만 값이 있다(하나면 고를 것이 없다).
         `slotReason`(왜 이 시각인가) 과 같은 자리·같은 뜻이다. */
      if (m.channelReason) meta.channelReason = m.channelReason;
      /* [R8CLOSE-B1 §B2] 🔴 **왜 이 계정인가** — 적합도가 낮아도 **배정은 됐다**(§9 막지 않는다).
         `measured:false` 를 그대로 싣는다 — «못 쟀다»를 «0점»으로 그리면 화면이 거짓말한다(AC-9). */
      if (m.personaFit && typeof m.personaFit === "object") meta.personaFit = m.personaFit;
      if (m.angle) meta.angle = m.angle;
      /* [R8CLOSE §B5 · B2] 🔴 쓰레드 **연결글**이 온전히 안 나간 경우 — 그 글 화면이 쓸 재료.
         `meta` 는 **화이트리스트**라 여기 안 적으면 칸이 DB 에 있어도 **화면까지 길이 없다** — 재료만 만들고 길을 안 내면
         A 는 그릴 수가 없고, 그러면 «만들어 놓고 아무도 안 쓴다»가 **한 칸 앞에서** 다시 난다.
         🔴 감사(`threads_chain_*`)는 **운영자만** 본다 — 고객에게 닿는 길은 이 칸뿐이다(CLAUDE §9-2).
         · `thChainCut`     = 문장 한가운데서 끊었나 · 어디서 끊었나 · 버린 글자
         · `thChainPartial` = 몇 조각 중 몇까지 올라갔나 + **못 올린 글 그대로**(§9-4 — 고객이 이어 붙일 수 있게)
         ⚠️ 아직 **화면에 그려진 곳은 0곳**이다(A 몫). 여기까지가 서버가 할 수 있는 데다. */
      if (m.thChainCut && typeof m.thChainCut === "object") meta.thChainCut = m.thChainCut;
      if (m.thChainPartial && typeof m.thChainPartial === "object") meta.thChainPartial = m.thChainPartial;
      /* [R8 §2.4] 🔴 **수치 주장 표시** — 근거 있는 수치와 없는 수치를 갈라 검수 화면이 보여 준다(A 와 합의한 칸 `numberClaims`).
         🔴 화면 문구는 «틀렸어요»가 아니라 **«우리가 준 자료에 없는 숫자예요 — 확인해 주세요»** 다(`claimsLine`).
            우리는 그 숫자가 맞는지 **모른다**. 아는 것은 «우리가 준 숫자인가»뿐이다(AC-57). */
      if (m.numberClaims && typeof m.numberClaims === "object") {
        const nc = m.numberClaims as { summary?: ClaimSummary; items?: unknown };
        if (nc.summary) meta.numberClaims = { summary: nc.summary, items: Array.isArray(nc.items) ? nc.items : [], line: claimsLine(nc.summary) };
      }
      /* [R8CLOSE-B1 §B9] 🔴 **대표 이미지** — `heroNeeded` 가 «적히기만» 하던 것을 검수 화면까지 잇는다(칸 이름 `hero`).
         `line` 은 서버가 정본이다(화면이 따로 지으면 두 곳이 갈린다 · `numberClaims` 와 같은 관례).
         🔴 `pinned:false` 를 **그대로 싣는다** — «에디터에서 대표로 콕 집었다»고 화면이 말하면 그게 거짓말이다(B7 · R10). */
      if (m.hero && typeof m.hero === "object") meta.hero = m.hero;
      /* [2026-09-16 · A2 가 화면 만들기 전에 찾음] 🔴 **참고 글에서 못 쓴 것** — `lib/director.ts` 가 `meta.refUnused` 에 적는데
         이 화이트리스트에 없어서 **화면까지 오는 길이 아예 없었다.** `numberClaims` 가 겪은 그 자리인데 **한 칸 더 앞이다**
         (그땐 서버가 보내긴 했고, 이건 안 보냈다). 모양은 `[{ field, why }]` — 왜 못 썼는지를 사람말로 들고 있다. */
      if (Array.isArray(m.refUnused) && m.refUnused.length) meta.refUnused = m.refUnused;
      /* [R9-5 · B] 🔴 **이 채널에서 못 낸 서식** — 영상 `refUnused` 와 같은 모양(`[{field, label, why, n}]`) 이라 A 가 그 화면을 그대로 쓴다.
         정본은 `meta.formatMarks`(내부 · 생성 + 발행 뒤 러너 append) 이고 여기서 **매번 투영**한다(저장 두 벌 금지). `label` 은 서버 정본(AC-52) · `why` 는 화면이 안 그린다(AC-91).
         비어 있으면 키를 안 싣는다(«없음»을 «[]»로 보내면 화면이 빈 칸을 그린다). */
      { const fu = formatUnusedOf(m.formatMarks); if (fu.length) meta.formatUnused = fu; }
      if (m.formatMarks && typeof m.formatMarks === "object") {
        const fm = m.formatMarks as Record<string, unknown>;
        /* 러너 자가검사 값도 같이 — `bleed` 가 **없으면 «못 쟀다»**(키를 만들지 않는다 · AC-92). `breakFails > 0` 은 «뒤 문단이 앞 서식을 물려받았을 수 있다»는 뜻이라 값이 있다. */
        const fs: Record<string, unknown> = {};
        const bl = fm.bleed as { pct?: unknown } | number | undefined;
        if (typeof bl === "number") fs.bleed = bl; else if (bl && typeof bl === "object" && typeof bl.pct === "number") fs.bleed = bl.pct;   // 번진 문단 비율(%) · 없으면 «못 쟀다»
        if (typeof fm.breakFails === "number") fs.breakFails = fm.breakFails;
        if (typeof fm.htmlMode === "number" && fm.htmlMode > 0) fs.htmlMode = fm.htmlMode;   // [R9-11] 티스토리 기본 모드로 내려앉은 횟수
        if (fm.runnerReportedAt) fs.reportedAt = fm.runnerReportedAt;
        if (Object.keys(fs).length) meta.formatSelfCheck = fs;
      }
      /* [R9-8] 계정 간 유사도(숫자·id 만) — 게이트 축 `cross_account` 와 같은 값. `measured:false` 그대로(«못 쟀다» ≠ 0점). */
      if (m.crossSimilarity && typeof m.crossSimilarity === "object") meta.crossSimilarity = m.crossSimilarity;
      /* [R10-7·9] 🔴 등급과 **실제로 빠진 코인**(정산 뒤 `coins = {tier, planned, charged, returned, actualAi, line}` · line 은 서버 문장 — «프리미엄으로 만들었는데 내 사진으로 채워서 1코인만 받았어요»).
         `tier` 는 글이 들고 있는 값 그대로(옛 글엔 없다 → 키 없음 · «간단히»로 위장하지 않는다). `coins` 는 정산이 돈 뒤에만 있다. */
      { const t = toCoinTier(m.tier); if (t) meta.tier = t; }
      if (m.coins && typeof m.coins === "object") meta.coins = m.coins;
      /* [R10-4] 이 글에 쓴 스타일 — id + 사람이 읽는 이름(화면이 id 만 받고 이름을 또 물으러 가지 않게). 지워진 스타일이면 이름 없이 id 만. */
      if (Number(m.styleId) > 0) {
        meta.styleId = Math.floor(Number(m.styleId));
        const [st] = await q(sql`SELECT name FROM text_styles WHERE tenant_id = ${tid} AND id = ${meta.styleId as number}`).catch(() => [] as Row[]);
        if (st?.name) meta.styleName = String(st.name);
      }
      const detail: Record<string, unknown> = { ...pieceRow(p), bodyHtml: String(p.body || ""), blocks: Array.isArray(p.blocks) ? p.blocks : [],
        images: assets.filter((x) => String(x.kind) === "image").map((x) => ({ url: urlOf(x), caption: x.caption ? String(x.caption) : "", sort: n(x.sort) })),
        meta, gate: g, topicTitle: p.topic_title ? String(p.topic_title) : "", regenCount: n(m.regenCount),
        /* [R9-4] 이 채널이 낼 수 있는 꾸밈 표(`true|false|null`) — 화면이 «이 채널에서 되는지는 올려 봐야 알아요»(null)를 말할 재료. 표가 없으면 null. */
        formatCaps: formatCapsOf(String(p.channel)) };

      /* ══ [R8-A fix ③] «이 글이 왜 이렇게 생겼나» 3축 — A 검수 화면의 `?why=1` 자리 ══
         🔴 **계약 파일의 기본값이 아니라 «이 글에 적용된 값»**이다(AC-57 대용물 금지). 셋이 갈리면 화면이 거짓말을 한다.
         · `topicGroup` — 없으면 **null 그대로**(«모름»을 «기본값»으로 위장하지 않는다)
         · `goal` — `briefs.goal`. 🔴 생성이 쓰는 `resolveGoal` **같은 함수**를 부른다(프롬프트에 실린 값과 화면 값이 갈리지 않게)
         · `contract.summary` — 그 글에 실제로 적용된 분량·사진 수·목적 규칙 */
      try {
        const wc = await contractFor(String(p.channel), m.emotionKey ? String(m.emotionKey) : null);
        /* 🔴 **없는 format 을 `formats[0]` 으로 메우지 않는다** — 그러면 «모름»이 «info» 로 위장되고
           주제군·분량이 그 거짓값에서 흘러나온다(AC-57 대용물 금지 · 스모크에서 실제로 걸렸다). 없으면 없는 대로 둔다. */
        const fmt = String(p.format || m.format || "") || null;
        /* [R8 §2.1] 생성 때 적어 둔 주제군이 **정본**이다(그때는 intent 를 안다). 없을 때만 형식·제목으로 다시 잰다. */
        const saved = String(m.topicGroup ?? "");
        const grp = (saved === "review" || saved === "info" || saved === "life") ? saved as "review" | "info" | "life"
          : fmt ? topicGroupOf({ format: fmt, intent: null, title: String(p.topic_title ?? p.title ?? "") }) : null;
        const [brow] = p.brief_id ? await q(sql`SELECT goal FROM briefs WHERE tenant_id = ${tid} AND id = ${n(p.brief_id)}`) : [undefined];
        const goal = resolveGoal({ affiliate: !!m.affiliate, briefGoal: brow?.goal as string | null, channel: String(p.channel) });
        /* [R10-8] 분량 폭은 등급에도 달렸다 — 생성·게이트와 **같은 함수·같은 tier**(안 넘기면 «프리미엄 2,000자»를 «1,500자 계약»으로 그린다). */
        const len = lengthFor(wc, grp, toCoinTier(m.tier)), img = imagesFor(wc, grp);
        detail.topicGroup = grp;                       // null 이면 null — 화면이 «모름»으로 그린다
        detail.goal = goal;
        detail.contract = {
          channel: String(p.channel), label: wc.label, format: fmt, formatLabel: fmt ? (wc.formatLabel[fmt as keyof typeof wc.formatLabel] ?? fmt) : null,
          register: wc.register,
          length: { min: len.min, max: len.max, fromGroup: !!(grp && wc.lengthByGroup?.[grp]) },
          images: { min: img.min, max: img.max, default: img.default, fromGroup: !!(grp && wc.imagesByGroup?.[grp]) },
          goalRules: wc.goalRules?.[goal] ?? [],       // 실제로 프롬프트에 실린 줄들(없으면 빈 배열)
          /* 🔴 [2026-09-16 · A 가 첫 발행 경로에서 찾음] **자가 둘이었다.**
             여기서는 `htmlToPlain(body).length`(HTML 을 평문으로 · 줄바꿈 유지)로 재고,
             게이트(`lib/ai-tell-gate.ts`)는 `blocksCharCount(blocks)`(블록 평문 · 공백을 하나로)로 잰다.
             ⇒ 같은 화면에 «472자»와 «1,840자»가 나란히 떴다. 게이트 주석은 «**세는 자는 하나**다»라고 적혀 있었는데
                이 줄이 그 말을 어기고 있었다(AC-59 · 주석이 코드보다 앞서 나간 자리).
             🔴 자를 게이트 쪽으로 모은다 — 계약 폭(`lengthFor`)이 그 자로 정해진 값이라, 그 자로 재야 «폭 안인가»가 말이 된다.
             🔴 블록이 없는 옛 글만 HTML 로 잰다(없는 것을 있는 척하지 않는다 · `charsFrom` 으로 어느 자인지 같이 말한다). */
          ...(() => {
            const blocks = Array.isArray(p.blocks) ? (p.blocks as Parameters<typeof blocksCharCount>[0]) : null;
            return blocks && blocks.length
              ? { actualChars: blocksCharCount(blocks), charsFrom: "blocks" as const }
              : { actualChars: htmlToPlain(String(p.body || "")).length, charsFrom: "body" as const };
          })(),
        };
      } catch (e) {
        /* 🔴 못 실으면 **빈칸으로 두고 사유를 남긴다** — 기본값으로 채우면 화면이 «이 글에 적용된 값»이라고 거짓말한다(AC-9). */
        console.warn("[pieces] why 3축 조립 실패", String((e as Error)?.message ?? e).slice(0, 120));
        detail.contract = null; detail.topicGroup = null; detail.goal = null;
      }
      if (isVideo) {
        // A 계약: `assets:[{ id, kind, url, meta }]` — 화면이 종류로 골라 쓴다(`images` 는 글 호환으로 그대로 둔다).
        detail.assets = assets.map((x) => ({ id: n(x.id), kind: String(x.kind), url: urlOf(x), sort: n(x.sort), caption: x.caption ? String(x.caption) : "", meta: x.meta ?? {} }));
        const one = (k: string) => { const x = assets.find((a) => String(a.kind) === k); return x ? { url: urlOf(x), key: String(x.r2_key ?? ""), meta: x.meta ?? {} } : null; };
        const yt = (m.youtube ?? null) as { title?: unknown; description?: unknown; tags?: unknown } | null;
        const vr = ((m.video ?? {}) as Record<string, unknown>).variant as { palette?: unknown; hookType?: unknown; voiceId?: unknown } | undefined;
        detail.video = {
          stage: stageOf(p),
          spec: m.video ?? null,
          // 변주 사람말 이름(§13.0) — 화면 칩이 영문 프롬프트 문구를 보여 주지 않게 서버가 붙여 준다.
          variantLabels: vr ? { palette: paletteLabelKo(vr.palette), hook: hookLabelKo(vr.hookType), voiceId: String(vr.voiceId ?? "") } : null,
          file: one("video"), poster: one("thumb"), srt: one("srt"),
          // 컷 = 클립(t2v) + 정지 이미지(still · kenburns) 를 컷 번호로 합쳐 준다 — 화면이 «장면 n» 으로 센다.
          cuts: assets.filter((x) => String(x.kind) === "clip" || (String(x.kind) === "image" && ((x.meta || {}) as Record<string, unknown>).still === true))
            .map((x) => ({ idx: n(x.sort), kind: String(x.kind) === "clip" ? "clip" : "still", url: urlOf(x), keyword: x.caption ? String(x.caption) : "" }))
            .sort((a, b) => a.idx - b.idx),
          narration: assets.filter((x) => String(x.kind) === "audio").length,
          totalMs: n(m.totalMs), cutCount: n(m.cutCount),
          tts: m.tts ?? null,
          youtube: yt ? { title: String(yt.title ?? ""), description: String(yt.description ?? ""), tags: Array.isArray(yt.tags) ? yt.tags : [] } : null,
          judge: g.judge ?? null,
          structureTemplateId: m.structureTemplateId ?? null,
          /* [P1R6 §2.3] 엔드카드 — payload 에는 처음부터 있었는데 화면에 안 내려가서 «무엇이 마지막에 나오나»를 검수가 못 봤다.
             읽기 전용(편집은 디렉터 손보기) · `url` 은 제휴일 때만 생긴다(쇼핑 태그 메타는 유튜브 승인 후). */
          endcard: ((m.render ?? null) as { overlay?: { endcard?: { text?: unknown; url?: unknown } | null } } | null)?.overlay?.endcard
            ? { text: String(((m.render as { overlay: { endcard: { text?: unknown } } }).overlay.endcard.text) ?? ""),
                ...(((m.render as { overlay: { endcard: { url?: unknown } } }).overlay.endcard.url) ? { url: String((m.render as { overlay: { endcard: { url?: unknown } } }).overlay.endcard.url) } : {}) }
            : null,
          /** 자동 하향 사실(§2.3) — 있으면 화면이 «N초로 맞췄어요». */
          clampedFrom: ((m.video ?? {}) as { clampedFrom?: unknown }).clampedFrom ?? null,
        };
      }
      return json({ ok: true, piece: detail });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const id = n(b.id); if (!id) return badRequest("id");
    // P1R4 §1.3 — readonly·suspended 는 재생성 금지. 글을 찾기 전에 재서 403 이 404 보다 먼저.
    if (path.endsWith("/pieces-regenerate")) {
      const w = await requireWritable(tid); if (!w.ok) return w.res;
      /* ★C(P1R4) fix: 다시 만들기도 AI 생성 — 일 상한. [P1R5 §1.4c(1)] 단 **영상은 소프트**(고객은 이미 코인을 냈다).
         🔴 [2026-09-15 · AC-35] `requireAiBudget` 은 판정이 아니라 **명령**이다 — 초과를 보면 고객 알림(«오늘 만들 수 있는 양을
         다 썼어요 · 내일 다시»)을 부수효과로 넣는다. 종전엔 그걸 **무조건 먼저** 부르고 반환만 분기해서, 영상 다시 만들기는
         정상 진행되는데 알림함엔 «못 만들어요»가 남았다. 재생성은 **코인 0** 이라 «돈도 안 받고 안 만들어 준다»로 읽힌다.
         ⇒ 판정은 순수 검사 `checkAiCostCap` 으로 하고, **글일 때만** 알림까지 하는 `requireAiBudget` 를 부른다.
         `director.ts` 의 같은 수리(C)와 짝이다 · `requireAiBudget` 자체는 무변경(R4 글 경로 보존). */
      const [k0] = await q(sql`SELECT kind FROM pieces WHERE tenant_id = ${tid} AND id = ${id}`);
      const { checkAiCostCap, requireAiBudget } = await import("../../lib/billing/ai-cost-cap");
      if (String(k0?.kind ?? "post") === "video") {
        const c = await checkAiCostCap(tid);                                  // 순수 검사(부수효과 0)
        if (!c.ok) await writeAudit({ tenantId: tid, action: "ai_cost_soft_video_pass", actorType: "user", actorId: auth.user.uid, riskLevel: "medium", target: `piece:${id}`, detail: { usedKrw: c.usedKrw, capKrw: c.capKrw, usedUsd: c.usedUsd, at: "regenerate" } });
      } else {
        const bgt = await requireAiBudget(tid);                               // 글은 R4 그대로(알림 포함)
        if (!bgt.ok) return json({ ok: false, step: "ai_cost_cap", error: bgt.error }, 400);
      }
    }
    const [p] = await q(sql`SELECT p.* FROM pieces p WHERE p.tenant_id = ${tid} AND p.id = ${id}`);
    if (!p) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);
    const m = (p.meta || {}) as Record<string, unknown>;
    const st = String(p.status);

    if (path.endsWith("/pieces-approve")) {
      const r = await approvePiece(tid, p, { by: { uid: Number(auth.user.uid), role: String(auth.user.role) === "owner" ? "owner" : "member" } });
      if (!r.ok) return r.step === "gate"
        ? json({ ok: false, step: "gate", error: r.error, gate: r.gate }, 409)
        /* 🔴 팀 승인은 **403**(권한)이지 400(상태)이 아니다 — 화면이 «내가 못 하는 일»과 «지금 못 하는 일»을 갈라 그려야 한다. */
        : r.step === "team_approval" ? json({ ok: false, step: "team_approval", error: r.error }, 403)
        : json({ ok: false, step: "state", error: r.error }, 400);
      if (!r.alreadyScheduled) await writeAudit({ tenantId: tid, action: "piece_approve", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { scheduledFor: r.scheduledFor, gateOk: r.gate.ok } });
      return json({ ok: true, status: "scheduled", scheduledFor: r.scheduledFor });
    }
    if (path.endsWith("/pieces-reject")) {
      if (st === "rejected") return json({ ok: true, status: "rejected" });
      if (!["in_review", "edited", "draft", "failed", "scheduled", "approved"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 버릴 수 없어요." }, 400);
      const reason = String(b.reason ?? "").trim().slice(0, 300);
      await q(sql`UPDATE pieces SET status = 'rejected', meta = meta || ${jsonb({ rejectReason: reason || null })}, updated_at = NOW() WHERE id = ${id}`);
      /* [P1R7 B3] 자리는 'rejected' — 'skipped' 는 «이날은 쉰다»(사용자가 편성표에서 건너뛴 날)라 둘을 한 어휘로 두면
         편성표에서 «내가 버린 글»과 «쉬는 날»이 같은 칩으로 보인다(전수조사 §5B.6). 자리를 다시 만들지 않는 것은 둘 다 같다. */
      if (p.slot_id) await q(sql`UPDATE slots SET status = 'rejected', note = ${reason || "버림"}, updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
      await writeAudit({ tenantId: tid, action: "piece_reject", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { reason } });
      return json({ ok: true, status: "rejected" });
    }
    if (path.endsWith("/pieces-regenerate")) {
      const isVideo = String(p.kind || "post") === "video";
      if (st === "generating") {
        // ★C4 fix: 배경 함수가 죽어 «만드는 중»에 갇힌 글은 다시 만들기가 거부되어 사용자가 빠져나갈 길이 없었다 —
        //   20분 넘게 그대로면 코인 재차감 0(같은 ref)으로 한 번 더 건다. 다시 실패하면 triggerGenerate 가 failed+환급+알림으로 내린다.
        const at = utcDate(p.updated_at);
        if (at && Date.now() - at.getTime() > 20 * 60_000) {
          // [P1R5] 영상은 영상 체인을 다시 건다(`triggerVideo`). 잠금은 20분 넘었으니 `generateVideo` 가 뺏는다.
          const fired = isVideo ? await triggerVideo(id, tid, true) : await triggerGenerate(id, tid);
          await writeAudit({ tenantId: tid, action: "piece_retrigger", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { fired, stuckMin: Math.round((Date.now() - at.getTime()) / 60_000) } });
          return json({ ok: true, status: "generating" }, 202);
        }
        return json({ ok: true, status: "generating" });
      }
      if (!["in_review", "edited", "draft", "failed", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 다시 만들 수 없어요." }, 400);
      const regen = n(m.regenCount);
      if (regen >= 1) return json({ ok: false, step: "regen_limit", error: "다시 만들기는 한 번만 할 수 있어요. 직접 수정하거나 새 소재로 만들어 주세요." }, 400);
      const note = String(b.note ?? "").trim().slice(0, 300);
      /* 🔴 [2026-09-16 · AC-92] 차감이 실패한 **이유를 모를 때 «코인이 부족해요»라고 말하지 않는다.**
         종전엔 세 자리 모두 이유와 무관하게 «부족해요 · need 0» 이었다 — 원장 쓰기가 실패한 것인데
         고객은 «충전하면 되겠지»로 읽고 충전해도 또 같은 곳에서 막힌다. `lib/director.ts` 는 이미 둘을 갈라 말하고 있었다(같은 잣대 · AC-47). */
      const coinFail = (c: { reason?: string; need?: number; balance?: number }) =>
        c.reason === "insufficient"
          ? json({ ok: false, step: "coin_short", error: `코인이 ${n(c.need)}개 부족해요.`, need: n(c.need), have: n(c.balance) }, 402)
          : json({ ok: false, step: "coin_write", error: "코인 차감에 실패했어요. 잠시 후 다시 해 주세요." }, 500);
      // 실패로 환급됐던 piece 는 다시 차감(원장 행 삭제 0 · 새 ref `piece:{id}:regen{n}` — 순액은 1회분 · 부족하면 coin_short)
      if (st === "failed" && n(m.refunded) > 0) {
        const { consume, refundPiece } = await import("../../lib/coin-ledger");
        const tag = `piece:${id}:regen${regen + 1}`;
        if (isVideo) {
          // [P1R5 §1.10] 영상은 `videoCoinItem(seconds)` **1건**(이미지 코인 없음).
          const { videoCoinItem, COIN_TABLE } = await import("../../lib/coin-table");
          /* 🔴 [2026-09-16 · AC-92] 종전엔 `n(meta.video.seconds) || 60` 이었다 — **길이를 모르면 제일 비싼 60초 값(28코인)**을 물렸다.
             ② 편성표 견적의 «안 고르면 60초»와는 다른 이야기다. 거기 60 은 **앞으로 실제로 만들어 줄 길이**라 고객이 받는 것과 같지만,
             여기 60 은 **이미 지나간 일에 대한 추측**이다. 추측으로 돈을 물리지 않는다.
             🔴 정답은 그 글이 들고 있다 — 처음 차감할 때 쓴 `coinItem` 이 `meta` 에 그대로 있다(`lib/director.ts` 가 적는다 · AC-71).
                그게 없는 옛 글이면 기록된 길이로, 그것도 없으면 **다시 안 받는다**(모르면 모자라게 받는 쪽으로 틀린다). */
          const secs = n(((m.video ?? {}) as Record<string, unknown>).seconds);
          const recorded = String(m.coinItem || "");
          const item = recorded.startsWith("video") && recorded in COIN_TABLE ? (recorded as keyof typeof COIN_TABLE)
            : secs > 0 ? videoCoinItem(secs) : null;
          if (item) {
            const cv = await consume(tid, item, tag, { actorId: auth.user.uid, reason: "영상 다시 만들기(환급분 재차감)" });
            if (!cv.ok) return coinFail(cv);
          } else {
            /* 무엇을 물렸는지 기록이 없다 — 지어내지 않고 **안 받는다**. 자국은 남긴다(왜 이 글만 공짜였나를 나중에 설명할 수 있게). */
            await writeAudit({ tenantId: tid, action: "piece_regen_no_recharge", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`,
              detail: { why: "처음 차감한 코인 항목이 기록에 없음", refunded: n(m.refunded) }, riskLevel: "low" });
          }
        } else {
          /* 🔴 [2026-09-16] **여기만 옛 식이 남아 있었다.** 사진 **총 장수**(`imageCount`)만큼 `image` 를 물렸다 —
             새 규칙에서는 **AI 로 구운 사진만**, 그것도 **포함분(1장)을 뺀 나머지**다(`lib/coin-table.ts AI_IMAGES_INCLUDED`).
             ⇒ 처음에 **1코인**이던 글이 실패 뒤 다시 만들 때 **7코인**으로 불어났다. 고객 돈이 걸린 자리다.
             🔴 「숫자는 새 식인데 이 자리만 옛 식」 — 코인 수리가 닿지 않은 마지막 호출부였다(A 가 화면에서 같은 과를 찾아 준 덕에 훑었다).
             카드뉴스는 장수로 안 세고 통째로 한 건이다(`coinFormatOf` 한 곳). */
          const { pieceCoinCost, postItemForCoins, toCoinTier } = await import("../../lib/coin-table");
          const { coinFormatOf } = await import("../../lib/writing-contracts");
          /* 🔴 분류는 **그 글이 들고 있다** — 처음 차감할 때 쓴 `coinItem`·`tier` 가 `meta` 에 적혀 있다(`lib/director.ts` 가 적는다 · AC-71).
             채널·포맷으로 **다시 고르면** 그 사이 계약이 바뀌었을 때 처음과 다른 값이 나온다(«고르는 자리가 갈린다» · AC-74). */
          if (String(m.coinItem || "") === "cardnews") {
            const c1 = await consume(tid, "cardnews", tag, { actorId: auth.user.uid, reason: "다시 만들기(환급분 재차감)" });
            if (!c1.ok) return coinFail(c1);
          } else {
            /* 🔴 **«모른다»를 «1장»으로 바꾸지 않는다**(AC-92). `aiImageCount` 는 R8 뒤에 만든 글에만 있다 —
               그 값이 **없으면 AI 사진이 몇 장이었는지 우리가 모른다.** 모르면 **글값만**(간단히 1) 받는다(모자라게 받는 쪽으로 틀린다).
               [R10-7] 등급도 글이 들고 있다 — 없으면(옛 글) simple 상한이라 어차피 1. 식은 견적·첫 차감·정산과 같은 `pieceCoinCost` 한 곳. */
            const aiKnown = m.aiImageCount !== undefined && m.aiImageCount !== null;
            const ai = aiKnown ? Math.max(0, Math.trunc(n(m.aiImageCount))) : 0;
            const tier = toCoinTier(m.tier);
            const coins = pieceCoinCost("post", ai, { format: coinFormatOf(String(p.channel), String(p.format || m.format || "") || undefined), tier });
            const c1 = await consume(tid, postItemForCoins(coins), tag, { actorId: auth.user.uid, reason: `다시 만들기(환급분 재차감 · ${tier ?? "간단히"} · AI 사진 ${aiKnown ? ai : "모름"}장)` });
            if (!c1.ok) return coinFail(c1);
          }
        }
      }
      if (isVideo) {
        /* 🔴 영상 «다시 만들기»는 **정말 다시 만든다** — 대본·문장 음성·컷을 지우지 않으면 `generateVideo` 의 이어받기가
           전부 «이미 있음»으로 건너뛰어 **같은 영상**이 다시 나온다(사용자 요청 note 가 반영되지 않는다).
           산출물만 지운다(원장·감사·piece 행은 그대로). 코인은 위 규칙대로(실패 환급분만 재차감 · 검수 단계 재생성은 0). */
        await q(sql`DELETE FROM piece_assets WHERE piece_id = ${id} AND tenant_id = ${tid} AND kind IN ('clip','audio','image','srt','video','thumb')`);
        await q(sql`UPDATE pieces SET status = 'generating', gate_report = NULL, body = NULL, blocks = '[]'::jsonb,
          meta = (meta - 'script' - 'drafts' - 'render' - 'youtube' - 'chainStage') || ${jsonb({ stage: "script", regenCount: regen + 1, regenNote: note || null, failReason: null, refunded: null, chainLock: null, chainResume: { count: 0 }, angle: note ? `${String(m.angle || "")} — 사용자 요청: ${note}` : m.angle })},
          updated_at = NOW() WHERE id = ${id}`);
      } else {
        await q(sql`UPDATE pieces SET status = 'generating', gate_report = NULL, meta = meta || ${jsonb({ stage: "writing", regenCount: regen + 1, regenNote: note || null, failReason: null, refunded: null, angle: note ? `${String(m.angle || "")} — 사용자 요청: ${note}` : m.angle })}, updated_at = NOW() WHERE id = ${id}`);
      }
      if (p.slot_id) await q(sql`UPDATE slots SET status = 'producing', updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
      const fired = isVideo ? await triggerVideo(id, tid) : await triggerGenerate(id, tid);
      await writeAudit({ tenantId: tid, action: "piece_regenerate", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { note, fired } });
      return json({ ok: true, status: "generating" }, 202);
    }
    if (path.endsWith("/pieces-update")) {
      if (!["in_review", "edited", "draft", "scheduled", "approved", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 수정할 수 없어요." }, 400);
      if (String(p.kind || "post") === "video") {
        /* [P1R5 §3 · A 실물] 영상 설명란 수정 — `{ id, title, body, tags[] }`.
           🔴 첫 줄 고지는 **서버가 되붙인다**(사용자가 지워도 · 글의 «고지 첫 요소» 관례와 같은 급 · §16B.4).
           정본은 `pieces.body`(발행 커넥터가 이걸 올린다) · `meta.description`·`meta.tags`·`meta.youtube` 도 같이 맞춰 둔다(A 가 읽는다). */
        /* [R8-A fix ①] 🔴 **영상에도 «대가 켜기» 입구를 연다.**
           종전엔 이 갈래가 `compensationOfMeta(m)` 으로 **이미 켜진 것을 읽기만** 했다 — 글 갈래에만 `monetize` 입구가 있었다.
           즉 **협찬·무상 제공 영상에 고지를 켤 방법이 아무 데도 없었다**(B3 가 글에서 잡은 구멍의 영상판).
           규율은 글과 **똑같다**: **켜기만** 한다(`false` 를 보내도 안 내린다) — 켜고 발행한 뒤 끄면 «고지 없이 나간 글»이 남는다. */
        const vmz = (b.monetize ?? {}) as Record<string, unknown>;
        const vOn = { sponsored: vmz.sponsored === true, gift: vmz.gift === true };
        let needsRerender = false;
        if (vOn.sponsored || vOn.gift) {
          if (vOn.sponsored) m.sponsored = true;
          if (vOn.gift) m.gift = true;
          m.adDisclosure = true;
          /* 🔴 [R8-A · 눌러 보고 찾은 것 2026-09-15] **설명란 첫 줄만 고치면 절반이다.**
             영상 고지는 3중이다(§16B.1): ①우상단 배지 ②시작 3초 자막 ③설명란 첫 줄.
             ①②는 `meta.render`(러너가 굽는 페이로드)에 들어 있는데, 그건 **생성 때** `needDisc` 로 정해진다(`lib/video/gen.ts:247·249`).
             검수에서 뒤늦게 대가를 켜면 payload 는 `badge:null · disclosureCaption:null` 인 채다 —
             실측: `checkVideoDisclosure` 가 «고지 누락: 우상단 배지 · 시작 3초 자막» 을 낸다(승인은 그 덕에 막힌다).
             ⇒ 여기서 **payload 를 같이 고친다**. 다만 **이미 구워진 mp4 에는 배지가 없다** — 다시 구워야 화면에 뜬다.
                그래서 `needsRerender` 를 응답에 실어 화면이 «다시 만들어야 배지가 들어가요» 라고 말하게 한다(조용히 넘기지 않는다). */
          const cur = (m.render ?? null) as Record<string, any> | null;
          if (cur && typeof cur === "object") {
            const c2 = compensationOfMeta(m);
            const patched = {
              ...cur,
              overlay: { ...(cur.overlay ?? {}), badge: { text: videoBadgeText({ affiliate: c2.affiliate, sponsored: c2.sponsored, gift: c2.gift, provider: c2.provider ?? null }), corner: "tr" } },
              disclosureCaption: { text: videoOpeningCaption({ affiliate: c2.affiliate, sponsored: c2.sponsored, gift: c2.gift, provider: c2.provider ?? null }), untilMs: 3000 },
            };
            m.render = patched;
            await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ ...(vOn.sponsored ? { sponsored: true } : {}), ...(vOn.gift ? { gift: true } : {}), adDisclosure: true, render: patched })} WHERE id = ${id}`);
            needsRerender = true;
          } else {
            await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ ...(vOn.sponsored ? { sponsored: true } : {}), ...(vOn.gift ? { gift: true } : {}), adDisclosure: true })} WHERE id = ${id}`);
          }
        }
        const comp = compensationOfMeta(m);            // [R8-A §4] 제휴·협찬·무상 제공
        const need = comp.need;
        const title = typeof b.title === "string" ? b.title.trim().slice(0, 120) : String(p.title || "");
        let body = typeof b.body === "string" ? String(b.body).replace(/\r/g, "").slice(0, 5000).trim() : String(p.body || "");
        if (need) {
          const first = videoDescriptionFirstLine({ affiliate: comp.affiliate, sponsored: comp.sponsored, gift: comp.gift, provider: comp.provider ?? "coupang" });
          const rest = body.split("\n").filter((ln, i) => !(i === 0 && isDisclosureText(ln))).join("\n").trimStart();
          body = `${first}\n${rest}`;
        }
        const tags = Array.isArray(b.tags) ? (b.tags as unknown[]).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean).slice(0, 15) : (Array.isArray(m.tags) ? m.tags as string[] : []);
        const yt = (m.youtube ?? {}) as Record<string, unknown>;
        /* 🔴 [R8-A fix ②의 짝] `editedByUser` 는 **사람이 실제로 글을 고쳤을 때만** 찍는다.
           종전엔 이 갈래가 **언제나** 찍어서, 대가만 켜도 «사람이 고친 글»이 됐다 — `recheckPiece` 가 블록 대신 HTML 로 판정한다(읽는 곳 1곳 · content-approve.ts:155). */
        const vEdited = typeof b.title === "string" || typeof b.body === "string";
        await q(sql`UPDATE pieces SET title = ${title}, body = ${body},
          meta = meta || ${jsonb({ description: body, tags, youtube: { ...yt, title, description: body, tags }, ...(vEdited ? { editedByUser: true, editedAt: new Date().toISOString() } : {}) })},
          updated_at = NOW() WHERE id = ${id}`);
        /* [R9-9 C4] 사람이 고쳤으면 **글의 상태**가 `edited` 로 간다(DESIGN §5B.6 · 자리는 그대로). 검수 대기(in_review·draft)일 때만 — 예약된 글을 고쳐도 예약은 유지된다. */
        if (vEdited && (REVIEW_PIECE_STATUSES.includes(st) || st === "draft")) await q(sql`UPDATE pieces SET status = ${EDITED_PIECE_STATUS} WHERE id = ${id}`);
        const [p2] = await q(sql`SELECT p.* FROM pieces p WHERE p.id = ${id}`);
        const gate = await recheckPiece(tid, p2);
        await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)} WHERE id = ${id}`);
        await writeAudit({ tenantId: tid, action: "piece_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { kind: "video", title: typeof b.title === "string", body: typeof b.body === "string", tags: tags.length, gateOk: gate.ok, ...(vOn.sponsored || vOn.gift ? { monetize: { ...(vOn.sponsored ? { sponsored: true } : {}), ...(vOn.gift ? { gift: true } : {}) } } : {}) } });
        return json({ ok: true, gate, body, tags, ...(need ? { disclosureFirstLine: body.split("\n")[0] } : {}),
          ...(needsRerender ? { needsRerender: true, needsRerenderWhy: "이미 만들어진 영상에는 광고 배지가 없어요. 다시 만들어야 화면에 배지와 시작 자막이 들어가요." } : {}) });
      }
      const sets: ReturnType<typeof sql>[] = [];
      let bodyHtml = String(p.body || "");
      if (typeof b.title === "string") { const t = b.title.trim().slice(0, 120); if (t) sets.push(sql`title = ${t}`); }
      /* [R8-A §4] 🔴 **대가 켜기는 여기서 받는다**(검수 화면 · A 가 스위치를 붙인다) — `monetize:{sponsored?:true, gift?:true}`.
         켜기만 받는다: `false` 를 보내도 **내려가지 않는다**. 켜고 발행한 뒤 끄면 «고지 없이 나간 글»이 남기 때문이다(메인 판정 2026-09-15).
         내리려면 글을 버리거나(reject) 다시 만든다 — 그래야 고지가 붙은 채로만 나간다. */
      const mz = (b.monetize ?? {}) as Record<string, unknown>;
      const turnOn = { sponsored: mz.sponsored === true, gift: mz.gift === true };
      if (turnOn.sponsored || turnOn.gift) {
        await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ ...(turnOn.sponsored ? { sponsored: true } : {}), ...(turnOn.gift ? { gift: true } : {}), adDisclosure: true })} WHERE id = ${id}`);
        if (turnOn.sponsored) m.sponsored = true;
        if (turnOn.gift) m.gift = true;
        m.adDisclosure = true;
      }
      const comp = compensationOfMeta(m);
      const need = comp.need;
      if (typeof b.bodyHtml === "string") {
        bodyHtml = sanitizeHtml(b.bodyHtml);
        if (need) bodyHtml = ensureDisclosureHtml(bodyHtml, comp.provider ?? "coupang", { affiliate: comp.affiliate, sponsored: comp.sponsored, gift: comp.gift });
        sets.push(sql`body = ${bodyHtml}`);
        /* 🔴 `editedByUser` 는 **`bodyHtml` 이 실제로 온 경우에만** 찍는다 — 읽는 곳이 딱 하나 있고(`lib/content-approve.ts:155`),
           그 값이 서면 재검사가 **블록 기준 → HTML 기준**으로 바뀐다. 사람이 한 글자도 안 고쳤는데 찍으면 조용한 오염이다. */
        sets.push(sql`meta = meta || ${jsonb({ editedByUser: true, editedAt: new Date().toISOString() })}`);
      } else if (turnOn.sponsored || turnOn.gift) {
        /* [R8-A fix ②] 🔴 **대가만 켜도 성사된다.** 종전엔 `sets` 가 비어 400 이 났고, 그래서 화면이 `bodyHtml` 을 **억지로 같이** 보냈다 —
           그 부작용으로 `editedByUser` 가 찍혔다(위 주석의 그 오염). 이제 여기서 **저장된 본문에 고지만 되붙여** 쓴다. */
        const withDisc = ensureDisclosureHtml(bodyHtml, comp.provider ?? "coupang", { affiliate: comp.affiliate, sponsored: comp.sponsored, gift: comp.gift });
        if (withDisc !== bodyHtml) { bodyHtml = withDisc; sets.push(sql`body = ${bodyHtml}`); }
      }
      /* [R9-9 C4] 🔴 **사람이 제목·본문을 고쳤으면 글의 상태가 `edited`** — DESIGN §5B.6 «수정은 자리의 상태가 아니라 글의 상태다»(자리는 in_review 그대로 · recheckPiece 가 다시 잰다).
         대가만 켠 것은 «고침»이 아니다(`editedByUser` 규율과 같은 선). 검수 대기(in_review·edited·draft)일 때만 — 예약된 글을 손보면 예약은 유지된다. */
      const humanEdited = typeof b.bodyHtml === "string" || (typeof b.title === "string" && !!b.title.trim());
      if (humanEdited && (REVIEW_PIECE_STATUSES.includes(st) || st === "draft")) sets.push(sql`status = ${EDITED_PIECE_STATUS}`);
      /* 대가를 켰으면 «바꾼 것»이 있는 것이다 — 본문이 이미 고지를 갖고 있어 `sets` 가 비어도 400 을 내지 않는다(위 UPDATE 로 meta 는 이미 섰다). */
      if (!sets.length && !(turnOn.sponsored || turnOn.gift)) return badRequest("바꿀 값이 없어요.");
      if (!sets.length) sets.push(sql`updated_at = NOW()`);
      await q(sql`UPDATE pieces SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE id = ${id}`);
      const [p2] = await q(sql`SELECT p.* FROM pieces p WHERE p.id = ${id}`);
      const gate = await recheckPiece(tid, p2);
      await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)} WHERE id = ${id}`);
      await writeAudit({ tenantId: tid, action: "piece_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`,
        detail: { title: typeof b.title === "string", body: typeof b.bodyHtml === "string", gateOk: gate.ok,
          // 무엇을 «켰는지» 남긴다 — 대가는 되돌릴 수 없는 종류의 표시라 누가 언제 켰는지가 증거가 된다.
          ...(turnOn.sponsored || turnOn.gift ? { monetize: { ...(turnOn.sponsored ? { sponsored: true } : {}), ...(turnOn.gift ? { gift: true } : {}) } } : {}) } });
      return json({ ok: true, gate, bodyHtml: String(p2.body || "") });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("pieces", err); }
};

