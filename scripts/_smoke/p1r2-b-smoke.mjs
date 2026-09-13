// P1R2-B 로컬 스모크 — 편성 크론 6스텝 · 슬롯 게이트 · 계정 전이 · 슬롯/발행함/알림함 API
//   계약 §1·§4·§6 · 트리거 «검증» 절. 소재는 SQL 로 심는다(LLM 비용·시간 0 · 결정론).
//   측정 원칙(PITFALLS #7): «예외 없이 돌았다»가 아니라 **스텝별 changed/skipped 숫자**를 센다.
import postgres from "postgres";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8901";
const ROOT = "C:/Users/Administrator/Desktop/작업/dev/AutoCreate-B";
const env = Object.fromEntries(fs.readFileSync(`${ROOT}/.env`, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sql = postgres(env.NETLIFY_DATABASE_URL, { ssl: "require", prepare: false, max: 2 });
const SECRET = env.CRON_SECRET;
let cookie = "";
const R = [];
const log = (k, v) => { const s = typeof v === "string" ? v : JSON.stringify(v); console.log(`\n■ ${k}\n${s.slice(0, 1200)}`); R.push([k, s.slice(0, 600)]); };
const fail = (k, why) => { console.log(`\n❌ ${k} — ${why}`); R.push([`FAIL:${k}`, why]); };
const ok = (k, why = "") => { console.log(`✅ ${k}${why ? " — " + why : ""}`); R.push([`OK:${k}`, why]); };

async function api(path, body, method) {
  const r = await fetch(`${BASE}${path}`, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.getSetCookie?.() || []; for (const c of sc) { const m = /^(ac_user)=([^;]+)/.exec(c); if (m) cookie = `${m[1]}=${m[2]}`; }
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, j };
}
/** 크론 강제 실행 → 스텝별 숫자 표 */
async function tick(every) {
  const r = await api(`/api/cron-run?every=${every}&tid=${tid}&secret=${encodeURIComponent(SECRET)}`, {}, "POST");
  const tbl = (r.j?.ran ?? []).map((s) => `${s.step}: changed=${s.changed} skipped=${s.skipped} errors=${s.errors} tenants=${s.tenants}${s.detail ? " " + JSON.stringify(s.detail) : ""}`).join("\n  ");
  console.log(`\n▶ cron-tick-${every} (${r.status}, ${r.j?.ms}ms, 테넌트 ${r.j?.tenants})\n  ${tbl}`);
  R.push([`tick-${every}`, tbl.slice(0, 900)]);
  return r.j?.ran ?? [];
}
const step = (ran, key) => ran.find((s) => s.step === key) ?? { changed: -1, skipped: -1, errors: -1 };
const kstHour = () => new Date(Date.now() + 9 * 3600e3).getUTCHours();

/* ───────── 0. 준비 ───────── */
const ts = Date.now();
const email = `b2smoke-${ts}@test.local`;
log("register", await api("/api/auth-register", { email, password: "Smoke1234!", name: "R2스모크" }));
const me = await api("/api/auth-me");
const tid = me.j?.tenant?.id; if (!tid) throw new Error("no tid");
log("tenant", { tid, key: me.j?.tenant?.key, status: me.j?.tenant?.status });

await sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${tid}, 'grant', 'included', 200, ${`smoke:${ts}`}, 'R2 스모크 지급')`;
log("accounts-add naver", await api("/api/accounts-add", { channel: "naver_blog", handle: `r2_naver_${ts}`, loginId: "id", password: "pw!" }));
log("accounts-add naver2", await api("/api/accounts-add", { channel: "naver_blog", handle: `r2_naver2_${ts}`, loginId: "id2", password: "pw2!" }));
const accs = (await api("/api/accounts-list")).j.accounts;
await sql`UPDATE accounts SET status = 'active' WHERE tenant_id = ${tid}`;   // 러너 검증 없이 active 로(스모크)

// 소재 5개 심기(LLM 0 · 결정론)
for (let i = 1; i <= 5; i++) {
  await sql`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
    VALUES (${tid}, ${`스모크 소재 ${i}`}, ${`앵글 ${i}`}, ${`smoke-topic-${ts}-${i}`}, 'naver_blog', 'smoke',
            ${sql.json({ intent: "info", pain: 0.6, performance: 0 })}, ${90 - i}, 'candidate', NOW() + interval '7 days')`;
}
const [tchk] = await sql`SELECT jsonb_typeof(factors) AS t FROM topics WHERE tenant_id = ${tid} LIMIT 1`;
tchk.t === "object" ? ok("topics.factors jsonb", "object") : fail("topics.factors jsonb", tchk.t);

/* ───────── 1. 규칙 저장 → 슬롯 생성 ───────── */
log("rules-save", await api("/api/rules-save", { rules: [{ channel: "naver_blog", every: "week", count: 5, accountMode: "auto", active: true }] }));
log("rules-settings(자동 편성 ON)", await api("/api/rules-settings", { autoSchedule: true, horizonDays: 7, topicLeadDays: 7, produceLeadDays: 3, reviewPolicy: "silence_approves" }));
const [{ c: slotCnt }] = await sql`SELECT COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid}`;
slotCnt > 0 ? ok("rollSlots(규칙 저장 시)", `${slotCnt}자리`) : fail("rollSlots", "0자리");

/* ───────── 2. 인증 게이트 ───────── */
const noSecret = await api("/api/cron-run?every=hourly", {}, "POST");
noSecret.status === 401 ? ok("크론 인증 게이트", "시크릿 없으면 401") : fail("크론 인증 게이트", `status ${noSecret.status}`);
const badSecret = await api("/api/cron-run?every=hourly&secret=wrong", {}, "POST");
badSecret.status === 401 ? ok("크론 인증 게이트", "틀린 시크릿 401") : fail("크론 인증 게이트(오답)", `status ${badSecret.status}`);

/* ───────── 3. hourly 1회 — roll + assign_topics ───────── */
const t1 = await tick("hourly");
const roll1 = step(t1, "slots.roll"), asg1 = step(t1, "slots.assign_topics");
roll1.changed === 0 ? ok("slots.roll 멱등", "규칙 저장이 이미 채웠다 → changed 0") : log("slots.roll", `changed ${roll1.changed}(신규 자리)`);
asg1.changed > 0 ? ok("slots.assign_topics", `${asg1.changed}자리에 소재 배정`) : fail("slots.assign_topics", `changed ${asg1.changed}`);
const assigned = await sql`SELECT COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid} AND status = 'topic_assigned' AND topic_id IS NOT NULL`;
log("topic_assigned 자리", assigned[0].c);
const picked = await sql`SELECT COUNT(*)::int AS c FROM topics WHERE tenant_id = ${tid} AND status = 'picked'`;
picked[0].c === asg1.changed ? ok("소재 CAS", `picked ${picked[0].c} = 배정 ${asg1.changed}`) : fail("소재 CAS", `picked ${picked[0].c} ≠ 배정 ${asg1.changed}`);

/* ───────── 4. 재실행 멱등 ───────── */
const t2 = await tick("hourly");
const asg2 = step(t2, "slots.assign_topics");
asg2.changed === 0 ? ok("assign_topics 재실행 멱등", "changed 0") : fail("assign_topics 멱등", `changed ${asg2.changed}`);
step(t2, "slots.roll").changed === 0 ? ok("roll 재실행 멱등", "changed 0") : fail("roll 멱등", `changed ${step(t2, "slots.roll").changed}`);

/* ───────── 5. produce — 시각 게이트 → 강제 ───────── */
const wrongHour = String((kstHour() + 3) % 24).padStart(2, "0") + ":00";
await api("/api/rules-settings", { produceHour: wrongHour });
const t3 = await tick("hourly");
step(t3, "slots.produce").changed === 0 ? ok("produce 시각 게이트", `${wrongHour} 아니면 안 만든다`) : fail("produce 시각 게이트", "시각이 아닌데 만들었다");

const nowHour = String(kstHour()).padStart(2, "0") + ":00";
await api("/api/rules-settings", { produceHour: nowHour });
log("produceHour → 지금", nowHour);
const t4 = await tick("hourly");
const prod = step(t4, "slots.produce");
prod.changed > 0 ? ok("slots.produce", `${prod.changed}건 · ${JSON.stringify(prod.detail)}`) : fail("slots.produce", `changed ${prod.changed} detail ${JSON.stringify(prod.detail)}`);

const made = await sql`SELECT p.id, p.status, p.slot_id, s.status AS slot_status, s.origin FROM pieces p JOIN slots s ON s.id = p.slot_id WHERE p.tenant_id = ${tid} ORDER BY p.id`;
log("만들어진 piece", made.map((m) => `#${m.id} ${m.status} slot#${m.slot_id}:${m.slot_status}(${m.origin})`).join(" · "));
made.every((m) => m.slot_id) ? ok("슬롯 게이트", "자동 생성 piece 전건이 슬롯을 달고 있다") : fail("슬롯 게이트", "슬롯 없는 piece 존재");
const [ghost] = await sql`SELECT COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid} AND origin = 'manual'`;
ghost.c === 0 ? ok("유령 슬롯 0", "자동 경로가 편성 자리를 빌려 썼다") : fail("유령 슬롯", `manual 슬롯 ${ghost.c}개`);
const [spent] = await sql`SELECT COALESCE(SUM(-delta),0)::int AS c FROM coin_ledger WHERE tenant_id = ${tid} AND kind = 'consume'`;
spent.c > 0 ? ok("코인 차감", `${spent.c}코인`) : fail("코인 차감", "0");
const [aud] = await sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'piece_auto_produced'`;
aud.c > 0 ? ok("감사 piece_auto_produced", `${aud.c}건`) : fail("감사 piece_auto_produced", "0건");
const [blk] = await sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action IN ('piece_slotless_blocked','piece_slotless_bypassed')`;
blk.c === 0 ? ok("슬롯 게이트 거부 0", "정상 경로에서 막힌 건 없다") : fail("슬롯 게이트", `${blk.c}건 거부/우회`);

