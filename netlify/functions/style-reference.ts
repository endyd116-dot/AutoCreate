/**
 * 글 레퍼런스(계정의 옷장) — R10-2·3·4·10 · 설계 §3.1·§3.6 · A 와 합의한 경로·키(2026-09-16) 글자 그대로.
 *   POST /api/style-reference        { url, accountId }              → { ok, ref:{ id, status:"queued" }, quota }   · 400 step: quota | url | no_runner | account
 *   GET  /api/style-reference?id=    → { ok, ref:{ id, status:"queued|capturing|reading|done|failed", failKind|null, style|null } }
 *   POST /api/style-reference-upload { accountId, images:[dataUrl…] } → { ok, style, ref:{ status:"done" }, quota }    (못 열 때 «화면을 찍어 올려 주세요» · 최대 6장 · 장당 ≤1MB)
 *   POST /api/style-reference-text   { accountId, text }             → { ok, style, ref:{ status:"done" }, quota }    (복붙 · 마지막 예비 · 꾸밈·사진은 못 배운다)
 *   GET  /api/account-styles?accountId= → { ok, styles:[{ id, name, source, createdAt, summary[], outline[], learned }], defaultStyleId|null, quota, recommend:{ measured, styleId|null, line } }
 *   POST /api/account-style-default  { accountId, styleId|null }      · POST /api/account-style-delete { id }
 *
 *   🔴 코인 0 · 요금제 월 한도만(`plans.limits.textStylesPerMonth`) — 감사 행 `style_reference` 가 곧 횟수(요청 전에 적는다 · 실패해도 AI 원가는 나갔다).
 *   🔴 러너가 여는 것이 첫 길(사장님: «긁지 말라고 한 적 없다»). 러너가 없으면 `no_runner` 로 정직하게 — 화면이 «화면을 찍어 올려 주세요»로 안내한다(막지 않는다).
 *   🔴 캡처는 서버에 남지 않는다(러너 보고 → `lib/text-style-capture.ts` 가 읽고 버린다 · 업로드도 이 요청 안에서 읽고 버린다).
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q, getAccount } from "../../lib/accounts";
import { enqueueJob } from "../../lib/runner-jobs";
import { listTextStyles, textStyleOf, textStyleQuota, recommendTextStyle, setAccountStyle, deleteTextStyle, createTextStyle } from "../../lib/text-style-store";
import { readTextStyleFromShots, readTextStyleFromText, type StyleShot } from "../../lib/text-style-read";
import { validateShots } from "../../lib/text-style-capture";

export const config = { path: ["/api/style-reference", "/api/style-reference-upload", "/api/style-reference-text", "/api/account-styles", "/api/account-style-default", "/api/account-style-delete"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
type Row = Record<string, unknown>;

/** 러너 잡 상태 → 화면 상태. 읽기는 보고 처리 안에서 동기로 끝나므로 «claimed» 가 곧 «찍는 중·읽는 중»이다. */
function refStatusOf(j: Row): "queued" | "capturing" | "reading" | "done" | "failed" {
  const s = String(j.status ?? "");
  if (s === "queued") return "queued";
  if (s === "claimed") return "capturing";
  if (s === "done") return "done";
  return "failed";
}

