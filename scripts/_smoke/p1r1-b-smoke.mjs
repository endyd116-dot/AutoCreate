// P1R1-B 로컬 스모크 — 가입 → 코인 grant(SQL) → 계정 add 2 → topics-refresh → director-propose → confirm(재확정 0) → 배경 생성 → gate → approve → rules-save → slots-list
import postgres from "postgres";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8901";
const env = Object.fromEntries(fs.readFileSync("C:/Users/Administrator/Desktop/작업/dev/AutoCreate-B/.env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sql = postgres(env.NETLIFY_DATABASE_URL, { ssl: "require", prepare: false, max: 2 });
let cookie = "";
const out = [];
const log = (k, v) => { const s = typeof v === "string" ? v : JSON.stringify(v); console.log(`\n■ ${k}\n${s.slice(0, 900)}`); out.push([k, s.slice(0, 1500)]); };
async function api(path, body, method) {
  const r = await fetch(`${BASE}${path}`, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.getSetCookie?.() || []; for (const c of sc) { const m = /^(ac_user)=([^;]+)/.exec(c); if (m) cookie = `${m[1]}=${m[2]}`; }
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, j };
}
const ts = Date.now();
const email = process.env.EMAIL || `b-smoke-${ts}@test.local`;
const reg = process.env.EMAIL ? await api("/api/auth-login", { email, password: "Smoke1234!" }) : await api("/api/auth-register", { email, password: "Smoke1234!", name: "B스모크" });
log(process.env.EMAIL ? "login" : "register", reg);
const me = await api("/api/auth-me"); log("me", me);
const tid = me.j?.tenant?.id; if (!tid) throw new Error("no tid");
if (!process.env.EMAIL) await sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${tid}, 'grant', 'included', 30, ${`smoke:${ts}`}, '스모크 지급')`;
log("coins-balance", await api("/api/coins-balance"));
log("accounts-add naver", await api("/api/accounts-add", { channel: "naver_blog", handle: `smoke_naver_${ts}`, loginId: "smokeid", password: "smokepw!" }));
log("accounts-add tistory", await api("/api/accounts-add", { channel: "tistory", handle: `smoke_tistory_${ts}`, loginId: "smokeid2", password: "smokepw2!" }));
log("accounts-add handle_policy", await api("/api/accounts-add", { channel: "naver_blog", handle: "쿠팡추천", loginId: "x", password: "y" }));
log("accounts-add dup", await api("/api/accounts-add", { channel: "naver_blog", handle: `smoke_naver_${ts}`, loginId: "smokeid", password: "smokepw!" }));
log("oauth-start blogger", await api("/api/accounts-oauth-start", { channel: "blogger" }));
const list = await api("/api/accounts-list"); log("accounts-list", list);
const acc1 = list.j.accounts[0];
log("accounts-update", await api("/api/accounts-update", { id: acc1.id, goldenHours: [9, 21], monetize: { adpostMediaId: "m123" } }));
const plain = JSON.stringify(list.j); if (/smokepw|"password":/.test(plain)) throw new Error("PLAINTEXT LEAK in accounts-list");
log("personas-save", await api("/api/personas-save", { name: "나", profile: { region: "경기 성남", family: "아이 둘", job: "직장인", home: "아파트", interests: ["요리", "캠핑"] } }));
const t0 = Date.now();
const refresh = await api("/api/topics-refresh", {}); log(`topics-refresh (${Math.round((Date.now() - t0) / 1000)}s)`, { status: refresh.status, added: refresh.j?.added, volumesKnown: refresh.j?.volumesKnown, growthKnown: refresh.j?.growthKnown, first3: refresh.j?.topics?.slice(0, 3) });
const tl = await api("/api/topics-list?status=candidate"); log("topics-list count", tl.j?.topics?.length);
const topic = tl.j.topics.find((t) => t.factors?.intent === "commercial") || tl.j.topics[0];
log("topics-pick", await api("/api/topics-pick", { id: topic.id }));
const prop = await api("/api/director-propose", { topicId: topic.id }); log("director-propose", prop);
const brief = prop.j.brief;
const conf = await api("/api/director-confirm", { briefId: brief.id, pieces: [{ key: brief.pieces[0].key, images: { count: Math.max(1, Math.min(2, brief.pieces[0].images.count)) } }, ...brief.pieces.slice(1).map((p) => ({ key: p.key, drop: true }))] });
log("director-confirm (1 piece · 이미지 축소)", conf);
log("director-confirm 재확정", await api("/api/director-confirm", { briefId: brief.id }));
log("coins after confirm", await api("/api/coins-balance"));
const pid = conf.j.pieceIds[0];
let piece; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 6000)); const pl = await api(`/api/pieces-list?status=all`); piece = pl.j.pieces.find((p) => p.id === pid); process.stdout.write(`[${piece?.status}/${piece?.stage}] `); if (piece && piece.status !== "generating") break; }
log("piece row", piece);
const det = await api(`/api/pieces-get?id=${pid}`); log("pieces-get", { title: det.j.piece.title, status: det.j.piece.status, gate: det.j.piece.gate, images: det.j.piece.images, meta: det.j.piece.meta, blocks: det.j.piece.blocks?.map((b) => b.type).join(","), bodyHead: det.j.piece.bodyHtml?.slice(0, 400), chars: det.j.piece.bodyHtml?.length });
for (const im of det.j.piece.images) { const r = await fetch(im.url); log(`image url ${r.status}`, im.url); }
const [chk] = await sql`SELECT jsonb_typeof(blocks) b, jsonb_typeof(meta) m, jsonb_typeof(gate_report) g FROM pieces WHERE id = ${pid}`; log("jsonb_typeof", chk);
log("pieces-update", await api("/api/pieces-update", { id: pid, title: det.j.piece.title + " (수정)" }));
log("pieces-approve", await api("/api/pieces-approve", { id: pid }));
log("rules-save", await api("/api/rules-save", { rules: [{ channel: "naver_blog", every: "week", count: 3, accountMode: "auto", active: true }, { channel: "tistory", every: "week", count: 2, weekdays: [6, 0], accountMode: "auto", active: true }] }));
log("rules-save 재저장(멱등)", await api("/api/rules-save", { rules: (await api("/api/rules-list")).j.rules }));
log("rules-settings", await api("/api/rules-settings", { horizonDays: 7, quietDays: [] }));
const sl = await api("/api/slots-list"); log("slots-list", { count: sl.j.slots.length, first: sl.j.slots.slice(0, 4) });
log("slots-skip", await api("/api/slots-skip", { id: sl.j.slots.find((s) => s.origin === "auto")?.id }));
log("home-summary", (await api("/api/home-summary")).j);
log("ai_usage", await sql`SELECT purpose, model, in_tokens, out_tokens, cost_usd FROM ai_usage WHERE tenant_id = ${tid} ORDER BY id`);
log("coin_ledger", await sql`SELECT kind, bucket, delta, item, ref FROM coin_ledger WHERE tenant_id = ${tid} ORDER BY id`);
fs.writeFileSync("C:/tmp/ac-b-smoke.json", JSON.stringify({ tid, email, pid, out }, null, 2));
await sql.end();