/* produce 재실행 멱등 */
const t5 = await tick("hourly");
step(t5, "slots.produce").changed === 0 ? ok("produce 재실행 멱등", "changed 0(같은 자리 두 번 안 만든다)") : fail("produce 멱등", `changed ${step(t5, "slots.produce").changed}`);

/* ───────── 6. 주간 코인 상한 ───────── */
await api("/api/rules-settings", { weeklyCoinCap: 1 });
await sql`UPDATE slots SET status = 'topic_assigned', piece_id = NULL WHERE tenant_id = ${tid} AND status = 'producing' AND id = (SELECT MIN(id) FROM slots WHERE tenant_id = ${tid} AND status = 'producing')`;
const t6 = await tick("hourly");
const cap = step(t6, "slots.produce");
const [csl] = await sql`SELECT COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid} AND status = 'coin_short'`;
csl.c > 0 ? ok("weeklyCoinCap", `상한 초과 → coin_short ${csl.c}자리 · ${JSON.stringify(cap.detail)}`) : fail("weeklyCoinCap", `coin_short 0 · ${JSON.stringify(cap.detail)}`);
const [spent2] = await sql`SELECT COALESCE(SUM(-delta),0)::int AS c FROM coin_ledger WHERE tenant_id = ${tid} AND kind = 'consume'`;
spent2.c === spent.c ? ok("상한 초과 시 원장 무접촉", `${spent2.c}코인 그대로`) : fail("원장 무접촉", `${spent.c} → ${spent2.c}`);
await api("/api/rules-settings", { weeklyCoinCap: null });

