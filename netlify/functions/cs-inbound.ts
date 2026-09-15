/**
 * POST /api/cs-inbound — **앱 밖에서 온 문의가 들어오는 문**(계약 P1R8-B §4.3 · DESIGN §11.4 «한 목록으로»).
 *   메일 공급사의 인바운드 훅(Resend/SendGrid/Mailgun 계열)과 카카오 채널 훅이 여기로 밀어 넣는다.
 *
 *   🔴 **키가 아직 없어도 코드는 완성해 둔다**(CLAUDE §8 · AM KICC 관례) — `CS_INBOUND_SECRET` 을 꽂으면 그 순간 가동된다.
 *      키가 없으면 **503 `not_configured`** 로 정직하게 답한다(조용히 200 을 주면 공급사는 «잘 받았다»고 믿고 버린다).
 *
 *   인증: 헤더 `x-ac-cs-secret`(없으면 `?token=`). 🔴 **길이가 같을 때만 비교하고, 값은 로그·응답·감사 어디에도 안 찍는다**
 *         — 맞았나 틀렸나(boolean)까지만 남긴다.
 *
 *   받는 모양(공급사마다 달라서 **문 앞에서 우리 모양으로 바꾼다**):
 *     { source:"email"|"kakao", externalId, threadRef?, from:{ email?, name?, userKey? }, subject?, text, attachments?, headers? }
 *     메일 공급사 원형(`from`·`subject`·`text`·`headers`·`message-id`)도 알아본다.
 *
 *   → 200 { ok:true, ticketId, created, appended, reason? }  ·  200 { ok:false, ... } (🔴 로직 실패에 500 을 주지 않는다)
 *   🔴 **웹훅에 5xx 를 주면 공급사가 영원히 재시도한다** — 그래서 «받긴 받았다»를 200 으로 알리고 사유를 본문에 적는다.
 *      5xx 는 **우리가 정말 못 받는 상태**(키 미설정·본문 파싱 불가)에만 준다.
 */
import { json, jsonError } from "../../lib/response";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { receiveInbound, type InboundMessage } from "../../lib/cs-inbound";

export const config = { path: "/api/cs-inbound" };

/** 🔴 길이가 같을 때만 글자를 비교한다(짧은 값으로 길이를 떠보는 것을 막는다). 값은 어디에도 안 남긴다. */
function secretOk(given: string, want: string): boolean {
  if (!want || !given || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/** 공급사 원형 → 우리 모양. 🔴 모르는 키는 **버리지 말고 무시**한다(있는 것만 읽는다). */
function normalize(b: Record<string, unknown>): InboundMessage | null {
  const src = String(b.source ?? "").toLowerCase();
  const source: "email" | "kakao" = src === "kakao" ? "kakao" : "email";
  const headersRaw = (b.headers && typeof b.headers === "object" && !Array.isArray(b.headers) ? b.headers : {}) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersRaw)) headers[String(k).toLowerCase()] = String(v ?? "").slice(0, 300);

  const fromRaw = b.from;
  let email: string | null = null, name: string | null = null;
  if (fromRaw && typeof fromRaw === "object") {
    const f = fromRaw as Record<string, unknown>;
    email = f.email ? String(f.email) : null; name = f.name ? String(f.name) : null;
  } else if (typeof fromRaw === "string") {
    /* «홍길동 <a@b.c>» 도 «a@b.c» 도 받는다. */
    const m = /<([^>]+)>/.exec(fromRaw);
    email = (m?.[1] ?? fromRaw).trim();
    name = m ? fromRaw.slice(0, fromRaw.indexOf("<")).trim().replace(/^"|"$/g, "") : null;
  }
  const userKey = b.userKey ? String(b.userKey) : (b.user_key ? String(b.user_key) : null);

  const externalId = String(b.externalId ?? b.messageId ?? b.message_id ?? headers["message-id"] ?? "").trim();
  const threadRef = String(b.threadRef ?? b.thread_id ?? headers["in-reply-to"] ?? headers.references ?? "").trim().split(/\s+/)[0] || null;
  const text = String(b.text ?? b.plain ?? b.body ?? b["stripped-text"] ?? "").trim();
  const subject = b.subject ? String(b.subject) : null;
  const attachments = Array.isArray(b.attachments)
    ? (b.attachments as unknown[]).slice(0, 10).map((a) => {
        const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
        return { key: String(o.key ?? o.url ?? "").slice(0, 300), ...(o.url ? { url: String(o.url).slice(0, 500) } : {}) };
      }).filter((a) => a.key)
    : [];

  if (!externalId || !text) return null;
  return { source, externalId, threadRef, from: { email, name, userKey }, subject, text, attachments, headers };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  try {
    const want = String(process.env.CS_INBOUND_SECRET ?? "");
    /* 🔴 «키를 안 꽂았다»와 «키가 틀렸다»를 가른다 — 운영자가 무엇을 해야 하는지가 다르다. 값은 안 찍는다(등록 여부만). */
    if (!want) return json({ ok: false, step: "not_configured", error: "메일·카카오 유입 키가 아직 등록되지 않았어요.", configured: false }, 503);

    const url = new URL(req.url);
    const given = req.headers.get("x-ac-cs-secret") ?? url.searchParams.get("token") ?? "";
    if (!secretOk(given, want)) {
      await writeAudit({ tenantId: null, action: "cs_inbound_denied", actorType: "system", riskLevel: "medium", ip: clientIp(req), detail: { given: given ? "제공됨" : "없음" } });
      return json({ ok: false, step: "auth", error: "확인되지 않은 요청이에요." }, 401);
    }

    let raw: Record<string, unknown>;
    try { raw = (await req.json()) as Record<string, unknown>; }
    catch { return json({ ok: false, step: "body", error: "본문을 읽지 못했어요." }, 400); }

    const m = normalize(raw);
    if (!m) return json({ ok: true, skipped: true, step: "shape", reason: "메시지 id 나 내용이 없어서 넘겼어요." });

    const r = await receiveInbound(m);
    if (!r.ok) {
      /* 🔴 로직 실패에도 **200** — 5xx 를 주면 공급사가 영원히 재시도한다. 대신 감사에 남겨 사람이 본다. */
      await writeAudit({ tenantId: null, action: "cs_inbound_failed", actorType: "system", riskLevel: "medium", ip: clientIp(req), detail: { source: m.source, step: r.step, error: r.error } });
      return json({ ok: false, step: r.step, error: r.error, retry: false });
    }
    if (r.reason?.startsWith("skipped")) return json({ ok: true, skipped: true, reason: r.reason });
    if (r.reason === "duplicate") return json({ ok: true, ticketId: r.ticketId, created: false, appended: false, reason: "duplicate" });

    await writeAudit({ tenantId: r.tenantId, action: r.created ? "cs_inbound_ticket" : "cs_inbound_message", actorType: "system",
      ip: clientIp(req), target: `ticket:${r.ticketId}`, detail: { source: m.source, created: r.created, matched: r.tenantId !== null } });
    return json({ ok: true, ticketId: r.ticketId, created: r.created, appended: r.appended, matched: r.tenantId !== null });
  } catch (err) { return jsonError("cs_inbound", err); }
};