/** data URL → 캡처. 🔴 6장 · 장당 1MB(≈ base64 1.4M) — 넘으면 400 too_big(자르지 않는다). */
function parseDataUrls(v: unknown): { shots: StyleShot[] } | { error: string; step: string } {
  const arr = Array.isArray(v) ? v : [];
  if (!arr.length) return { error: "화면을 한 장 이상 올려 주세요.", step: "images" };
  if (arr.length > 6) return { error: "화면은 6장까지 올릴 수 있어요 — 처음·중간·끝 위주로 골라 주세요.", step: "too_many" };
  const shots: StyleShot[] = [];
  arr.forEach((x, i) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(x ?? "").trim());
    if (m) shots.push({ mime: m[1], data: m[2].replace(/\s+/g, ""), i });
  });
  if (shots.length !== arr.length) return { error: "이미지 파일(jpeg·png·webp)만 올릴 수 있어요.", step: "images" };
  if (shots.some((s) => s.data.length > 1_400_000)) return { error: "한 장이 1MB 를 넘어요 — 조금 작게 찍거나 나눠서 올려 주세요.", step: "too_big" };
  return { shots };
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  const url = new URL(req.url);
  try {
    /* ── 옷장 목록 + 추천 ── */
    if (path.endsWith("/account-styles")) {
      const accountId = n(url.searchParams.get("accountId"));
      const [styles, quota] = await Promise.all([listTextStyles(tid), textStyleQuota(tid)]);
      const acc = accountId ? await getAccount(tid, accountId) : null;
      const recommend = await recommendTextStyle(tid, styles.map((s) => ({ id: s.id, name: s.name })));
      return json({ ok: true, styles: styles.map((s) => ({ id: s.id, name: s.name, source: s.source, createdAt: s.createdAt, summary: s.summary, outline: s.outline, learned: s.learned, accountId: s.accountId })),
        defaultStyleId: acc?.defaultStyleId ?? null, quota, recommend });
    }
    /* ── 진행 상황(러너 경로) ── */
    if (path.endsWith("/style-reference") && req.method === "GET") {
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [j] = await q(sql`SELECT id, status, result, error_kind FROM runner_jobs WHERE tenant_id = ${tid} AND id = ${id} AND kind = 'reference.capture' LIMIT 1`);
      if (!j) return json({ ok: false, step: "not_found", error: "그 요청을 찾지 못했어요." }, 404);
      const status = refStatusOf(j);
      const res = (j.result && typeof j.result === "object" ? j.result : {}) as Record<string, unknown>;
      const style = status === "done" && n(res.styleId) ? await textStyleOf(tid, n(res.styleId)) : null;
      return json({ ok: true, ref: { id, status, failKind: status === "failed" ? String(j.error_kind ?? res.errorKind ?? "nav") : null, failDetail: status === "failed" ? String(res.detail ?? "") : null,
        style: style ? { id: style.id, name: style.name, source: style.source, createdAt: style.createdAt, summary: style.summary, outline: style.outline, learned: style.learned } : null } });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);

    if (path.endsWith("/account-style-default")) {
      const accountId = n(b.accountId); if (!accountId) return badRequest("accountId");
      const styleId = b.styleId === null || b.styleId === undefined || b.styleId === "" ? null : n(b.styleId);
      const r = await setAccountStyle(tid, accountId, styleId);
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error }, 400);
      await writeAudit({ tenantId: tid, action: "account_style_default", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${accountId}`, detail: { styleId } });
      return json({ ok: true, accountId, defaultStyleId: styleId });
    }
    if (path.endsWith("/account-style-delete")) {
      const id = n(b.id); if (!id) return badRequest("id");
      const done = await deleteTextStyle(tid, id);
      if (!done) return json({ ok: false, step: "not_found", error: "그 스타일을 찾지 못했어요." }, 404);
      await writeAudit({ tenantId: tid, action: "text_style_delete", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `text_style:${id}` });
      return json({ ok: true, id });
    }

    /* ── 배우기 셋(러너·업로드·복붙) — 공통: 쓰기 가능한 집인가 · 한도 · 계정 ── */
    const w = await requireWritable(tid); if (!w.ok) return w.res;
    const quota = await textStyleQuota(tid);
    if (quota.left <= 0) return json({ ok: false, step: "quota", error: `이번 달 스타일 배우기(${quota.limit}번)를 다 썼어요. 다음 달 1일에 다시 열려요.`, quota }, 400);
    const accountId = n(b.accountId);
    const acc = accountId ? await getAccount(tid, accountId) : null;
    if (accountId && !acc) return json({ ok: false, step: "account", error: "그 계정을 찾지 못했어요." }, 400);

    if (path.endsWith("/style-reference")) {
      const target = String(b.url ?? "").trim();
      if (!/^https?:\/\/\S+$/i.test(target) || target.length > 400) return json({ ok: false, step: "url", error: "글 주소(http/https)를 넣어 주세요." }, 400);
      if (!acc) return json({ ok: false, step: "account", error: "어느 계정으로 열지 골라 주세요(그 계정의 PC 프로그램이 엽니다)." }, 400);
      /* 러너가 있어야 열 수 있다 — 없으면 «없는 길»이라 정직하게 말한다(막는 게 아니다 · 화면은 «화면을 찍어 올려 주세요»로). */
      const [dev] = await q(sql`SELECT COUNT(*)::int AS c FROM runner_devices WHERE tenant_id = ${tid}`);
      if (!n(dev?.c)) return json({ ok: false, step: "no_runner", error: "내 PC 프로그램이 아직 없어서 글을 대신 열 수 없어요. 화면을 찍어서 올려 주시면 그대로 읽어 드릴게요.", quota }, 400);
      /* 같은 주소를 이미 배웠으면 잡을 안 만든다(횟수·원가 0 · 멱등). */
      const [dup] = await q(sql`SELECT id FROM text_styles WHERE tenant_id = ${tid} AND source_url = ${target} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`);
      if (dup) { const st = await textStyleOf(tid, n(dup.id)); return json({ ok: true, already: true, ref: { id: null, status: "done" }, style: st, quota }); }
      // 감사 행이 곧 횟수 — 잡을 만들기 전에 먼저 적는다.
      await writeAudit({ tenantId: tid, action: "style_reference", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${accountId}`, detail: { via: "runner", host: (() => { try { return new URL(target).hostname; } catch { return ""; } })() } });
      const job = await enqueueJob({ tenantId: tid, kind: "reference.capture", accountId, payload: { url: target, accountId, width: 430, maxShots: 6, overlapPct: 12, viewportsPerShot: 1.5 } });
      return json({ ok: true, ref: { id: job.id, status: "queued" }, quota: { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) } }, 202);
    }
    if (path.endsWith("/style-reference-upload")) {
      const parsed = parseDataUrls(b.images);
      if ("error" in parsed) return json({ ok: false, step: parsed.step, error: parsed.error }, 400);
      const v = validateShots(parsed.shots);
      if ("error" in v) return json({ ok: false, step: "images", error: v.error }, 400);
      await writeAudit({ tenantId: tid, action: "style_reference", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: accountId ? `account:${accountId}` : null, detail: { via: "capture", shots: v.shots.length } });
      const read = await readTextStyleFromShots(tid, v.shots, { ref: `style:${tid}:upload:${Date.now()}` });
      if (!read.ok) return json({ ok: false, step: "ai", error: read.error }, 502);
      const saved = await createTextStyle({ tenantId: tid, accountId: accountId || null, from: "capture", raw: read.raw, shots: v.shots.length });
      if (!saved.ok) return json({ ok: false, step: saved.step, error: saved.error }, 500);
      return json({ ok: true, style: saved.row, ref: { id: null, status: "done" }, quota: { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) } });
    }
    if (path.endsWith("/style-reference-text")) {
      const text = String(b.text ?? "");
      if (text.trim().length < 200) return json({ ok: false, step: "text", error: "글이 너무 짧아요 — 200자는 넘어야 모양을 잴 수 있어요." }, 400);
      await writeAudit({ tenantId: tid, action: "style_reference", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: accountId ? `account:${accountId}` : null, detail: { via: "paste", chars: text.length } });
      const read = await readTextStyleFromText(tid, text, { ref: `style:${tid}:paste:${Date.now()}` });
      if (!read.ok) return json({ ok: false, step: "ai", error: read.error }, 502);
      const saved = await createTextStyle({ tenantId: tid, accountId: accountId || null, from: "paste", raw: read.raw });
      if (!saved.ok) return json({ ok: false, step: saved.step, error: saved.error }, 500);
      return json({ ok: true, style: saved.row, ref: { id: null, status: "done" }, quota: { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) },
        note: "복붙으로 배우면 꾸밈(밑줄·형광펜)과 사진은 못 봐요 — 문단·말투·구성만 배웠어요." });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) {
    return jsonError("style_reference", err);
  }
};