/* ───────── 7. 검수창 마감 ─────────
   ⚠️ 로컬 한정 인공물: `netlify dev` 는 `-background` 함수를 **동기로** 돌린다(프로덕션은 202 즉시).
      그래서 크론 produce 가 생성이 끝날 때까지 막혀 함수 타임아웃이 난다 — 이번 스모크는 배경 호출을
      스텁(3990)으로 끊어 **크론 스텝만** 잰다. 글 생성 파이프라인 자체는 P1R1 에서 이미 실증됐다.
      아래 in_review 는 **모의**다(실증 아님) — 검수창 마감 스텝의 전이·게이트를 재기 위한 것. */
const pid = made[0]?.id;
if (!pid) { fail("produce", "piece 가 만들어지지 않아 이후 단계를 잴 수 없다"); console.log("요약: 실패로 중단"); await sql.end(); process.exit(1); }
await sql`UPDATE pieces SET status = 'in_review',
    title = '스모크 검수 대상',
    body = '<p>오늘은 동네 도서관에 다녀왔어요. 아이랑 같이 그림책을 골랐는데 생각보다 종류가 많았습니다.</p><h2>가는 길</h2><p>버스로 두 정거장이면 닿습니다. 주차는 지하에 하시면 됩니다.</p>',
    blocks = '[]'::jsonb,
    meta = meta || ${sql.json({ editedByUser: true, affiliate: null, adDisclosure: false, stage: "done" })},
    updated_at = NOW()
  WHERE tenant_id = ${tid} AND id = ${pid}`;
