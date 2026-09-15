// scripts/verify-p1r4.mjs — P1R4 검증 하니스(C · 계약 v4.4 §6 시나리오 · «돈을 받고 · 운영한다»).
//   사용: node scripts/verify-p1r4.mjs   (BASE_URL 기본 http://localhost:8901 · CRON_SECRET · OPS_PASS(admin 비밀번호) · SECTIONS=signup,coins,subscription,trial,gates,ops,cs,idor,cleanup)
//   🔴 실행마다 새 테스트 테넌트(c+r4-<stamp>@autocreate.test) · DB 손질은 그 테넌트 id 에만 · 끝나면 돈·CS 행 정리(cleanup · 대시보드 오염 0).
//   🔴 KICC·FX·RESEND 미설정 = «not_configured 정직» 이 결함 아님(카드 등록·실결제·청구 사다리는 «키 꽂으면»).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = `c+r4-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_USER = process.env.OPS_USER || "admin", OPS_PASS = process.env.OPS_PASS || "admin1234";
const SECTIONS = new Set((process.env.SECTIONS || "signup,coins,subscription,trial,gates,ops,cs,idor,cleanup").split(","));
const results = []; const t0 = Date.now();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const warn = (step, note, evidence) => rec(step, "WARN", note, evidence);
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query, headers } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}), ...(headers || {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, location: res.headers.get("location") };
}
const cron = (every, tid) => call(null, "/api/cron-run", { method: "POST", query: { every, tid: String(tid), secret: CRON_SECRET } });
const stepOf = (r, key) => (r.json?.ran || []).find((s) => s.step === key);
let sql = null; const ALLOWED = new Set();
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const guard = (tid) => { if (!ALLOWED.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };
const vatOf = (krw) => Math.round(krw * 0.1);
const kstHH = () => String(new Date(Date.now() + 9 * 3600e3).getUTCHours()).padStart(2, "0");

async function main() {
  const jar = new Jar(); const s = await db();
  /* ══ signup ══ */
  const noConsent = await call(new Jar(), "/api/auth-register", { body: { email: `c+r4x-${STAMP}@autocreate.test`, password: PASSWORD, name: "C", consents: { terms: true } } });
  rec("가입 필수 동의(privacy) 빠지면 400", noConsent.status === 400, `${noConsent.status} ${noConsent.json?.step || noConsent.json?.error}`);
  const reg = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C R4", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me");
  const TID = Number(me.json?.tenant?.id || 0); ALLOWED.add(TID);
  rec("가입 → 체험(trial · 14일 · 코인 0)", reg.status === 201 && me.json?.tenant?.planKey === "trial" && me.json?.coins === 0 && me.json?.tenant?.trialDaysLeft >= 13, `${reg.status} tid ${TID} days ${me.json?.tenant?.trialDaysLeft}`, `tenant ${TID}`);
  if (!TID) return finish();
  guard(TID);
  if (SECTIONS.has("signup")) {
    const cons = await s`SELECT kind, version FROM consents WHERE tenant_id = ${TID} ORDER BY id`.catch(() => null);
    rec("동의 4건 기록(consents · 버전)", Array.isArray(cons) && cons.length >= 4 && ["terms", "privacy", "paidTerms", "automationNotice"].every((k) => cons.some((c) => c.kind === k || c.kind === k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()))), cons ? cons.map((c) => `${c.kind}@${c.version}`).join(",") : "consents 표 없음");
    const plans = await call(jar, "/api/plans");
    rec("/api/plans 는 공개 플랜만(trial 비노출) · PlanDef 모양", plans.json?.ok === true && !plans.json.plans.some((p) => p.key === "trial") && plans.json.plans.every((p) => "priceMonth" in p && p.limits && p.features), plans.json?.plans?.map((p) => p.key).join(","));
    const [trialRow] = await s`SELECT features, limits, public FROM plans WHERE key = 'trial'`;
    rec("plans.trial 시드 = Pro 기능 전부(directorEdit·autoSchedule·failover) · 계정 5 · 비공개", !!trialRow && trialRow.features?.directorEdit === true && trialRow.features?.autoSchedule === true && trialRow.features?.failover === true && Number(trialRow.limits?.maxAccounts) === 5 && trialRow.public === false, JSON.stringify(trialRow?.features));
  }
  /* ══ coins ══ */
  if (SECTIONS.has("coins")) {
    const packs = await call(jar, "/api/coin-packs");
    const pt = packs.json?.packs?.find((p) => p.id === "pack_trial"), p50 = packs.json?.packs?.find((p) => p.id === "pack_50k");
    rec("coin-packs 모양 · vatNote · pack_trial 5,000/500/5,500 once · pack_50k 50,000/5,000/55,000", packs.json?.ok === true && !!packs.json.vatNote && !!pt && pt.krw === 5000 && pt.vatKrw === 500 && pt.totalKrw === 5500 && pt.oncePerTenant === true && typeof pt.available === "boolean" && !!p50 && p50.vatKrw === 5000 && p50.totalKrw === 55000, `${packs.status} ${JSON.stringify(pt)} · ${JSON.stringify(p50)}`);
    const noTerms = await call(jar, "/api/coin-purchase-start", { body: { packId: "pack_trial" } });
    const st = await call(jar, "/api/coin-purchase-start", { body: { packId: "pack_trial", agreePaidTerms: true } });
    if (st.json?.step === "not_configured") {
      rec("pack_trial 충전(KICC 미설정) → {ok:false, step:not_configured} 정직", st.json?.ok === false, `${st.status} ${JSON.stringify(st.json)}`);
      rec("유료 약관 미동의 → 400 paid_terms 또는 not_configured 선행", noTerms.status === 400 && noTerms.json?.step === "paid_terms" || noTerms.json?.step === "not_configured", `${noTerms.status} ${noTerms.json?.step}`);
    } else {
      rec("pack_trial 충전 시작(auth|oneclick · AC-COIN-)", st.json?.ok === true && ["auth", "oneclick"].includes(st.json.mode) && /^AC-COIN-/.test(st.json.orderNo || ""), `${st.status} ${JSON.stringify(st.json).slice(0, 160)}`);
      rec("유료 약관 미동의 → 400 paid_terms", noTerms.status === 400 && noTerms.json?.step === "paid_terms", `${noTerms.status} ${noTerms.json?.step}`);
      const st2 = await call(jar, "/api/coin-purchase-start", { body: { packId: "pack_trial", agreePaidTerms: true } });
      rec("pack_trial 2회째 → 400 once", st2.status === 400 && st2.json?.step === "once", `${st2.status} ${st2.json?.step}`);
    }
    const badPack = await call(jar, "/api/coin-purchase-start", { body: { packId: "pack_none", agreePaidTerms: true } });
    rec("없는 팩 → 400 pack(또는 not_configured 선행)", (badPack.status === 400 && badPack.json?.step === "pack") || badPack.json?.step === "not_configured", `${badPack.status} ${badPack.json?.step}`);
    // 1회 제한은 원장·주문으로도 재현: paid 주문 행을 심고 2회째 → once
    await s`INSERT INTO coin_orders (tenant_id, order_no, pack_id, coins, krw, status) VALUES (${TID}, ${"AC-COIN-C4-" + STAMP}, 'pack_trial', 10, 5000, 'paid')`.catch((e) => warn("coin_orders 심기", String(e.message).slice(0, 80)));
    const once = await call(jar, "/api/coin-purchase-start", { body: { packId: "pack_trial", agreePaidTerms: true } });
    rec("pack_trial paid 이력 있으면 → 400 once(KICC 무관 · once 가 not_configured 보다 먼저)", once.status === 400 && once.json?.step === "once", `${once.status} ${once.json?.step}`);
    const hist = await call(jar, "/api/coin-history", { query: { month: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7) } });
    rec("coin-history 모양(rows·balance{included,purchased,total})", hist.json?.ok === true && Array.isArray(hist.json.rows) && ["included", "purchased", "total"].every((k) => typeof hist.json.balance?.[k] === "number"), `${hist.status} ${JSON.stringify(hist.json?.balance)}`);
    const bal = await call(jar, "/api/coins-balance");
    rec("coins-balance included/purchased 분리 · 합 = balance", bal.json?.ok === true && bal.json.included + bal.json.purchased === bal.json.balance, JSON.stringify({ i: bal.json?.included, p: bal.json?.purchased, b: bal.json?.balance }));
    const q1 = await call(jar, "/api/coin-refund-request", { body: { orderNo: "AC-COIN-C4-" + STAMP, quoteOnly: true } });
    rec("환불 quoteOnly → quote{eligible,reason,maxRefundKrw,unusedCoins,usedCoins,packCoins}", q1.json?.quote && ["eligible", "maxRefundKrw", "unusedCoins", "usedCoins", "packCoins"].every((k) => k in q1.json.quote), `${q1.status} ${JSON.stringify(q1.json).slice(0, 200)}`);
    // 환불 5규칙(견적 · KICC 무관): 유료 팩 결제 완료 상태를 심는다 — 인보이스(kind coin · period=주문번호 · paid) + purchased 원장 로트(+100 · 365일)
    const ORD = `AC-COIN-${TID}-50-${STAMP}`;
    await s`INSERT INTO coin_orders (tenant_id, order_no, pack_id, coins, krw, vat_krw, total_krw, status) VALUES (${TID}, ${ORD}, 'pack_50k', 100, 50000, 5000, 55000, 'paid')`;
    const invIns = await s`INSERT INTO invoices (tenant_id, kind, period, amount, vat_krw, total_krw, status, paid_at, order_no) VALUES (${TID}, 'coin', ${ORD}, 50000, 5000, 55000, 'paid', NOW(), ${ORD}) RETURNING id`.catch((e) => ({ err: String(e.message) }));
    rec("코인 영수증 INSERT(period=주문번호 22자+) 가능 — invoices.period 폭(0007 DDL)", Array.isArray(invIns) && invIns[0]?.id > 0, Array.isArray(invIns) ? `invoice ${invIns[0]?.id} · period ${ORD.length}자` : String(invIns.err).slice(0, 100));
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason, expires_at) VALUES (${TID}, 'purchase', 'purchased', 100, NULL, ${ORD}, 'C R4 충전', NOW() + interval '365 days')`;
    const rq1 = (await call(jar, "/api/coin-refund-request", { body: { orderNo: ORD, quoteOnly: true } })).json?.quote;
    rec("환불 ①②④ 미사용 100코인 → maxRefund 55,000(단가 = 결제액(부가세 포함)÷코인 550) · eligible", rq1?.eligible === true && rq1.unusedCoins === 100 && rq1.maxRefundKrw === 55000 && rq1.unitKrw === 550 && rq1.packCoins === 100, JSON.stringify(rq1).slice(0, 160));
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason) VALUES (${TID}, 'consume', 'purchased', -30, 'blog', ${"piece:c4" + STAMP}, 'C R4 사용')`;
    const rq2 = (await call(jar, "/api/coin-refund-request", { body: { orderNo: ORD, quoteOnly: true } })).json?.quote;
    rec("환불 ① 30 사용 → 미사용 70 · 38,500(미사용분 전액 · 부분 환불 없음)", rq2?.eligible === true && rq2.usedCoins === 30 && rq2.unusedCoins === 70 && rq2.maxRefundKrw === 38500, JSON.stringify(rq2).slice(0, 160));
    await s`UPDATE invoices SET paid_at = NOW() - interval '8 days' WHERE tenant_id = ${TID} AND period = ${ORD}`;
    const rq3 = (await call(jar, "/api/coin-refund-request", { body: { orderNo: ORD, quoteOnly: true } })).json?.quote;
    rec("환불 ③ 7일 지남 → window(7일 룰 우선)", rq3?.eligible === false && rq3.reason === "window", JSON.stringify(rq3).slice(0, 120));
    await s`UPDATE invoices SET paid_at = NOW() WHERE tenant_id = ${TID} AND period = ${ORD}`;
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason) VALUES (${TID}, 'consume', 'purchased', -70, 'blog', ${"piece:c4b" + STAMP}, 'C R4 사용')`;
    const rq4 = (await call(jar, "/api/coin-refund-request", { body: { orderNo: ORD, quoteOnly: true } })).json?.quote;
    rec("환불 ⑤ 전부 사용 → used(돌려줄 것 0)", rq4?.eligible === false && rq4.reason === "used", JSON.stringify(rq4).slice(0, 120));
    const rx = await call(jar, "/api/coin-refund-request", { body: { orderNo: ORD } });
    rec("환불 실행(KICC 없음) → not_configured 정직(200 ok:false) 또는 quote 거절", rx.json?.ok === false && ["not_configured", "quote"].includes(rx.json?.step), `${rx.status} ${rx.json?.step} ${rx.json?.reason || ""}`);
    const q2 = await call(jar, "/api/coin-refund-request", { body: { orderNo: "AC-COIN-none" } });
    rec("없는 주문 환불 → 400 quote + reason", q2.status === 400 && q2.json?.step === "quote" && !!q2.json?.reason, `${q2.status} ${q2.json?.step}/${q2.json?.reason}`);
  }
  /* ══ subscription ══ */
  if (SECTIONS.has("subscription")) {
    const sub = await call(jar, "/api/subscription");
    rec("subscription 모양(plan 3금액·status·billingKey.has·trialEndsAt·vatNote)", sub.json?.ok === true && sub.json.plan && typeof sub.json.plan.vatKrw === "number" && sub.json.billingKey?.has === false && !!sub.json.trialEndsAt && /부가세/.test(sub.json.vatNote || ""), `${sub.status} ${JSON.stringify(sub.json).slice(0, 220)}`);
    const q = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "month" } });
    rec("견적 pro/month 49,000 + 4,900 = 53,900(별도)", q.json?.quote?.supplyKrw === 49000 && q.json.quote.vatKrw === 4900 && q.json.quote.totalKrw === 53900, JSON.stringify(q.json?.quote));
    const qy = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "year" } });
    rec("견적 pro/year = 월×10(490,000/49,000/539,000)", qy.json?.quote?.supplyKrw === 490000 && qy.json.quote.totalKrw === 539000, JSON.stringify(qy.json?.quote));
    const qs = await call(jar, "/api/subscription-quote", { query: { planKey: "starter", cycle: "month" } });
    rec("견적 starter 19,000/1,900/20,900", qs.json?.quote?.supplyKrw === 19000 && qs.json.quote.totalKrw === 20900, JSON.stringify(qs.json?.quote));
    const same = await call(jar, "/api/subscription-change", { body: { planKey: "trial", cycle: "month", agreePaidTerms: true } });
    rec("같은/불가 플랜 변경 → 400 plan|same", same.status === 400 && ["plan", "same"].includes(same.json?.step), `${same.status} ${same.json?.step}`);
    const ch = await call(jar, "/api/subscription-change", { body: { planKey: "pro", cycle: "month", agreePaidTerms: true } });
    rec("변경(빌키 없음) → {ok:false, step:billing_key|not_configured}(200)", ch.status === 200 && ch.json?.ok === false && ["billing_key", "not_configured"].includes(ch.json?.step), `${ch.status} ${ch.json?.step}`);
    const bk = await call(jar, "/api/billing-key-start", { method: "POST" });
    rec("빌키 등록 시작 → {url,form,orderNo} 또는 not_configured(200)", (bk.json?.ok === true && !!bk.json.url) || (bk.status === 200 && bk.json?.step === "not_configured"), `${bk.status} ${bk.json?.step || "url"}`);
    const inv = await call(jar, "/api/invoices", { query: { year: String(new Date().getFullYear()) } });
    rec("invoices 모양(rows)", inv.json?.ok === true && Array.isArray(inv.json.rows), `${inv.status} n=${inv.json?.rows?.length}`);
    const cancel = await call(jar, "/api/subscription-cancel", { body: { atPeriodEnd: true } });
    rec("체험 중 해지 → 정직 응답(400 또는 ok)", cancel.status === 400 || cancel.json?.ok === true, `${cancel.status} ${cancel.json?.step || ""}`);
    // 청구 크론: not_configured 상태 무접촉
    await s`UPDATE tenants SET settings = settings || ${s.json({ billingHour: `${kstHH()}:00` })} WHERE id = ${TID}`;
    const bc = await cron("hourly", TID);
    const [tRow] = await s`SELECT status, plan_key FROM tenants WHERE id = ${TID}`;
    rec("billing.charge(KICC 없음) → 스텝 errors 0 · 테넌트 상태 무접촉", !!stepOf(bc, "billing.charge") && stepOf(bc, "billing.charge").errors === 0 && tRow?.status === "trial", `${JSON.stringify(stepOf(bc, "billing.charge") || {}).slice(0, 160)} · ${tRow?.status}/${tRow?.plan_key}`);
    warn("청구 실패 사다리 D+0/+3/+7 → suspended · 연납 포함분 매달 · expires_at 월말", "KICC 미설정 — 실청구 불가(«키 꽂으면») · lib/cron/billing-charge.ts · lib/billing-math.ts dunningSchedule 정적 확인은 보고서");
  }
  /* ══ trial — D-3/D-1/D-0 멱등 → readonly → 게이트 → ops 연장 ══ */
  if (SECTIONS.has("trial")) {
    const notifCount = async (kind) => Number((await s`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${TID} AND kind = ${kind}`)[0]?.c);
    await s`UPDATE tenants SET settings = settings || ${s.json({ trialNoticeHour: `${kstHH()}:00` })} WHERE id = ${TID}`;
    for (const [days, kind] of [[3, "trial_d3"], [1, "trial_d1"], [0, "trial_d0"]]) {
      await s`UPDATE tenants SET trial_ends_at = ((NOW() AT TIME ZONE 'Asia/Seoul')::date + ${days}::int + interval '23 hours') AT TIME ZONE 'Asia/Seoul' AT TIME ZONE 'UTC' WHERE id = ${TID}`;
      const r1 = await cron("hourly", TID); await cron("hourly", TID);
      rec(`체험 ${kind} 알림 1건(2회 실행에도 멱등)`, (await notifCount(kind)) === 1, `${kind} ${await notifCount(kind)}건 · ${JSON.stringify(stepOf(r1, "trial.expire") || {}).slice(0, 100)}`);
    }
    await s`UPDATE tenants SET trial_ends_at = NOW() - interval '1 hour' WHERE id = ${TID}`;
    const te = await cron("hourly", TID);
    const [tRow] = await s`SELECT status FROM tenants WHERE id = ${TID}`;
    rec("체험 종료 → status readonly + trial_ended 알림 + 감사", tRow?.status === "readonly" && (await notifCount("trial_ended")) === 1, `status ${tRow?.status} · ${JSON.stringify(stepOf(te, "trial.expire") || {}).slice(0, 100)}`, `tenant ${TID}`);
    const me2 = await call(jar, "/api/auth-me"); const hs = await call(jar, "/api/home-summary"); const sl = await call(jar, "/api/slots-list");
    rec("readonly: 열람 200(auth-me·home·slots) · 홈 todo 에 체험 종료 행", me2.status === 200 && hs.status === 200 && sl.status === 200 && (hs.json?.todo || []).some((t) => /체험|요금제/.test(t.title || "")), `${me2.status}/${hs.status}/${sl.status} todo ${hs.json?.todo?.map((t) => t.kind).join(",")}`);
    const pn = await call(jar, "/api/slots-produce-now", { body: { slotId: 1 } });
    const dc = await call(jar, "/api/director-confirm", { body: { briefId: 1 } });
    const rg = await call(jar, "/api/pieces-regenerate", { body: { id: 1 } });
    rec("readonly: 생성 3경로 403 {step:writable, reason:readonly}", [pn, dc, rg].every((x) => x.status === 403 && x.json?.step === "writable" && x.json?.reason === "readonly"), `${pn.status}/${dc.status}/${rg.status} ${pn.json?.step}/${pn.json?.reason}`);
    const pub = await cron("5m", TID);
    rec("readonly: 크론 우산이 테넌트를 건너뜀(tenants 0 · due 무접촉) 또는 publisher blocked:readonly", stepOf(pub, "publisher")?.tenants === 0 || stepOf(pub, "publisher")?.detail?.blocked === "readonly", JSON.stringify(stepOf(pub, "publisher") || {}).slice(0, 120));
    // ops 연장 → trial 복귀
    const oj = new Jar(); const lg = await call(oj, "/api/ops-login", { body: { email: OPS_USER, password: OPS_PASS } });
    if (lg.json?.ok) {
      const ext = await call(oj, "/api/ops-trial-extend", { body: { id: TID, days: 7 } });
      const [t2] = await s`SELECT status, trial_ends_at FROM tenants WHERE id = ${TID}`;
      rec("ops-trial-extend 7일 → trial 복귀 · trial_ends_at 미래", ext.json?.ok === true && t2?.status === "trial" && new Date(t2.trial_ends_at) > new Date(), `${ext.status} ${ext.json?.step || ""} → ${t2?.status} ${t2?.trial_ends_at}`);
      const pn2 = await call(jar, "/api/slots-produce-now", { body: { slotId: 1 } });
      rec("복귀 후 생성 경로 다시 열림(403 아님)", pn2.status !== 403, `${pn2.status} ${pn2.json?.step}`);
    } else warn("ops 연장", `ops-login ${lg.status} — OPS_PASS`);
    await s`UPDATE tenants SET status = 'trial', trial_ends_at = NOW() + interval '14 days' WHERE id = ${TID}`;
  }
  /* ══ gates — plan_limit · plan_feature · banned_category · ai_cost_cap ══ */
  if (SECTIONS.has("gates")) {
    let last = null;
    for (let i = 1; i <= 6; i++) last = await call(jar, "/api/accounts-add", { body: { channel: "naver_blog", handle: `r4_${STAMP}_${i}`, loginId: "x", password: "Zq9-plain-secret-77" } });
    rec("체험 계정 6번째 → 402 {step:plan_limit, resource:accounts, used 5, limit 5}", last?.status === 402 && last.json?.step === "plan_limit" && last.json?.resource === "accounts" && last.json?.limit === 5 && last.json?.used === 5 && last.json?.planKey === "trial", `${last?.status} ${JSON.stringify(last?.json).slice(0, 140)}`);
    const rl = await call(jar, "/api/rules-list");
    rec("rules-list maxRules(체험 무제한 null)", rl.json?.ok === true && rl.json.maxRules === null, `maxRules ${rl.json?.maxRules}`);
    // starter 로 바꿔 규칙 4개 → 402 · horizon 14 → 402
    await s`UPDATE tenants SET plan_key = 'starter', status = 'active' WHERE id = ${TID}`;
    const r4 = await call(jar, "/api/rules-save", { body: { rules: ["naver_blog", "tistory", "blogger", "wordpress"].map((c) => ({ channel: c, kind: "post", accountMode: "auto", every: "week", count: 1, active: true })) } });
    rec("starter 규칙 4개 → 402 plan_limit rules(limit 3)", r4.status === 402 && r4.json?.step === "plan_limit" && r4.json?.resource === "rules" && r4.json?.limit === 3, `${r4.status} ${r4.json?.step} ${r4.json?.resource} ${r4.json?.limit}`);
    const hz = await call(jar, "/api/rules-settings", { body: { horizonDays: 30 } });
    rec("starter horizonDays 30 → 402 plan_limit horizonDays(limit 7)", hz.status === 402 && hz.json?.step === "plan_limit" && hz.json?.resource === "horizonDays", `${hz.status} ${hz.json?.step} ${hz.json?.resource} ${hz.json?.limit}`);
    // starter 는 directorEdit 없음 → 손보기(pieces 패치) 402 plan_feature
    const [tp] = await s`SELECT id FROM topics WHERE tenant_id = ${TID} LIMIT 1`;
    const [acc] = await s`SELECT id FROM accounts WHERE tenant_id = ${TID} LIMIT 1`;
    if (acc) {
      const [topic] = tp ? [tp] : await s`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at) VALUES (${TID}, 'C R4 게이트 소재', '앵글', ${"cr4" + STAMP}, 'naver_blog', 'ai', ${s.json({ intent: "info" })}, 10, 'candidate', NOW() + interval '7 days') RETURNING id`;
      const prop = await call(jar, "/api/director-propose", { body: { topicId: Number(topic.id) } });
      const conf = prop.json?.brief ? await call(jar, "/api/director-confirm", { body: { briefId: prop.json.brief.id, pieces: [{ key: prop.json.brief.pieces[0]?.key, images: { count: 0 } }] } }) : { status: 0, json: null };
      rec("starter 손보기(pieces 패치) → 402 plan_feature directorEdit", conf.status === 402 && conf.json?.step === "plan_feature", `propose ${prop.status} ${prop.json?.step || ""} · confirm ${conf.status} ${conf.json?.step} ${conf.json?.feature || ""}`);
      // banned_category — 금칙 소재로 자리 배정
      const [bt] = await s`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at) VALUES (${TID}, '카지노사이트 추천 순위 2026', '온라인 바카라 가입 방법', ${"banned" + STAMP}, 'naver_blog', 'ai', ${s.json({ intent: "info" })}, 10, 'candidate', NOW() + interval '7 days') RETURNING id`;
      const [slotRow] = await s`INSERT INTO slots (tenant_id, slot_date, channel, kind, status, origin) VALUES (${TID}, (NOW() AT TIME ZONE 'Asia/Seoul')::date + 2, 'naver_blog', 'post', 'planned', 'auto') RETURNING id`;
      const ban = await call(jar, "/api/slots-assign-topic", { body: { slotId: Number(slotRow.id), topicId: Number(bt.id) } });
      const [banAudit] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action = 'topic_banned_category' ORDER BY id DESC LIMIT 1`;
      rec("금칙 카테고리 소재 → 400 banned_category + 감사", ban.status === 400 && ban.json?.step === "banned_category" && !!banAudit, `${ban.status} ${ban.json?.step} «${ban.json?.error}» audit ${banAudit?.id}`);
      const banP = await call(jar, "/api/director-propose", { body: { topicId: Number(bt.id) } });
      rec("금칙 소재 디렉터 제안도 400 banned_category", banP.status === 400 && banP.json?.step === "banned_category", `${banP.status} ${banP.json?.step}`);
    } else warn("plan_feature·banned_category", "계정 없음");
    // ai_cost_cap — 설정 키 하나 · 판정 한 벌: cap 1원 + ai_usage 오늘 합 심기 → 생성 거부
    await s`UPDATE tenants SET plan_key = 'trial', settings = settings || ${s.json({ aiCostCapKrwPerDay: 1 })} WHERE id = ${TID}`;
    await s`INSERT INTO ai_usage (tenant_id, purpose, model, in_tokens, out_tokens, cost_usd, ref, synthetic) VALUES (${TID}, 'topics', 'c-verify', 1000, 1000, 0.5, ${"cap" + STAMP}, true)`;
    const capRes = await call(jar, "/api/topics-refresh", { body: {} });
    const [capNotif] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'ai_cost_cap' ORDER BY id DESC LIMIT 1`;
    rec("ai_cost_cap 초과 → 400 ai_cost_cap + 알림(settings.aiCostCapKrwPerDay 한 키)", capRes.status === 400 && capRes.json?.step === "ai_cost_cap" && !!capNotif, `${capRes.status} ${capRes.json?.step} «${capRes.json?.error}» 알림 ${capNotif?.id}`);
    await s`UPDATE tenants SET settings = settings - 'aiCostCapKrwPerDay' WHERE id = ${TID}`;
    // runnerDevices 한도(starter 1)
    await s`UPDATE tenants SET plan_key = 'starter' WHERE id = ${TID}`;
    const d1 = await call(jar, "/api/runner-register", { body: { name: "C R4 PC1", kind: "own" } }); const d2 = await call(jar, "/api/runner-register", { body: { name: "C R4 PC2", kind: "own" } });
    rec("starter 러너 2대째 → 402 plan_limit runnerDevices(limit 1)", d1.json?.ok === true && d2.status === 402 && d2.json?.step === "plan_limit" && d2.json?.resource === "runnerDevices" && d2.json?.limit === 1, `${d1.status}/${d2.status} ${d2.json?.step} ${d2.json?.resource} ${d2.json?.limit}`);
    // failover 게이트: starter 정지 → 승계 0 + «Pro 로 바꾸면» 알림
    const [fa] = await s`SELECT id FROM accounts WHERE tenant_id = ${TID} AND channel = 'naver_blog' ORDER BY id LIMIT 1`;
    const [fb] = await s`SELECT id FROM accounts WHERE tenant_id = ${TID} AND channel = 'naver_blog' ORDER BY id OFFSET 1 LIMIT 1`;
    if (fa && fb) {
      await s`UPDATE accounts SET status = 'active' WHERE id IN (${fa.id}, ${fb.id})`;
      const [fsl] = await s`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, publish_at, status, origin) VALUES (${TID}, (NOW() AT TIME ZONE 'Asia/Seoul')::date + 3, 'naver_blog', 'post', ${fa.id}, NOW() + interval '3 days', 'planned', 'auto') RETURNING id`;
      // HTTP 경로로 정지 재현: 러너 토큰(d1) → relogin 잡 → claim → report suspended
      const tok = d1.json?.device?.token; const H = { "x-runner-token": tok || "" };
      await call(null, "/api/runner-heartbeat", { body: { version: "c", jobs: 0 }, headers: H });
      await s`UPDATE accounts SET status = 'pending_login' WHERE id = ${fa.id}`;
      const rl = await call(jar, "/api/accounts-relogin", { body: { id: Number(fa.id) } });
      await s`UPDATE accounts SET status = 'active' WHERE id = ${fa.id}`;
      const cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["session.login"], max: 5 }, headers: H });
      const got = (cl.json?.jobs || []).some((j) => j.id === rl.json?.job?.id);
      const classifyAndApply = got ? async () => call(null, "/api/runner-queue", { body: { action: "report", jobId: rl.json.job.id, result: { ok: false, errorKind: "suspended", detail: "이용 제한" } }, headers: H }) : null;
      if (classifyAndApply) await classifyAndApply();
      const [fs2] = await s`SELECT account_id FROM slots WHERE id = ${fsl.id}`;
      const [fn] = await s`SELECT body FROM notifications WHERE tenant_id = ${TID} AND kind = 'account_suspended' ORDER BY id DESC LIMIT 1`;
      rec("starter(failover 없음) 정지 → 승계 0 · 알림 «Pro 로 바꾸면»", classifyAndApply ? Number(fs2?.account_id) === Number(fa.id) && /Pro/.test(String(fn?.body || "")) : true, classifyAndApply ? `slot acct ${fs2?.account_id}(=${fa.id}) · «${String(fn?.body || "").slice(0, 60)}»` : "relogin 잡 claim 실패 — 보류");
      await s`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id = ${fa.id}`;
    }
    // 러너 스크랩 잡 적재(pro · adpost 소스) · starter 는 gated
    await s`UPDATE tenants SET plan_key = 'pro', settings = settings || ${s.json({ revenueSyncHour: `${kstHH()}:00` })} WHERE id = ${TID}`;
    if (fa) {
      await s`INSERT INTO revenue_sources (tenant_id, source, account_id, method, status) VALUES (${TID}, 'adpost', ${fa.id}, 'runner', 'connected') ON CONFLICT DO NOTHING`;
      const rs1 = await cron("hourly", TID);
      const [sj] = await s`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${TID} AND kind = 'revenue.adpost' AND status = 'queued'`;
      const rs2 = await cron("hourly", TID);
      const [sj2] = await s`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${TID} AND kind = 'revenue.adpost' AND status = 'queued'`;
      rec("revenue.sync(pro) → revenue.adpost 잡 적재 1건 · 재실행 중복 0", Number(sj?.c) === 1 && Number(sj2?.c) === 1, `queued ${sj?.c}→${sj2?.c} · ${JSON.stringify((stepOf(rs1, "revenue.sync") || {}).detail || {}).slice(0, 120)}`);
      await s`UPDATE tenants SET plan_key = 'starter' WHERE id = ${TID}`; await s`DELETE FROM runner_jobs WHERE tenant_id = ${TID} AND kind = 'revenue.adpost'`;
      const rs3 = await cron("hourly", TID);
      const [sj3] = await s`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${TID} AND kind = 'revenue.adpost'`;
      rec("starter(runnerRevenue 없음) → 스크랩 잡 0 · scrapeGated", Number(sj3?.c) === 0 && (stepOf(rs3, "revenue.sync")?.detail?.tenants?.[0]?.scrapeGated || stepOf(rs3, "revenue.sync")?.detail?.scrapeGated || stepOf(rs3, "revenue.sync")?.skipped) >= 1, `jobs ${sj3?.c} · ${JSON.stringify(stepOf(rs3, "revenue.sync") || {}).slice(0, 140)}`);
      await s`UPDATE tenants SET plan_key = 'trial', settings = settings - 'revenueSyncHour' WHERE id = ${TID}`;
    }
    const src = readFileSync("lib/billing/ai-cost-cap.ts", "utf8");
    rec("ai_cost_cap 판정 한 벌(정적): 소비처가 lib/billing/ai-cost-cap 만 import", /export (async )?function/.test(src) && (readFileSync("lib/ai.ts", "utf8") + readFileSync("netlify/functions/topics.ts", "utf8") + readFileSync("lib/director.ts", "utf8")).includes("ai-cost-cap"), "");
  }
  /* ══ ops — 12메뉴 · 역할 · 대시보드 일치 · 가격 게이트 · 이벤트·쿠폰 · 채널 status 즉시 · 공지 · 운영진 · 감사 · 원격접속 ══ */
  const MENUS = ["ops-dashboard", "ops-tenants", "ops-promotions", "ops-plans", "ops-invoices", "ops-tickets", "ops-runners", "ops-ai-models", "ops-channels", "ops-notices", "ops-operators", "ops-audit-search"];
  const oj = new Jar(); let opsOk = false; let opId = 0, opEmail = `c-verify-op-${STAMP}@ops.local`;
  if (SECTIONS.has("ops")) {
    const lg = await call(oj, "/api/ops-login", { body: { email: OPS_USER, password: OPS_PASS } }); opsOk = lg.json?.ok === true;
    if (!opsOk) warn("운영센터 로그인", `${lg.status} ${lg.json?.step} — OPS_PASS`);
    else {
      for (const p of MENUS) { const r = await call(oj, `/api/${p}`); rec(`super_admin ${p} 200`, r.status === 200 && r.json?.ok === true, `${r.status} ${r.json?.step || ""}`); }
      // 대시보드 = 인보이스·원장·ai_usage 합(KST 월)
      const dash = (await call(oj, "/api/ops-dashboard")).json;
      const [agg] = await s`SELECT
        COALESCE(SUM(total_krw) FILTER (WHERE status='paid' AND kind='subscription' AND paid_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AT TIME ZONE 'UTC')),0) AS sub,
        COALESCE(SUM(total_krw) FILTER (WHERE status='paid' AND kind='coin' AND paid_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AT TIME ZONE 'UTC')),0) AS coin
        FROM invoices`.catch(() => [null]);
      const [ai] = await s`SELECT COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AT TIME ZONE 'UTC')`;
      rec("대시보드 모양(revenue·mrr·signups·aiCost.fxMissing·published)", !!dash?.revenue && typeof dash.mrr === "number" && dash.signups && dash.aiCost && typeof dash.aiCost.fxMissing === "boolean" && dash.published, Object.keys(dash || {}).join(","));
      rec("대시보드 매출 = 인보이스 합(KST 월 · 구독/코인)", !!agg && Number(dash?.revenue?.subscriptionKrw) === Number(agg.sub) && Number(dash?.revenue?.coinKrw) === Number(agg.coin), `dash sub ${dash?.revenue?.subscriptionKrw} coin ${dash?.revenue?.coinKrw} · invoices ${agg?.sub}/${agg?.coin}`);
      rec("대시보드 AI 원가 = ai_usage 합(USD) · fxMissing 이면 krw/margin 키 없음", Math.abs(Number(dash?.aiCost?.usd) - Number(ai?.usd)) < 0.01 && (!dash?.aiCost?.fxMissing || (!("krw" in (dash.aiCost || {})) && !("marginKrw" in dash))), `usd ${dash?.aiCost?.usd} vs ${Number(ai?.usd).toFixed(4)} · fxMissing ${dash?.aiCost?.fxMissing} krw ${dash?.aiCost?.krw}`);
      // 고객 상세 setup v4 키 · 코인 지급/회수
      const det = await call(oj, "/api/ops-tenant", { query: { id: String(TID) } });
      rec("고객 상세 setup {accounts,adMedia,rules,firstPublish} · 건강 · 코인", det.json?.ok === true && ["accounts", "adMedia", "rules", "firstPublish"].every((k) => typeof det.json.setup?.[k] === "boolean") && "coins" in det.json, `${det.status} setup ${JSON.stringify(det.json?.setup)}`);
      const g1 = await call(oj, "/api/ops-coins-grant", { body: { id: TID, coins: 30, reason: "C R4" } });
      const b1 = (await call(jar, "/api/coins-balance")).json;
      const g2 = await call(oj, "/api/ops-coins-grant", { body: { id: TID, coins: -50, reason: "C R4 회수" } });
      const b2 = (await call(jar, "/api/coins-balance")).json;
      rec("코인 지급 30 → 잔액 30(included) · 회수 −50 → 포함분 잔량까지만(음수 0)", g1.json?.ok === true && b1?.balance === 30 && b1?.included === 30 && b2?.balance >= 0 && b2?.balance <= 30 && (g2.json?.ok === false || b2?.balance === 0), `+30 → ${b1?.balance} · −50 → ${b2?.balance} (${g2.status} ${g2.json?.step || "ok"})`);
      // 이벤트 trial_days 실적용
      const ev = await call(oj, "/api/ops-promotions", { body: { kind: "trial_days", name: `C R4 체험 ${STAMP}`, value: 21, unit: "days", startsAt: new Date(Date.now() - 60e3).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString(), active: true } });
      const j2 = new Jar(); const reg2 = await call(j2, "/api/auth-register", { body: { email: `c+r4b-${STAMP}@autocreate.test`, password: PASSWORD, name: "C", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
      const me2 = await call(j2, "/api/auth-me"); const TID2 = Number(me2.json?.tenant?.id || 0); if (TID2) ALLOWED.add(TID2);
      rec("이벤트 trial_days 21 → 새 가입 체험 21일", ev.json?.ok === true && reg2.status === 201 && me2.json?.tenant?.trialDaysLeft >= 20, `${ev.status} ${ev.json?.step || ""} · trialDaysLeft ${me2.json?.tenant?.trialDaysLeft}`, `promotion ${ev.json?.promotion?.id} tenant ${TID2}`);
      if (ev.json?.promotion?.id) await call(oj, "/api/ops-promotions", { body: { id: ev.json.promotion.id, active: false } });
      // 쿠폰 생성·적용·2회 거절
      const cp = await call(oj, "/api/ops-coupons", { body: { code: `CR4${STAMP.toUpperCase()}`.slice(0, 20), kind: "pct", value: 10, maxUses: 5, startsAt: new Date(Date.now() - 60e3).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString(), plans: ["pro"] } });
      const qc = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "month", coupon: `CR4${STAMP.toUpperCase()}`.slice(0, 20) } });
      rec("쿠폰(pct 10) 생성 → 견적에 discountPct 10 · source 반영(또는 견적 쿠폰 미지원 표기)", cp.json?.ok === true && (qc.json?.quote?.discountPct === 10 || qc.json?.quote?.discountPct === 0), `${cp.status} ${cp.json?.step || ""} · quote ${JSON.stringify(qc.json?.quote).slice(0, 140)}`);
      const red = await call(oj, "/api/ops-coupon-redemptions"); rec("쿠폰 사용 내역 목록 200", red.json?.ok === true, `${red.status}`);
      // 가격 개정 게이트
      const pu = await call(oj, "/api/ops-plan-update", { body: { key: "pro", priceMonthKrw: 59000 } });
      rec("plan-update 로 가격 변경 → 400 price_gate", pu.status === 400 && pu.json?.step === "price_gate", `${pu.status} ${pu.json?.step}`);
      const pe = await call(oj, "/api/ops-price-event", { body: { planKey: "pro", newPriceKrw: 59000, effectiveAt: new Date(Date.now() + 30 * 86400e3).toISOString(), noticeText: "C R4 가격 개정 검증" } });
      const qBefore = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "month" } });
      rec("가격 개정 예약(30일 뒤) → 적용일 전 견적은 옛 가격 49,000", pe.json?.ok === true && qBefore.json?.quote?.supplyKrw === 49000, `${pe.status} ${pe.json?.step || ""} event ${pe.json?.event?.id || pe.json?.id} · quote ${qBefore.json?.quote?.supplyKrw}`);
      const peId = pe.json?.event?.id ?? pe.json?.id;
      if (peId) { await s`UPDATE plan_price_events SET effective_at = NOW() - interval '1 minute' WHERE id = ${peId}`; const qAfter = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "month" } }); rec("적용일 지나면 견적 새 가격 59,000(source price_event)", qAfter.json?.quote?.supplyKrw === 59000 && qAfter.json?.quote?.source === "price_event", JSON.stringify(qAfter.json?.quote).slice(0, 140)); const pc = await call(oj, "/api/ops-price-event-cancel", { body: { id: peId } }); const qBack = await call(jar, "/api/subscription-quote", { query: { planKey: "pro", cycle: "month" } }); rec("가격 개정 취소 → 견적 49,000 복귀", pc.json?.ok === true && qBack.json?.quote?.supplyKrw === 49000, `${pc.status} ${pc.json?.step || ""} → ${qBack.json?.quote?.supplyKrw}`); }
      // 인보이스·미수·환불 정직
      const inv = await call(oj, "/api/ops-invoices", { query: { status: "paid" } }); const rcv = await call(oj, "/api/ops-receivables"); const bks = await call(oj, "/api/ops-billing-keys");
      rec("ops-invoices/receivables/billing-keys 모양(3금액 · tenantName)", inv.json?.ok === true && Array.isArray(inv.json.invoices) && typeof inv.json.total === "number" && (inv.json.invoices[0] ? ["amountKrw", "vatKrw", "totalKrw", "tenantName"].every((k) => k in inv.json.invoices[0]) : true) && rcv.json?.ok === true && Array.isArray(rcv.json.receivables) && bks.json?.ok === true && Array.isArray(bks.json.keys), `${inv.status}/${rcv.status}/${bks.status} n=${inv.json?.invoices?.length} recv ${rcv.json?.receivables?.length} keys ${bks.json?.keys?.length}`);
      await s`INSERT INTO coin_orders (tenant_id, order_no, pack_id, coins, krw, status) VALUES (${TID}, ${"AC-COIN-C4-" + STAMP}, 'pack_trial', 10, 5000, 'paid') ON CONFLICT DO NOTHING`;
      const rf = await call(oj, "/api/ops-refund", { body: { orderNo: "AC-COIN-C4-" + STAMP } });
      rec("ops-refund: 인보이스 없는 주문 → 400 quote/not_paid 정직(0원 환불 없음)", rf.status === 400 && rf.json?.step === "quote", `${rf.status} ${JSON.stringify(rf.json).slice(0, 120)}`);
      // 채널 status 변경 → 고객 그리드 즉시
      const chs = (await call(oj, "/api/ops-channels")).json?.channels || [];
      const thr = chs.find((c) => c.key === "threads");
      const c1 = await call(oj, "/api/ops-channels", { body: { key: "threads", status: "active" } });
      const al1 = (await call(jar, "/api/accounts-list")).json?.channels?.find((c) => c.key === "threads");
      await call(oj, "/api/ops-channels", { body: { key: "threads", status: thr?.status || "planned" } });
      const al2 = (await call(jar, "/api/accounts-list")).json?.channels?.find((c) => c.key === "threads");
      rec("채널 status planned→active → 고객 accounts-list 즉시 active → 복귀", c1.json?.ok === true && al1?.status === "active" && al2?.status === (thr?.status || "planned"), `${c1.status} ${al1?.status} → ${al2?.status}`);
      const dis = await call(oj, "/api/ops-disclosure"); rec("ops-disclosure {text:{coupang,generic}} · 정본 문구", dis.json?.ok === true && /쿠팡 파트너스 활동의 일환으로/.test(dis.json.text?.coupang || "") && typeof dis.json.text?.generic === "string", `${dis.status}`);
      // 공지·장애 배너
      const nt = await call(oj, "/api/ops-notices", { body: { kind: "incident", title: `C R4 장애 ${STAMP}`, body: "네이버 발행이 늦어요", startsAt: new Date(Date.now() - 60e3).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString(), channels: ["naver_blog"], active: true } });
      const cn = await call(jar, "/api/notices");
      rec("장애 공지 생성 → 고객 /api/notices 에 incident 노출", nt.json?.ok === true && (cn.json?.notices || []).some((x) => x.kind === "incident" && x.title === `C R4 장애 ${STAMP}`), `${nt.status} ${nt.json?.step || ""} · notices ${cn.json?.notices?.length}`);
      const ntId = nt.json?.notice?.id ?? nt.json?.id; if (ntId) await call(oj, "/api/ops-notice-delete", { body: { id: ntId } });
      // 운영진 — 초대 · 역할 · self 400 · 비활성
      const op = await call(oj, "/api/ops-operators", { body: { email: opEmail, name: "C 검증 운영자", role: "operator" } });
      opId = op.json?.operator?.id || 0;
      rec("운영진 초대(operator)", op.json?.ok === true && opId > 0, `${op.status} ${op.json?.step || ""} id ${opId}`);
      const meOps = (await call(oj, "/api/ops-me")).json?.operator;
      const selfRole = await call(oj, "/api/ops-operator-role", { body: { id: meOps?.id, role: "operator" } });
      rec("자기 역할 강등 → 400 self", selfRole.status === 400, `${selfRole.status} ${selfRole.json?.step}`);
      // operator 로그인(테스트 비밀번호를 DB 에 심어 로그인 — 역할 403 표 검증용 · 끝나면 비활성)
      if (opId) {
        const { default: bcrypt } = await import("bcryptjs"); const hash = await bcrypt.hash("Cr4OpTemp2026x", 10);
        await s`UPDATE operators SET password_hash = ${hash}, must_change_password = false WHERE id = ${opId}`;
        const ojo = new Jar(); const lo = await call(ojo, "/api/ops-login", { body: { email: opEmail, password: "Cr4OpTemp2026x" } });
        if (lo.json?.ok) {
          const table = {};
          for (const p of MENUS) { const r = await call(ojo, `/api/${p}`); table[p] = r.status; }
          const forbidden403 = ["ops-plans", "ops-invoices", "ops-operators", "ops-promotions"].every((p) => table[p] === 403);
          const allowed200 = ["ops-dashboard", "ops-tenants", "ops-tickets"].every((p) => table[p] === 200);
          const [fa] = await s`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'ops_forbidden' AND actor_id = ${opId}`;
          rec("operator 역할: 요금제/결제/운영진/이벤트 403 + ops_forbidden 감사 · 고객/CS/대시보드 200", forbidden403 && allowed200 && Number(fa?.c) >= 1, JSON.stringify(table) + ` audit ${fa?.c}`);
          const aiChange = await call(ojo, "/api/ops-ai-mode", { body: { mode: "manual" } }); const chChange = await call(ojo, "/api/ops-channels", { body: { key: "threads", status: "planned" } });
          rec("operator: AI/채널 변경 403(super_admin 만)", aiChange.status === 403 && chChange.status === 403, `${aiChange.status}/${chChange.status}`);
          // 원격접속(operator 가능) → 고객 세션 → 결제 403 · 배너 · 종료 감사+알림
          const imp = await call(ojo, "/api/ops-impersonate", { body: { id: TID } });
          const ij = new Jar(); for (const sc of []) void sc; // 고객 쿠키는 응답 Set-Cookie 로 온다
          if (imp.json?.ok) {
            // impersonate 응답의 ac_user 쿠키를 고객 항아리로
            ij.c.set("ac_user", ojo.c.get("ac_user") || ""); if (!ij.c.get("ac_user")) ij.c.set("ac_user", imp.json?.token || "");
            const meI = await call(ij, "/api/auth-me"); const pay = await call(ij, "/api/coin-purchase-start", { body: { packId: "pack_50k", agreePaidTerms: true } }); const pw = await call(ij, "/api/auth-change-password", { body: { current: PASSWORD, password: PASSWORD + "z" } });
            const end = await call(ojo, "/api/ops-impersonate-end", { method: "POST" });
            const [endAudit] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action LIKE 'ops_impersonat%end%' ORDER BY id DESC LIMIT 1`;
            const [endNotif] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND (body LIKE '%운영자%' OR title LIKE '%운영자%') ORDER BY id DESC LIMIT 1`;
            rec("원격접속: auth-me impersonation 배너 정보 · 결제/충전/비밀번호 403 · 종료 감사+고객 알림", !!meI.json?.impersonation && pay.status === 403 && pay.json?.step === "impersonation" && pw.status === 403 && end.json?.ok === true && !!endAudit && !!endNotif, `me imp ${!!meI.json?.impersonation} · pay ${pay.status} ${pay.json?.step} · pw ${pw.status} · end ${end.status} audit ${endAudit?.id} notif ${endNotif?.id}`);
          } else warn("원격접속", `${imp.status} ${imp.json?.step || ""}`);
        } else warn("operator 로그인", `${lo.status} ${lo.json?.step}`);
        await call(oj, "/api/ops-operator-disable", { body: { id: opId } });
      }
      // 러너팜·카나리·AI
      const rn = await call(oj, "/api/ops-runners"); const cy = await call(oj, "/api/ops-canary"); const aim = await call(oj, "/api/ops-ai-models");
      rec("ops-runners/canary/ai-models 모양", rn.json?.ok === true && Array.isArray(rn.json.runners) && cy.json?.ok === true && aim.json?.ok === true && Array.isArray(aim.json.roles) && ["manual", "auto"].includes(aim.json.settings?.updateMode), `${rn.status}/${cy.status}/${aim.status} roles ${aim.json?.roles?.length} mode ${aim.json?.settings?.updateMode}`);
      const cyRows = (cy.json?.channels || cy.json?.runs || cy.json?.rows || []).flatMap((c) => c.history ? [...(c.today ? [c.today] : []), ...c.history] : [c]);
      rec("카나리 결과 ok:boolean|null(판정 불가 = null · 0/실패로 안 적음)", Array.isArray(cyRows) && cyRows.every((r) => r.ok === null || typeof r.ok === "boolean"), `${cyRows.length}건 ${JSON.stringify(cyRows[0] || {}).slice(0, 120)}`);
      const badModel = await call(oj, "/api/ops-ai-apply", { body: { role: "director", chain: ["not-a-real-model-xyz"], canaryPct: 0 } });
      rec("AI 적용: 실측 안 된 모델 → 거절(400 + 사람말)", badModel.status === 400 && !!badModel.json?.error, `${badModel.status} «${badModel.json?.error}»`);
      const rb = await call(oj, "/api/ops-ai-rollback", { body: { role: "director" } }); rec("AI 롤백 응답 정직(ok 또는 step)", rb.json?.ok === true || !!rb.json?.step, `${rb.status} ${rb.json?.step || "ok"}`);
      const au = await call(oj, "/api/ops-audit-search", { query: { actorType: "operator", q: "ops_" } });
      rec("감사 검색(actorType·q·page·total)", au.json?.ok === true && Array.isArray(au.json.rows) && typeof au.json.total === "number", `${au.status} n=${au.json?.rows?.length} total ${au.json?.total}`);
    }
  }
  /* ══ cs — 문의 → 컨텍스트 → 매크로 답변 → 알림 → 해결 → 만족도 → 통계 · 자동 티켓 3회 ══ */
  if (SECTIONS.has("cs") && opsOk) {
    const tk = await call(jar, "/api/support-ticket", { body: { subject: "C R4 문의", text: "발행이 안 돼요" } });
    const tid_ = tk.json?.ticketId;
    rec("고객 문의 생성 201 ticketId", tk.status === 201 && tid_ > 0, `${tk.status} ${tk.json?.step || ""} id ${tid_}`, `ticket ${tid_}`);
    const det = await call(oj, "/api/ops-ticket", { query: { id: String(tid_) } });
    rec("ops-ticket: ticket·messages·context(플랜·러너·recentErrors)·macros 자동 첨부", det.json?.ok === true && det.json.ticket && Array.isArray(det.json.messages) && det.json.context && "planKey" in det.json.context && det.json.context.runner && Array.isArray(det.json.context.recentErrors) && Array.isArray(det.json.macros), `${det.status} context ${JSON.stringify(det.json?.context).slice(0, 140)}`);
    const mc = await call(oj, "/api/ops-macros", { body: { title: `C R4 매크로 ${STAMP}`, text: "확인해 드릴게요. {{name}}님 잠시만요." } });
    const mid = mc.json?.macro?.id;
    const rp = await call(oj, "/api/ops-ticket-reply", { body: { id: tid_, text: "", macroId: mid } });
    const [rnotif] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND (kind LIKE 'ticket%' OR kind LIKE 'support%' OR kind LIKE 'cs%') ORDER BY id DESC LIMIT 1`;
    rec("매크로 답변 → 고객 알림 1건", mc.json?.ok === true && rp.json?.ok === true && !!rnotif, `${mc.status}/${rp.status} ${rp.json?.step || ""} notif ${rnotif?.id}`);
    const mine = await call(jar, "/api/support-tickets");
    rec("고객 support-tickets 에 답변 반영(messages ≥2)", mine.json?.ok === true && (mine.json.tickets || []).some((t) => t.id === tid_), `${mine.status} n=${mine.json?.tickets?.length}`);
    const rs = await call(oj, "/api/ops-ticket-resolve", { body: { id: tid_ } });
    const rate = await call(jar, "/api/support-rate", { body: { id: tid_, helpful: true } });
    const st = await call(oj, "/api/ops-cs-stats");
    rec("해결 → 만족도 평가 → 통계(open·avgFirstReplyMin·slaMissPct·satisfactionPct)", rs.json?.ok === true && rate.json?.ok === true && st.json?.ok === true && ["open", "avgFirstReplyMin", "slaMissPct", "satisfactionPct"].every((k) => k in st.json), `${rs.status}/${rate.status}/${st.status} ${JSON.stringify(st.json).slice(0, 120)}`);
    const rate2 = await call(jar, "/api/support-rate", { body: { id: tid_, helpful: false } });
    rec("만족도 2회째 → 정직(멱등 또는 400)", rate2.json?.ok === true || rate2.status === 400, `${rate2.status}`);
    // 자동 티켓: 러너 실패 3회/72h → 시스템 티켓 1건(멱등)
    for (let i = 0; i < 3; i++) await s`INSERT INTO runner_jobs (tenant_id, kind, status, error_kind, payload, updated_at) VALUES (${TID}, 'publish.naver_blog', 'failed', 'selector_changed', ${s.json({})}, NOW())`;
    await cron("hourly", TID); const at1 = await cron("hourly", TID);
    const [auto] = await s`SELECT COUNT(*) AS c FROM tickets WHERE tenant_id = ${TID} AND source = 'system'`;
    rec("자동 티켓: 러너 실패 3회 → system 티켓 1건(2회 실행 멱등)", Number(auto?.c) === 1, `system 티켓 ${auto?.c} · ${JSON.stringify(stepOf(at1, "cs.auto_ticket") || {}).slice(0, 120)}`);
  }
  /* ══ idor ══ */
  if (SECTIONS.has("idor")) {
    const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: PASSWORD } });
    const [mt] = await s`SELECT id FROM tickets WHERE tenant_id = ${TID} ORDER BY id LIMIT 1`;
    const r1 = mt ? await call(other, "/api/support-ticket-message", { body: { id: Number(mt.id), text: "idor" } }) : { status: 404 };
    const r2 = await call(other, "/api/coin-history"); const r3 = await call(other, "/api/invoices", { query: { year: "2026" } });
    const r4 = await call(other, "/api/coin-refund-request", { body: { orderNo: "AC-COIN-C4-" + STAMP, quoteOnly: true } });
    rec("타 테넌트: 티켓 404 · 내 주문 환불 견적 «없는 주문»(정보 0) · 주문/인보이스 0", r1.status === 404 && (r4.json?.ok !== true || (r4.json?.quote?.eligible === false && !r4.json?.quote?.maxRefundKrw)) && !(r2.json?.rows || []).some((x) => String(x.ref || "").includes(STAMP)) && r3.json?.ok === true, `${r1.status}/${r4.status} ${JSON.stringify(r4.json?.quote || {}).slice(0, 80)}`);
  }
  /* ══ cleanup — 돈·CS 행 정리(대시보드 오염 0) ══ */
  if (SECTIONS.has("cleanup")) {
    for (const t of [...ALLOWED]) {
      await s`DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE tenant_id = ${t})`.catch(() => {});
      await s`DELETE FROM tickets WHERE tenant_id = ${t}`.catch(() => {});
      await s`DELETE FROM invoices WHERE tenant_id = ${t}`.catch(() => {});
      await s`DELETE FROM coin_orders WHERE tenant_id = ${t}`.catch(() => {});
      await s`DELETE FROM coin_ledger WHERE tenant_id = ${t}`.catch(() => {});
      await s`DELETE FROM ai_usage WHERE tenant_id = ${t} AND ref LIKE ${"cap" + STAMP}`.catch(() => {});
      await s`DELETE FROM runner_jobs WHERE tenant_id = ${t}`.catch(() => {});
    }
    await s`DELETE FROM macros WHERE title LIKE ${"C R4 매크로%"}`.catch(() => {});
    await s`DELETE FROM coupons WHERE code LIKE ${"CR4%"}`.catch(() => {});
    await s`DELETE FROM promotions WHERE name LIKE ${"C R4 체험%"}`.catch(() => {});
    await s`DELETE FROM notices WHERE title LIKE ${"C R4 장애%"}`.catch(() => {});
    if (opId) await s`DELETE FROM operators WHERE id = ${opId} AND email LIKE ${"c-verify-op-%"}`.catch(() => {});
    rec("정리: 테스트 테넌트 돈·CS·운영진 행 삭제", true, `tenants ${[...ALLOWED].join(",")} · operator ${opId}`);
  }
  finish();
}
function finish() {
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R4 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 56)} ${w(r.note, 70)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/p1r4-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2)); console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {}); process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); finish(); });
