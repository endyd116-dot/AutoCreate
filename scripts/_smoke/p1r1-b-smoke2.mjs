// 보안·환각 0 확인: 타 테넌트 IDOR · 데이터랩 growthPct · 자격 평문 0
const BASE = "http://localhost:8901";
let cookie = "";
async function api(path, body, method) {
  const r = await fetch(`${BASE}${path}`, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  for (const c of (r.headers.getSetCookie?.() || [])) { const m = /^(ac_user)=([^;]+)/.exec(c); if (m) cookie = `${m[1]}=${m[2]}`; }
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, j };
}
const log = (k, v) => console.log(`\n■ ${k}\n${(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 700)}`);
const ts = Date.now();
log("register(타 테넌트)", await api("/api/auth-register", { email: `b-idor-${ts}@test.local`, password: "Smoke1234!", name: "타테넌트" }));
log("IDOR pieces-get id=6", await api("/api/pieces-get?id=6"));
log("IDOR pieces-approve id=6", await api("/api/pieces-approve", { id: 6 }));
log("IDOR accounts-remove id=1", await api("/api/accounts-remove", { id: 1 }));
log("IDOR accounts-update id=1", await api("/api/accounts-update", { id: 1, dailyCap: 9 }));
log("IDOR director-propose topicId=1", await api("/api/director-propose", { topicId: 1 }));
log("IDOR slots-skip id=2", await api("/api/slots-skip", { id: 2 }));
log("IDOR rules-list(빈 테넌트)", await api("/api/rules-list"));
log("계정 없이 소재만", await api("/api/accounts-add", { channel: "tistory", handle: `idor_${ts}`, loginId: "a", password: "b" }));
const t0 = Date.now();
const r = await api("/api/topics-refresh", {});
log(`topics-refresh (${Math.round((Date.now() - t0) / 1000)}s)`, { added: r.j?.added, volumesKnown: r.j?.volumesKnown, growthKnown: r.j?.growthKnown, factors: r.j?.topics?.slice(0, 5).map((t) => t.factors) });