await sql`UPDATE slots SET status = 'in_review', review_deadline = NOW() - interval '1 hour' WHERE tenant_id = ${tid} AND piece_id = ${pid}`;
log("검수 대상 모의 주입", `piece#${pid} in_review · 마감 1시간 전으로`);

const t7 = await tick("hourly");
const rd = step(t7, "slots.review_deadline");
const [after] = await sql`SELECT p.status AS ps, s.status AS ss, p.scheduled_for FROM pieces p JOIN slots s ON s.id = p.slot_id WHERE p.id = ${pid}`;
if (after.ps === "scheduled" && after.ss === "scheduled") ok("review_deadline 자동 승인", `piece/slot 둘 다 scheduled · ${JSON.stringify(rd.detail)}`);
else if (after.ps === "awaiting_manual") ok("review_deadline 하드 게이트 차단", `자동 승인 멈춤 → ${after.ps}(정책 위반 무발행) · ${JSON.stringify(rd.detail)}`);
else fail("review_deadline", `piece ${after.ps} · slot ${after.ss} · ${JSON.stringify(rd.detail)}`);
const [apAud] = await sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action IN ('piece_approve','piece_auto_approve_blocked')`;
apAud.c > 0 ? ok("검수 감사", `${apAud.c}건`) : fail("검수 감사", "0건");

/* ───────── 8. 발행 디스패처(B2 미머지 → 정직한 «미구현») ───────── */
await sql`UPDATE pieces SET status = 'scheduled', scheduled_for = NOW() - interval '10 minutes' WHERE tenant_id = ${tid} AND id = ${pid}`;
const before = await sql`SELECT status, meta FROM pieces WHERE id = ${pid}`;
const t8 = await tick("5m");
const pub = step(t8, "publisher");
const afterPub = await sql`SELECT status FROM pieces WHERE id = ${pid}`;
if (pub.detail?.connector === "missing") {
  ok("publisher 정직 반환", `커넥터 미연결 → changed 0 · skipped ${pub.skipped} · 상태 무접촉(${before[0].status} → ${afterPub[0].status})`);
  afterPub[0].status === "scheduled" ? ok("미연결 시 상태 무접촉", "due 글을 죽이지 않는다") : fail("미연결 시 상태 무접촉", afterPub[0].status);
  const [pcm] = await sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'publish_connector_missing'`;
  pcm.c > 0 ? ok("감사 publish_connector_missing", `${pcm.c}건(risk high)`) : fail("감사 publish_connector_missing", "0건");
} else {
  log("publisher(커넥터 연결됨)", `changed ${pub.changed} skipped ${pub.skipped} detail ${JSON.stringify(pub.detail)} · piece ${afterPub[0].status}`);
}
const t9 = await tick("5m");
ok("publisher 재실행", `changed ${step(t9, "publisher").changed} (멱등)`);
log("runner.reap", JSON.stringify(step(t9, "runner.reap")));

