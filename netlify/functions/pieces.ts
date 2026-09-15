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
import { clientIp } from "../../lib/auth";
import { jsonb, utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { type GateReport } from "../../lib/ai-tell-gate";
import { disclosureTextFor, videoDescriptionFirstLine, isDisclosureText, compensationOfMeta, videoBadgeText, videoOpeningCaption } from "../../lib/disclosure";
/* 🔴 발행 직전 재검사·승인 전이는 `lib/content-approve.ts` 한 벌이 정본이다 — 크론(`slots.review_deadline` 자동 승인)이
   같은 판정기·같은 전이를 부른다(사람 승인과 자동 승인의 기준이 갈라지지 않게 · PITFALLS #11-b). */
import { recheckPiece, approvePiece } from "../../lib/content-approve";
import { triggerGenerate } from "../../lib/director";
import { triggerVideo } from "../../lib/video/gen";
import { paletteLabelKo, hookLabelKo } from "../../lib/video/types";
import { r2PublicUrl, r2PresignGet, r2Configured } from "../../lib/r2";
import { contractFor, topicGroupOf, resolveGoal, lengthFor, imagesFor } from "../../lib/writing-contracts";
import { htmlToPlain } from "../../lib/blocks";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/pieces-list", "/api/pieces-get", "/api/pieces-approve", "/api/pieces-reject", "/api/pieces-regenerate", "/api/pieces-update"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
type Row = Record<string, unknown>;
const STATUSES = new Set(["generating", "draft", "in_review", "approved", "scheduled", "publishing", "published", "awaiting_manual", "failed", "rejected"]);

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
        : STATUSES.has(status) ? await q(sql`SELECT ${PIECE_SELECT} FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tid} AND p.status = ${status} ORDER BY p.id DESC LIMIT 200`) : [];
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
      if (m.angle) meta.angle = m.angle;
      const detail: Record<string, unknown> = { ...pieceRow(p), bodyHtml: String(p.body || ""), blocks: Array.isArray(p.blocks) ? p.blocks : [],
        images: assets.filter((x) => String(x.kind) === "image").map((x) => ({ url: urlOf(x), caption: x.caption ? String(x.caption) : "", sort: n(x.sort) })),
        meta, gate: g, topicTitle: p.topic_title ? String(p.topic_title) : "", regenCount: n(m.regenCount) };

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
        const grp = fmt ? topicGroupOf({ format: fmt, intent: null, title: String(p.topic_title ?? p.title ?? "") }) : null;
        const [brow] = p.brief_id ? await q(sql`SELECT goal FROM briefs WHERE tenant_id = ${tid} AND id = ${n(p.brief_id)}`) : [undefined];
        const goal = resolveGoal({ affiliate: !!m.affiliate, briefGoal: brow?.goal as string | null, channel: String(p.channel) });
        const len = lengthFor(wc, grp), img = imagesFor(wc, grp);
        detail.topicGroup = grp;                       // null 이면 null — 화면이 «모름»으로 그린다
        detail.goal = goal;
        detail.contract = {
          channel: String(p.channel), label: wc.label, format: fmt, formatLabel: fmt ? (wc.formatLabel[fmt as keyof typeof wc.formatLabel] ?? fmt) : null,
          register: wc.register,
          length: { min: len.min, max: len.max, fromGroup: !!(grp && wc.lengthByGroup?.[grp]) },
          images: { min: img.min, max: img.max, default: img.default, fromGroup: !!(grp && wc.imagesByGroup?.[grp]) },
          goalRules: wc.goalRules?.[goal] ?? [],       // 실제로 프롬프트에 실린 줄들(없으면 빈 배열)
          /* 실제 글의 길이 — 계약 폭 안에 있는지 화면이 바로 보여 줄 수 있게. */
          actualChars: htmlToPlain(String(p.body || "")).length,
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
      const r = await approvePiece(tid, p);
      if (!r.ok) return r.step === "gate"
        ? json({ ok: false, step: "gate", error: r.error, gate: r.gate }, 409)
        : json({ ok: false, step: "state", error: r.error }, 400);
      if (!r.alreadyScheduled) await writeAudit({ tenantId: tid, action: "piece_approve", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { scheduledFor: r.scheduledFor, gateOk: r.gate.ok } });
      return json({ ok: true, status: "scheduled", scheduledFor: r.scheduledFor });
    }
    if (path.endsWith("/pieces-reject")) {
      if (st === "rejected") return json({ ok: true, status: "rejected" });
      if (!["in_review", "draft", "failed", "scheduled", "approved"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 버릴 수 없어요." }, 400);
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
      if (!["in_review", "draft", "failed", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 다시 만들 수 없어요." }, 400);
      const regen = n(m.regenCount);
      if (regen >= 1) return json({ ok: false, step: "regen_limit", error: "다시 만들기는 한 번만 할 수 있어요. 직접 수정하거나 새 소재로 만들어 주세요." }, 400);
      const note = String(b.note ?? "").trim().slice(0, 300);
      // 실패로 환급됐던 piece 는 다시 차감(원장 행 삭제 0 · 새 ref `piece:{id}:regen{n}` — 순액은 1회분 · 부족하면 coin_short)
      if (st === "failed" && n(m.refunded) > 0) {
        const { consume, refundPiece } = await import("../../lib/coin-ledger");
        const tag = `piece:${id}:regen${regen + 1}`;
        if (isVideo) {
          // [P1R5 §1.10] 영상은 `videoCoinItem(seconds)` **1건**(이미지 코인 없음).
          const { videoCoinItem } = await import("../../lib/coin-table");
          const secs = n(((m.video ?? {}) as Record<string, unknown>).seconds) || 60;
          const cv = await consume(tid, videoCoinItem(secs as 15 | 30 | 60), tag, { actorId: auth.user.uid, reason: "영상 다시 만들기(환급분 재차감)" });
          if (!cv.ok) return json({ ok: false, step: "coin_short", error: "코인이 부족해요.", need: cv.reason === "insufficient" ? cv.need : 0, have: cv.balance }, 402);
        } else {
          const imgs = Math.max(0, Math.trunc(n(m.imageCount)));
          const c1 = await consume(tid, "blog", tag, { actorId: auth.user.uid, reason: "다시 만들기(환급분 재차감)" });
          if (!c1.ok) return json({ ok: false, step: "coin_short", error: "코인이 부족해요.", need: c1.reason === "insufficient" ? c1.need : 0, have: c1.balance }, 402);
          for (let i = 1; i <= imgs; i++) {
            const ci = await consume(tid, "image", `${tag}:img${i}`, { actorId: auth.user.uid, reason: `이미지 ${i}/${imgs}(재차감)` });
            if (!ci.ok) { await refundPiece(tid, id); return json({ ok: false, step: "coin_short", error: "코인이 부족해요.", need: ci.reason === "insufficient" ? ci.need : 0, have: ci.balance }, 402); }
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
      if (!["in_review", "draft", "scheduled", "approved", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 수정할 수 없어요." }, 400);
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