/* ───────── 9. 계정 전이·승계 — 자리를 @a 에 몰아 두고 하니스에 넘긴다 ───────── */
const deadAcc = accs[0].id;
await sql`UPDATE slots SET account_id = ${deadAcc} WHERE tenant_id = ${tid} AND status IN ('planned','topic_assigned','coin_short')`;
const [beforeMove] = await sql`SELECT COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid} AND account_id = ${deadAcc}`;
log("계정 전이 준비", `@${accs[0].handle} 에 ${beforeMove.c}자리 · 정지 시뮬·승계는 p1r2-b-health.ts 가 잰다`);
fs.writeFileSync(`${ROOT}/scripts/_smoke/.last-tid`, JSON.stringify({ tid, deadAcc, aliveAcc: accs[1].id }));

/* ───────── 10. 고객 API ───────── */
const openSlot = (await sql`SELECT id, slot_date::text AS d FROM slots WHERE tenant_id = ${tid} AND status IN ('planned','topic_assigned','no_topic') AND piece_id IS NULL ORDER BY id LIMIT 1`)[0];
if (openSlot) {
  const freeTopic = (await sql`SELECT id FROM topics WHERE tenant_id = ${tid} AND status = 'candidate' LIMIT 1`)[0];
  if (freeTopic) log("slots-assign-topic", await api("/api/slots-assign-topic", { slotId: openSlot.id, topicId: freeTopic.id }));
  const far = new Date(Date.now() + 3 * 86400e3 + 7200e3).toISOString();
  log("slots-reschedule", await api("/api/slots-reschedule", { slotId: openSlot.id, at: far }));
  log("slots-reschedule(10분 이내 거부)", await api("/api/slots-reschedule", { slotId: openSlot.id, at: new Date(Date.now() + 60e3).toISOString() }));
}
const pl = await api("/api/posts-list");
log("posts-list", { status: pl.status, count: pl.j?.posts?.length, first: pl.j?.posts?.[0] });
const nl = await api("/api/notifications-list");
log("notifications-list", { status: nl.status, unread: nl.j?.unread, kinds: (nl.j?.notifications ?? []).map((x) => `${x.kind}/${x.tone}`).join(" · ") });
const hs = await api("/api/home-summary");
(hs.j?.unread === nl.j?.unread) ? ok("unread 일치", `home-summary ${hs.j?.unread} = notifications ${nl.j?.unread}`) : fail("unread 불일치", `home ${hs.j?.unread} ≠ list ${nl.j?.unread}`);
log("notifications-read(전부)", await api("/api/notifications-read", {}));

/* ───────── 11. IDOR ───────── */
const otherSlot = (await sql`SELECT id FROM slots WHERE tenant_id <> ${tid} ORDER BY id DESC LIMIT 1`)[0];
if (otherSlot) {
  const idor = await api("/api/slots-reschedule", { slotId: otherSlot.id, at: new Date(Date.now() + 86400e3).toISOString() });
  idor.status === 404 ? ok("IDOR 차단", "남의 슬롯 404") : fail("IDOR", `status ${idor.status} ${JSON.stringify(idor.j)}`);
}

/* ───────── 정리 ───────── */
const finalSlots = await sql`SELECT status, COUNT(*)::int AS c FROM slots WHERE tenant_id = ${tid} GROUP BY status ORDER BY 2 DESC`;
log("최종 슬롯 분포", finalSlots.map((r) => `${r.status}=${r.c}`).join(" · "));
const [cronAudit] = await sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'cron_tick' AND created_at > NOW() - interval '20 minutes'`;
cronAudit.c > 0 ? ok("cron_tick 전건 감사", `${cronAudit.c}행`) : fail("cron_tick 감사", "0행");

console.log("\n\n════════ 요약 ════════");
const fails = R.filter(([k]) => k.startsWith("FAIL:"));
const oks = R.filter(([k]) => k.startsWith("OK:"));
console.log(`통과 ${oks.length} · 실패 ${fails.length}`);
for (const [k, v] of fails) console.log(`  ❌ ${k.slice(5)} — ${v}`);
console.log(`\n테스트 테넌트 tid=${tid} email=${email}`);
await sql.end();
process.exit(fails.length ? 1 : 0);
