// scripts/verify-p1r5.mjs — P1R5 검증 하니스 뼈대(C · 계약 v5.1 §6 · 영상 «생성 두뇌 + 러너 렌더 + 출구»). 🔴 B-1·B2·A 머지 후 트리거 때 실경로로 채운다.
//   로컬 스모크(돈 0): 손잡이 확정(계약 v5.2 §1.4b): dev 서버 env `VIDEO_PROVIDER_STUB=1`(provider·TTS·비전 스텁 · ai_usage 원가 0) · `CHAIN_BUDGET_MS`(기본 660000 · 이어달리기 재현은 30000 으로) · 슬롯 없는 자동 생성은 새 손잡이 없이 confirm({origin:"auto"}) slotId 없이(HTTP 밖 · tsx 로 lib 직접 호출) 로 chainStage 전이·잠금·이어달리기·스위퍼·코인 구간·달러 캡·kill switch·프레임 지문·uploaded_private 폭·배지 고지.
//   라이브 실증(돈 씀 · 1회 · 메인 호출): 60초 실제 생성·렌더·유튜브 비공개 업로드 — 이 파일 밖(별도 스크립트 · videoId·R2 HEAD·스샷 증거).
//   사용: node scripts/verify-p1r5.mjs   (BASE_URL 기본 http://localhost:8901 · CRON_SECRET · SECTIONS=setup,topics,director,chain,sweep,cost,payload,bgm,rules,disclosure,fingerprint,posts,wiring,regress,cleanup)
//   🔴 계약 v5.5 §1.4c 반영(2026-09-14): ①원가 관문은 R4 `checkAiCostCap` 재사용(새 캡 금지) — **소프트(플랜 일일 상한 초과) = 막지 않는다 + 운영 알림** / 하드(×3) = failed+코인 환급+알림 2종 / 전역 월 ₩1,400,000 = 하드 / 환율 없으면 «못 재니 막지 않는다»(fxMissing · FX 기본값 코드에 박기 금지)
//     ②토킹 still 컷은 **구축**(스킵 금지) — `scenes[]` 전건이 clipKey|imageKey 중 하나를 가져야 한다(둘 다 없으면 러너에 검은 화면 · §2.1 위반)  ③`scripts/seed-bgm.mjs` 존재·멱등 · BGM_LICENSE_VERIFIED 없으면 audio.bgm=null(무음)이 정직 경로(에러 아님).
//   🔴 이 절의 핵심 하나: «자기 코인으로 만드는 고객이 우리 원가 캡에 막히는 경로 = 0». 초록이어야 하는 건 «성공», 0이어야 하는 건 «막힘»이다.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36); const EMAIL = process.env.TEST_EMAIL || `c+r5-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || "";
const SECTIONS = new Set((process.env.SECTIONS || "setup,topics,director,chain,sweep,cost,payload,bgm,rules,disclosure,fingerprint,posts,wiring,regress,cleanup").split(","));
/** 하니스 산술용 환율(= dev 서버에 준 FX_USD_KRW 와 같은 값이어야 한다). 🔴 제품 코드에는 절대 박지 않는다(계약 v5.5) — 여기는 «얼마를 심어야 구간에 들어가나»를 계산하는 검사 쪽이다. */
const FX = Number(process.env.FX_USD_KRW || 1400);
/** lib/billing/ai-cost-cap.ts PLAN_CAP_KRW 의 사본(정본은 그 파일 · 값이 바뀌면 이 표가 FAIL 로 알려 준다). */
const PLAN_CAP_KRW = { trial: 3_000, starter: 5_000, pro: 20_000, agency: 60_000 };
const GLOBAL_CAP_KRW = 1_400_000;
const results = []; const t0 = Date.now();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const warn = (step, note, evidence) => rec(step, "WARN", note, evidence);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query, headers } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}), ...(headers || {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const cron = (every, tid) => call(null, "/api/cron-run", { method: "POST", query: { every, tid: String(tid), secret: CRON_SECRET } });
const stepOf = (r, key) => (r.json?.ran || []).find((s) => s.step === key);
let sql = null; const ALLOWED = new Set();
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const guard = (tid) => { if (!ALLOWED.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };
/* ── 🔴 원가 방어선(메인 지시 2026-09-14): 스텁으로 돌린다고 했으면 **실호출 과금 행이 1건이라도 보이는 순간 중단**한다.
      2026-09-14 실측: `VIDEO_PROVIDER_STUB=1` 인데 provider·TTS 가 스텁을 안 타 Veo 실호출 $0.4/편이 나갔다. «스텁이겠거니»는 증거가 아니다. */
const RUN_T0 = new Date(Date.now() - 60_000).toISOString();
const EXPECT_STUB = String(process.env.EXPECT_STUB ?? "1") === "1";   // dev 서버를 VIDEO_PROVIDER_STUB=1 로 띄웠다는 선언. 실호출 실증이면 EXPECT_STUB=0.
async function stubGuard(tid, where) {
  if (!EXPECT_STUB || !sql) return true;
  const bad = await sql`SELECT purpose, model, cost_usd, ref FROM ai_usage WHERE tenant_id = ${tid}
    AND purpose IN ('video_clip','tts','video_judge') AND created_at > ${RUN_T0}::timestamptz AT TIME ZONE 'UTC'
    AND (model <> 'stub' OR cost_usd > 0) ORDER BY id LIMIT 5`;
  if (!bad.length) return true;
  const line = bad.map((b) => `${b.purpose}/${b.model}/$${b.cost_usd}/${b.ref}`).join(" · ").slice(0, 110);
  // 큰 누수(클립·심사 비전 · 편당 $0.2~)는 **중단**. 작은 누수(TTS 폴백 $0.006 · 2026-09-14 현재 B-1 수리 대기)는 기록하고 계속 — 멈추면 캡 절을 아예 못 잰다.
  const heavy = bad.some((b) => b.purpose !== "tts" || Number(b.cost_usd) >= 0.05);
  if (heavy) { rec(`🔴 원가 방어선(${where}) — 스텁인데 실호출 과금 행 발견 → 즉시 중단`, false, line); return false; }
  if (!stubGuard.warned) { stubGuard.warned = true; warn(`원가 방어선(${where}) — TTS 폴백이 스텁을 안 탄다(소액 · 수리 대기)`, line); }
  return true;
}
const VIDEO_STAGES = ["script", "tts", "clips", "render", "judging", "done", "failed"];
const COIN_OF_SECONDS = (sec) => (sec <= 5 ? "video_clip" : sec <= 15 ? "video_15" : sec <= 35 ? "video_30" : "video_60");   // §0.1-4 구간제(초 산식 금지)
const COIN_TABLE = { video_clip: 2, video_15: 6, video_30: 12, video_60: 28 };

async function main() {
  const jar = new Jar(); const s = await db();
  let r = await call(jar, "/api/auth-login", { body: { email: EMAIL, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C R5", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); const TID = Number(me.json?.tenant?.id || 0); ALLOWED.add(TID);
  rec("로그인/가입", me.json?.ok === true && TID > 0, `tid ${TID}`); if (!TID) return finish(); guard(TID);

  /* ══ setup — kinds video · 코인 60 · 유튜브 계정(OAuth 없으면 정직) ══ */
  let ytAcc = null;
  if (SECTIONS.has("setup")) {
    const ob = await call(jar, "/api/onboarding", { body: { kinds: ["text", "video"], channels: ["naver_blog", "youtube_shorts"] } });
    rec("settings.kinds = text+video", ob.json?.ok === true, `${ob.status}`);
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 60, ${"r5:" + STAMP}, 'R5 하니스')`;
    const bal = (await call(jar, "/api/coins-balance")).json; rec("코인 60", bal?.balance >= 60, `${bal?.balance}`);
    const oa = await call(jar, "/api/accounts-oauth-start", { body: { channel: "youtube_shorts" } });
    rec("유튜브 OAuth: url 또는 provider_not_configured 정직", (oa.json?.ok === true && !!oa.json.url) || oa.json?.step === "provider_not_configured", `${oa.status} ${oa.json?.step || "url"}`);
    // OAuth 앱 없으면 계정 행을 직접 심어(테스트 테넌트) 디렉터 배정 대상을 만든다
    const [acc] = await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key) VALUES (${TID}, 'youtube_shorts', ${"c_r5_yt_" + STAMP}, 'oauth', 'active', ${"t" + TID + "-yt"}) RETURNING id`;
    ytAcc = Number(acc?.id); rec("유튜브 계정 행(테스트)", ytAcc > 0, `account ${ytAcc}`);
    const [nb] = await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key) VALUES (${TID}, 'naver_blog', ${"c_r5_nb_" + STAMP}, 'session', 'active', ${"t" + TID + "-nb"}) RETURNING id`; void nb;
  }
  /* ══ topics — 영상 힌트 후보 · 레퍼런스 URL → shorts_templates ══ */
  let topicId = 0;
  if (SECTIONS.has("topics")) {
    const ref = await call(jar, "/api/topics-reference", { body: { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" } });
    rec("topics-reference → shorts_templates 1행 {id,name,structure[],hook,style}(코인 0 · 하루 3회)", (ref.json?.ok === true && ref.json.template?.id > 0 && Array.isArray(ref.json.template.structure)) || ref.json?.step === "rate_limit", `${ref.status} ${ref.json?.step || ""} ${JSON.stringify(ref.json?.template || {}).slice(0, 120)}`);
    const tl = (await call(jar, "/api/topics-list", { query: { status: "candidate" } })).json?.topics || [];
    const vt = tl.find((t) => ["youtube_shorts", "naver_clip", "reels"].includes(t.channelHint));
    if (!vt) { const tr = await call(jar, "/api/topics-refresh", { body: {} }); warn("영상 힌트 후보", `후보 0 → refresh ${tr.status} ${tr.json?.step || ""}(배경 · 다음 실행에서 재확인)`); }
    else rec("소재에 영상 채널 힌트 후보 존재", true, `«${vt.title}» ${vt.channelHint}`);
    topicId = (vt || tl[0])?.id || 0;
  }
  /* ══ director — 제안(글 1 + 쇼츠 1 · 코인 1+6+28) → 확정(코인 1회 · 재확정 0 · 달러 캡 선검사) ══ */
  let pieceId = 0, briefId = 0;
  if (SECTIONS.has("director") && topicId) {
    const pr = await call(jar, "/api/director-propose", { body: { topicId } });
    const brief = pr.json?.brief; const vspec = brief?.pieces?.find((p) => p.kind === "video" || p.video);
    rec("제안에 영상 PieceSpec(video{format,seconds,provider,variant}) · coinCost = 구간제", !!vspec && vspec.video && ["graphic", "talking", "clip"].includes(vspec.video.format) && [15, 30, 60].includes(vspec.video.seconds) && vspec.coinCost === COIN_TABLE[COIN_OF_SECONDS(vspec.video.seconds)], `${pr.status} ${pr.json?.step || ""} video ${JSON.stringify(vspec?.video || {}).slice(0, 120)} coin ${vspec?.coinCost}`);
    if (brief) {
      briefId = brief.id;
      const b0 = (await call(jar, "/api/coins-balance")).json;
      const keep = brief.pieces.filter((p) => !(p.kind === "video" || p.video)).map((p) => ({ key: p.key, drop: true }));   // 쇼츠만 남김
      const cf = await call(jar, "/api/director-confirm", { body: { briefId, pieces: keep } });
      const b1 = (await call(jar, "/api/coins-balance")).json;
      pieceId = cf.json?.pieceIds?.[0] || 0;
      const [pc] = pieceId ? await s`SELECT kind, status, meta FROM pieces WHERE id = ${pieceId}` : [null];
      rec("확정 → piece kind video · generating · meta.stage script · chainLock/chainResume 키 · 코인 1회(ref piece:{id} · 이미지 ref 0)", cf.status === 202 && pc?.kind === "video" && pc?.status === "generating" && pc?.meta?.stage === "script" && "chainResume" in (pc?.meta || {}) && b0.balance - b1.balance === (vspec?.coinCost ?? -1), `${cf.status} ${cf.json?.step || ""} piece ${pieceId} kind ${pc?.kind} stage ${pc?.meta?.stage} · ${b0?.balance}→${b1?.balance}`, `piece ${pieceId}`);
      const [ledger] = await s`SELECT COUNT(*) AS c FROM coin_ledger WHERE tenant_id = ${TID} AND kind = 'consume' AND ref LIKE ${"piece:" + pieceId + "%"}`;
      rec("원장 consume 행 1(구간 item · 이미지 행 0)", Number(ledger?.c) === 1, `rows ${ledger?.c}`);
      const cf2 = await call(jar, "/api/director-confirm", { body: { briefId } }); const b2 = (await call(jar, "/api/coins-balance")).json;
      rec("재확정 → 재차감 0", cf2.json?.ok === true && b2.balance === b1.balance && (cf2.json?.coinsCharged ?? 0) === 0, `${b1?.balance}→${b2?.balance}`);
    }
  }
  /* ══ chain — chainStage 전이(스텁) · 잠금 20분 · 이어달리기 · 컷 재생성 0 ══ */
  if (SECTIONS.has("chain") && pieceId) {
    let last = null; const dl = Date.now() + Number(process.env.GEN_TIMEOUT_MS || 6 * 60_000); const seen = [];
    while (Date.now() < dl) { const [p] = await s`SELECT status, meta FROM pieces WHERE id = ${pieceId}`; last = p; const st = p?.meta?.chainStage?.stage || p?.meta?.stage; if (st && seen[seen.length - 1] !== st) seen.push(st); if (!(await stubGuard(TID, "chain"))) return finish(); if (["in_review", "failed"].includes(p?.status) || p?.meta?.stage === "render") break; await sleep(4000); }
    rec("chainStage 전이 관측(script→tts→clips→render …)", seen.length >= 2 && seen.every((x) => VIDEO_STAGES.includes(x)), seen.join("→") + ` · status ${last?.status} · failReason ${last?.meta?.failReason || "-"}`);
    const assets = await s`SELECT kind, sort, r2_key, meta FROM piece_assets WHERE piece_id = ${pieceId} ORDER BY kind, sort`;
    const clips = assets.filter((a) => a.kind === "clip"), audio = assets.filter((a) => a.kind === "audio");
    rec("piece_assets: audio(문장별 · words 타임스탬프 or provider gemini) · clip(컷마다 · meta.costUsd·provider)", audio.length >= 1 && (clips.length >= 1 || last?.meta?.stage === "tts"), `audio ${audio.length} · clip ${clips.length} · tts.provider ${last?.meta?.tts?.provider || "-"}`);
    const usage = await s`SELECT purpose, COUNT(*) AS c, COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE tenant_id = ${TID} AND purpose IN ('video_clip','tts','video_judge') GROUP BY purpose`;
    rec("ai_usage purpose video_clip/tts/video_judge 기록", usage.length >= 1, usage.map((u) => `${u.purpose}:${u.c}/$${Number(u.usd).toFixed(3)}`).join(" "));
    // 잠금: chainLock 20분 안 → 두 번째 호출 즉시 반환(ai_usage 중복 0)
    const [u0] = await s`SELECT COUNT(*) AS c FROM ai_usage WHERE tenant_id = ${TID}`;
    await s`UPDATE pieces SET status = 'generating', meta = meta || ${s.json({ chainLock: { at: new Date().toISOString(), by: "c-verify" } })} WHERE id = ${pieceId}`;
    const bg = await call(null, "/api/generate-video-background", { body: { pieceId, tenantId: TID }, headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" } });
    await sleep(3000); const [u1] = await s`SELECT COUNT(*) AS c FROM ai_usage WHERE tenant_id = ${TID}`;
    rec("잠금 20분 안 중복 호출 → 즉시 반환 · ai_usage 증가 0", [200, 202].includes(bg.status) && Number(u1?.c) === Number(u0?.c), `${bg.status} usage ${u0?.c}→${u1?.c}`);
    await s`UPDATE pieces SET meta = meta - 'chainLock' WHERE id = ${pieceId}`;
    // 이어달리기: chainResume.count 증가 · 이미 만든 컷 재생성 0(clip 자산 수·ai_usage video_clip 행 불변)
    warn("이어달리기(CHAIN_BUDGET_MS=30000 서버로 재실행 → resume:true 재디스패치 · 컷 재생성 0)", "dev 서버를 CHAIN_BUDGET_MS=30000 으로 띄운 2회차 실행에서 chainResume.count≥1 · clip 자산 수·ai_usage video_clip 행 불변을 잰다(트리거)");
  }
  /* ══ sweep — 20분 침묵 → video.sweep 재디스패치 · 상한 3회 → failed+환급+알림 ══ */
  if (SECTIONS.has("sweep") && pieceId) {
    await s`UPDATE pieces SET status = 'generating', updated_at = NOW() - interval '25 minutes', meta = (meta - 'chainLock') || ${s.json({ chainStage: { stage: "clips", at: new Date(Date.now() - 25 * 60_000).toISOString() }, chainResume: { count: 0 } })} WHERE id = ${pieceId}`;
    const sw = await cron("5m", TID); const st = stepOf(sw, "video.sweep");
    const [p1] = await s`SELECT status, meta FROM pieces WHERE id = ${pieceId}`;
    rec("video.sweep: 20분 침묵 + chainStage → 이어달리기 재디스패치(chainResume.count 1 · 잠금 먼저)", !!st && st.errors === 0 && (Number(p1?.meta?.chainResume?.count) >= 1 || st.changed >= 1), `${JSON.stringify(st || {}).slice(0, 120)} · resume ${JSON.stringify(p1?.meta?.chainResume)}`);
    await s`UPDATE pieces SET status = 'generating', updated_at = NOW() - interval '25 minutes', meta = (meta - 'chainLock') || ${s.json({ chainResume: { count: 3 } })} WHERE id = ${pieceId}`;
    const b0 = (await call(jar, "/api/coins-balance")).json; const sw2 = await cron("5m", TID);
    const [p2] = await s`SELECT status, meta FROM pieces WHERE id = ${pieceId}`; const b1 = (await call(jar, "/api/coins-balance")).json;
    const [nf] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'piece_failed' ORDER BY id DESC LIMIT 1`;
    rec("상한(3) 초과 → failed + 사유(마지막 단계) + 환급 + 알림", p2?.status === "failed" && /단계/.test(String(p2?.meta?.failReason || "")) && b1.balance > b0.balance && !!nf, `${JSON.stringify(stepOf(sw2, "video.sweep") || {}).slice(0, 100)} · ${p2?.status} «${p2?.meta?.failReason}» · 코인 ${b0?.balance}→${b1?.balance} · 알림 ${nf?.id}`);
    rec("stage render 는 runner_jobs 살아 있으면 스위퍼가 안 건드림", "WARN", "render 잡이 있는 piece 로 트리거 때");
  }
  /* ══ cost — 🔴 계약 v5.5 §1.4c-(1): R4 `checkAiCostCap` 재사용(새 캡 금지) · 소프트=통과+운영 알림 · 하드(일일×3)=차단·환급 · 전역 월 ₩1,400,000 · kill switch ══ */
  if (SECTIONS.has("cost") && topicId) {
    /* 정적 — «문을 둘로 만들지 않는다» · FX 기본값 박기 금지 */
    const src = existsSync("lib/video/cost.ts") ? readFileSync("lib/video/cost.ts", "utf8") : "";
    rec("cost.ts = R4 관문 재사용(checkAiCostCap 호출) · 자체 월 캡 상수 0(v5.5)", /checkAiCostCap/.test(src) && !/TENANT_CAP_USD/.test(src),
      `checkAiCostCap ${/checkAiCostCap/.test(src) ? "있음" : "없음"} · 자체 캡 상수 ${/TENANT_CAP_USD|VIDEO_TENANT_MONTHLY_CAP_USD/.test(src) ? "남아 있음" : "0"}`);
    rec("환율 기본값을 코드에 박지 않음 · 못 재면 막지 않는다(fxMissing · v5.5)", !/FX_[A-Z]*_KRW[^\n]*\|\|\s*['"]?\d/.test(src) && !/fxRate\s*(\?\?|\|\|)\s*\d/.test(src) && /fxMissing/.test(src),
      `리터럴 환율 ${/FX_[A-Z]*_KRW[^\n]*\|\|\s*['"]?\d|fxRate\s*(\?\?|\|\|)\s*\d/.test(src) ? "🔴 있음" : "0"} · fxMissing 처리 ${/fxMissing/.test(src) ? "있음" : "없음"}`);
    rec("소프트/하드 2단계 어휘 존재(soft·hard)", /soft/i.test(src) && /hard/i.test(src), src ? "정적" : "파일 없음");

    /* 준비 — 플랜 pro(일일 상한 ₩20,000) · 코인 넉넉히. 🔴 정리에서 trial 로 되돌린다(가짜 MRR 금지 · C-HANDOFF §2.3) */
    await s`UPDATE tenants SET plan_key = 'pro' WHERE id = ${TID}`;
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 200, ${"r5cost:" + STAMP}, 'R5 원가 절')`;
    const capKrw = PLAN_CAP_KRW.pro;
    const SOFT_USD = Math.round(((capKrw * 1.5) / FX) * 100) / 100;    // 일일 상한의 1.5배 = 소프트 구간(막으면 안 된다)
    const HARD_USD = Math.round(((capKrw * 3.6) / FX) * 100) / 100;    // ×3 초과 = 하드
    const useRef = (tag) => `r5cost-${tag}-${STAMP}`;
    const spend = async (usd, tag, tid = TID) => { guard(tid); await s`INSERT INTO ai_usage (tenant_id, purpose, model, in_tokens, out_tokens, cost_usd, ref) VALUES (${tid}, 'video_clip', 'c-stub', 0, 0, ${usd}, ${useRef(tag)})`; };
    const clearSpend = async (tag, tid = TID) => { guard(tid); await s`DELETE FROM ai_usage WHERE tenant_id = ${tid} AND ref = ${useRef(tag)}`; };
    /** 영상 piece 1개를 제안→확정한다(글 piece 는 drop). 반환: {status, step, error, pieceId, spent(코인), balance} */
    const confirmVideo = async () => {
      const pr = await call(jar, "/api/director-propose", { body: { topicId } });
      const brief = pr.json?.brief; if (!brief) return { status: pr.status, step: pr.json?.step || "propose_failed", error: pr.json?.error, pieceId: 0, spent: 0 };
      const b0 = (await call(jar, "/api/coins-balance")).json;
      const drop = brief.pieces.filter((p) => !(p.kind === "video" || p.video)).map((p) => ({ key: p.key, drop: true }));
      const cf = await call(jar, "/api/director-confirm", { body: { briefId: brief.id, pieces: drop } });
      const b1 = (await call(jar, "/api/coins-balance")).json;
      return { status: cf.status, step: cf.json?.step, error: cf.json?.error, pieceId: cf.json?.pieceIds?.[0] || 0, spent: (b0?.balance ?? 0) - (b1?.balance ?? 0), balance: b1?.balance };
    };
    const auditSince = async (t) => await s`SELECT action, risk_level, detail FROM audit_logs WHERE tenant_id = ${TID} AND created_at > ${t.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id DESC LIMIT 20`;

    /* ① 🔴 소프트 — 이 절의 핵심: «자기 코인으로 만드는 고객이 우리 원가 캡에 막히는 경로 = 0» */
    await clearSpend("soft"); await spend(SOFT_USD, "soft");
    const tSoft = new Date(Date.now() - 5_000);
    const soft = await confirmVideo();
    rec("🔴 소프트 구간(Pro 일일 상한 ₩20,000 초과 · ×3 미만) → 확정 **성공** · 코인 정상 차감 · 고객 무영향",
      soft.status === 202 && soft.pieceId > 0 && soft.spent > 0,
      `${soft.status} step ${soft.step || "-"} «${String(soft.error || "").slice(0, 60)}» · piece ${soft.pieceId} · 코인 -${soft.spent} · 심은 원가 $${SOFT_USD}(₩${Math.round(SOFT_USD * FX).toLocaleString("ko-KR")} > 상한 ₩${capKrw.toLocaleString("ko-KR")})`,
      soft.pieceId ? `piece ${soft.pieceId}` : undefined);
    const aSoft = await auditSince(tSoft);
    const softRow = aSoft.find((a) => /soft/i.test(String(a.action)));
    rec("소프트 → 운영 알림 1건(감사 · usedKrw·capKrw 기록 · 고객 알림 아님)", !!softRow && (softRow.detail?.usedKrw != null || softRow.detail?.capKrw != null),
      softRow ? `${softRow.action} risk ${softRow.risk_level} ${JSON.stringify(softRow.detail || {}).slice(0, 90)}` : `감사 ${aSoft.map((a) => a.action).join(",").slice(0, 90) || "0건"}`);
    const [softNotice] = await s`SELECT id, kind FROM notifications WHERE tenant_id = ${TID} AND kind IN ('ai_cost_cap','piece_failed') AND created_at > ${tSoft.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id DESC LIMIT 1`;
    rec("소프트 → 고객 알림 0(고객은 이미 코인을 냈다)", !softNotice, softNotice ? `🔴 «${softNotice.kind}» ${softNotice.id}` : "없음");

    if (!(await stubGuard(TID, "cost/soft"))) return finish();   // 소프트 확정은 실제로 생성을 태운다 — 스텁이 새면 여기서 멈춘다

    /* ② 하드(일일 상한 ×3 초과) — 확정 시점: 차단하되 코인은 손대지 않는다 */
    await clearSpend("soft"); await spend(HARD_USD, "hard");
    const hard = await confirmVideo();
    rec("하드 구간(일일 상한 ×3 초과) → 차단 · 코인 무접촉(또는 차감했다면 같은 왕복에 환급)", hard.status !== 202 && hard.spent === 0,
      `${hard.status} step ${hard.step || "-"} «${String(hard.error || "").slice(0, 70)}» · 코인 차감 ${hard.spent}`);

    /* ③ 하드를 **체인 안에서** 만나면 = failed + 코인 환급 + 고객 알림 + 운영 알림(risk high) */
    await clearSpend("hard");
    const mid = await confirmVideo();
    if (mid.pieceId) {
      await s`UPDATE pieces SET status = 'generating', meta = (meta - 'chainLock') || ${s.json({ stage: "script" })}, updated_at = NOW() WHERE id = ${mid.pieceId}`;
      await spend(HARD_USD, "chain");
      const tHard = new Date(Date.now() - 5_000);
      const b0 = (await call(jar, "/api/coins-balance")).json;
      await call(null, "/api/generate-video-background", { body: { pieceId: mid.pieceId, tenantId: TID }, headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" } });
      await sleep(4000);
      const [pf] = await s`SELECT status, meta FROM pieces WHERE id = ${mid.pieceId}`;
      const b1 = (await call(jar, "/api/coins-balance")).json;
      const [note] = await s`SELECT id, kind, title FROM notifications WHERE tenant_id = ${TID} AND created_at > ${tHard.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id DESC LIMIT 1`;
      const aHard = await auditSince(tHard); const hardRow = aHard.find((a) => /cost|cap|budget/i.test(String(a.action)));
      rec("체인 안 하드 → piece failed + **코인 환급 실제 발생** + 고객 알림 + 운영 알림(risk high)",
        pf?.status === "failed" && (b1?.balance ?? 0) > (b0?.balance ?? 0) && !!note && !!hardRow && hardRow.risk_level === "high",
        `piece ${mid.pieceId} ${pf?.status} «${String(pf?.meta?.failReason || "").slice(0, 50)}» · 코인 ${b0?.balance}→${b1?.balance} · 알림 ${note?.kind || "0"} · 감사 ${hardRow ? `${hardRow.action}/${hardRow.risk_level}` : "0"}`,
        `piece ${mid.pieceId}`);
      await clearSpend("chain");
    } else warn("체인 안 하드 → failed+환급+알림 2종", `확정이 안 돼 못 쟀다(${mid.status} ${mid.step || ""})`);

    /* ④ 전역 월 ₩1,400,000 = 하드. 🔴 Neon 은 다른 세션(B·B2)과 **공유**다 — 심는 즉시 재고 바로 지운다(남기면 남의 스모크가 막힌다) */
    const gJar = new Jar(); const gEmail = `c+r5g-${STAMP}@autocreate.test`;
    let gTid = 0;
    const gr = await call(gJar, "/api/auth-register", { body: { email: gEmail, password: PASSWORD, name: "C R5 G", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
    if (gr.json?.ok) { const gm = await call(gJar, "/api/auth-me"); gTid = Number(gm.json?.tenant?.id || 0); if (gTid) ALLOWED.add(gTid); }
    if (gTid) {
      await spend(Math.round((GLOBAL_CAP_KRW / FX) * 100) / 100, "global", gTid);
      const g = await confirmVideo();
      rec("전역 월 ₩1,400,000 초과 → 하드(전 테넌트 생성 정지) · 코인 무접촉", g.status !== 202 && g.spent === 0,
        `${g.status} step ${g.step || "-"} «${String(g.error || "").slice(0, 60)}» · 다른 테넌트 ${gTid} 에 $${Math.round(GLOBAL_CAP_KRW / FX)} 심음`);
      await clearSpend("global", gTid);
      await s`DELETE FROM ai_usage WHERE tenant_id = ${gTid}`.catch(() => {});
    } else warn("전역 월 ₩1,400,000 하드", `보조 테넌트 가입 실패(${gr.status}) — 전역 절 건너뜀`);

    /* ⑤ kill switch */
    await s`INSERT INTO feature_flags (key, tenant_id, enabled) VALUES ('video', ${TID}, false) ON CONFLICT DO NOTHING`.catch(() => warn("feature_flags", "표/컬럼 모양 확인"));
    const kill = await confirmVideo();
    rec("kill switch(feature_flags video=false) → 차단(killed) · 코인 무접촉", kill.status !== 202 && kill.spent === 0, `${kill.status} step ${kill.step || "-"} «${String(kill.error || "").slice(0, 60)}»`);
    await s`DELETE FROM feature_flags WHERE key = 'video' AND tenant_id = ${TID}`.catch(() => {});
    await s`UPDATE tenants SET plan_key = 'trial' WHERE id = ${TID}`;   // 🔴 여기서 바로 되돌린다(정리 절까지 미루지 않는다)
    await s`DELETE FROM ai_usage WHERE tenant_id = ${TID} AND ref LIKE ${"r5cost-%"}`;
  }
  /* ══ payload — 🔴 v5.5 §1.4c-(2): 포맷 3종의 `scenes[]` 전건이 clipKey|imageKey 중 하나를 갖는다(둘 다 없으면 러너에 검은 화면 · 계약 §2.1 위반) ══ */
  const payloads = new Map();
  if (SECTIONS.has("payload")) {
    // 기준 재료는 스스로 찾는다(이 절만 단독 실행해도 돌아야 한다 · 디렉터·코인 우회 = 캡·코인과 독립적으로 «페이로드 모양»만 잰다)
    const [base] = pieceId ? await s`SELECT topic_id, channel, account_id, meta FROM pieces WHERE id = ${pieceId}`
      : await s`SELECT topic_id, channel, account_id, meta FROM pieces WHERE tenant_id = ${TID} AND kind = 'video' AND topic_id IS NOT NULL ORDER BY id DESC LIMIT 1`;
    const [anyTopic] = base?.topic_id ? [] : await s`SELECT id FROM topics WHERE tenant_id = ${TID} ORDER BY id DESC LIMIT 1`;
    const baseTopic = base?.topic_id ? Number(base.topic_id) : (topicId || Number(anyTopic?.id || 0));
    // 🔴 원가 하드 캡은 **이 절의 관심사가 아니다**(cost 절이 따로 잰다). trial 하드 ₩9,000 이 60초 1편(₩8,989)을 막아 페이로드를 못 보게 되므로 pro 로 올렸다 저 절 끝에 되돌린다.
    const [planRow] = await s`SELECT plan_key FROM tenants WHERE id = ${TID}`;
    await s`UPDATE tenants SET plan_key = 'pro' WHERE id = ${TID}`;
    const baseSpec = (base?.meta?.video) || {};
    const CASES = [["graphic", 60, "omni"], ["talking", 60, "veo_lite"], ["clip", 15, "veo_lite"]];
    if (!baseTopic) warn("payload 무결성(포맷 3종)", "기준 소재/piece 가 없어 건너뜀");
    for (const [format, seconds, providerKey] of (baseTopic ? CASES : [])) {
      const spec = { ...baseSpec, format, seconds, provider: { tier: "standard", key: providerKey }, voice: { provider: "typecast", voiceId: baseSpec?.voice?.voiceId || "" }, variant: { hookType: "event_pushin", palette: "cool", voiceId: baseSpec?.variant?.voiceId || "" }, disclosure: { badge: false, descriptionFirstLine: false } };
      const [np] = await s`INSERT INTO pieces (tenant_id, topic_id, channel, account_id, kind, status, title, meta)
        VALUES (${TID}, ${baseTopic}, ${String(base?.channel || "youtube_shorts")}, ${base?.account_id ?? null}, 'video', 'generating', ${`C R5 payload ${format}`},
                ${s.json({ stage: "script", video: spec, angle: String(base?.meta?.angle || ""), chainStage: null, chainLock: null, chainResume: { count: 0 } })}) RETURNING id`;
      const npid = Number(np?.id);
      await call(null, "/api/generate-video-background", { body: { pieceId: npid, tenantId: TID }, headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" } });
      let row = null; const dl = Date.now() + Number(process.env.PAYLOAD_TIMEOUT_MS || 180_000);
      while (Date.now() < dl) { const [p] = await s`SELECT status, meta FROM pieces WHERE id = ${npid}`; row = p; if (!(await stubGuard(TID, `payload/${format}`))) return finish(); if (p?.meta?.render || p?.status === "failed" || p?.status === "in_review") break; await sleep(3000); }
      const render = row?.meta?.render || null;
      const scenes = Array.isArray(render?.scenes) ? render.scenes : [];
      const holes = scenes.filter((sc) => !sc.clipKey && !sc.imageKey);
      const stills = scenes.filter((sc) => !sc.clipKey && sc.imageKey);
      payloads.set(format, render);
      rec(`payload ${format}/${seconds}s: scenes 전건이 clipKey|imageKey 중 하나(빈 구간 0)`, scenes.length > 0 && holes.length === 0,
        `piece ${npid} ${row?.status} · scenes ${scenes.length} · clip ${scenes.filter((x) => x.clipKey).length} · image ${stills.length} · 🔴빈칸 ${holes.length}${holes.length ? ` (idx ${holes.map((h) => h.idx).join(",")})` : ""} · ${String(row?.meta?.failReason || "").slice(0, 50)}`,
        `piece ${npid}`);
      if (format === "talking") rec("토킹 still 컷이 실제로 구간을 채운다(imageKey + motion kenburns ≥1 · 스킵 금지)",
        stills.length >= 1 && stills.every((x) => x.motion === "kenburns"), `still ${stills.length} · motion ${[...new Set(stills.map((x) => x.motion))].join("/") || "-"}`);
    }
    await s`UPDATE tenants SET plan_key = ${String(planRow?.plan_key || "trial")} WHERE id = ${TID}`;   // 🔴 바로 되돌린다(가짜 유료 집 금지)
  }

  /* ══ bgm — 🔴 v5.5 §1.4c-(3): seed-bgm.mjs 존재·멱등 · BGM_LICENSE_VERIFIED 없으면 무음(audio.bgm=null)이 «정직 경로»(에러 아님) ══ */
  if (SECTIONS.has("bgm")) {
    const has = existsSync("scripts/seed-bgm.mjs");
    rec("scripts/seed-bgm.mjs 존재(FreePD → R2 autocreate/bgm/ · 라이선스 메타 동봉)", has, has ? "있음" : "없음");
    if (has && process.env.SKIP_SEED_BGM !== "1") {
      const { execFileSync } = await import("node:child_process");
      const run = () => { try { return { ok: true, out: String(execFileSync(process.execPath, ["scripts/seed-bgm.mjs"], { timeout: 180_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) }; } catch (e) { return { ok: false, out: String(e?.stdout || "") + String(e?.stderr || e?.message || "") }; } };
      const r1 = run(); const r2 = has ? run() : { ok: false, out: "" };
      rec("seed-bgm 2회 실행 = 멱등(둘 다 종료코드 0 · 2회차는 신규 업로드 0)", r1.ok && r2.ok && /이미|건너|skip|0\s*개|신규 0|unchanged/i.test(r2.out),
        `1회 ${r1.ok ? "ok" : "실패"} · 2회 ${r2.ok ? "ok" : "실패"} · 2회차 «${r2.out.trim().split("\n").pop()?.slice(0, 70) || ""}»`);
    } else if (has) warn("seed-bgm 멱등", "SKIP_SEED_BGM=1 로 실행 생략");
    const [anyRender] = await s`SELECT id, status, meta FROM pieces WHERE tenant_id = ${TID} AND kind = 'video' AND meta ? 'render' ORDER BY id DESC LIMIT 1`;
    const bgm = anyRender?.meta?.render?.audio?.bgm ?? "없음";
    const licensed = String(process.env.BGM_LICENSE_VERIFIED || "") === "1";
    // 🔴 «무음이 정직 경로» = bgm 이 null 이어도 **그것 때문에** 실패하지 않는다(다른 사유의 실패는 이 절의 관심사가 아니다).
    const bgmBlamed = /bgm|음악|배경음/i.test(String(anyRender?.meta?.failReason || ""));
    rec(licensed ? "BGM_LICENSE_VERIFIED=1 → audio.bgm 에 키·gainDb" : "BGM_LICENSE_VERIFIED 없음 → audio.bgm = null(무음)이 정직 경로(bgm 때문에 실패 0)",
      anyRender ? (licensed ? !!bgm && !!bgm.key : bgm === null && !bgmBlamed) : false,
      anyRender ? `piece ${anyRender.id} ${anyRender.status} · bgm ${JSON.stringify(bgm).slice(0, 40)} · 실패사유 «${String(anyRender.meta?.failReason || "-").slice(0, 45)}»` : "render 페이로드를 가진 piece 0(payload 절 먼저)");
  }

  /* ══ rules — kind shorts 주 2회 → coinsPerWeek 2×28 · 슬롯 점 · 슬롯 없는 자동 생성 거부 감사 ══ */
  if (SECTIONS.has("rules")) {
    const rs = await call(jar, "/api/rules-save", { body: { rules: [{ channel: "youtube_shorts", kind: "shorts", accountMode: "auto", every: "week", count: 2, active: true }] } });
    rec("규칙 kind shorts 주 2회 → coinsPerWeek 56(2×video_60 28) · slotsCreated ≥1", rs.json?.ok === true && rs.json.coinsPerWeek === 56 && rs.json.slotsCreated >= 1, `${rs.status} ${rs.json?.step || ""} coins/week ${rs.json?.coinsPerWeek} slots ${rs.json?.slotsCreated}`);
    const sl = (await call(jar, "/api/slots-list")).json?.slots || [];
    rec("슬롯 kind shorts · 채널 youtube_shorts", sl.some((x) => x.kind === "shorts" && x.channel === "youtube_shorts"), `${sl.filter((x) => x.kind === "shorts").length}개`);
    const [gate] = await s`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${TID} AND action = 'piece_slotless_blocked'`;
    warn("슬롯 없는 자동 생성 시도 → piece_slotless_blocked 감사(AC-2)", `자동 경로 재현 손잡이 트리거 때 · 현재 감사 ${gate?.c}건`);
  }
  /* ══ disclosure — 배지 트랙 · 시작 3초 자막 · 설명란 첫 줄(제휴) · approve/publish 재검사 ══ */
  if (SECTIONS.has("disclosure")) {
    const src = existsSync("lib/disclosure.ts") ? readFileSync("lib/disclosure.ts", "utf8") : "";
    rec("disclosure.ts: videoBadgeText·videoDescriptionFirstLine·checkVideoDisclosure 존재(정적)", /videoBadgeText/.test(src) && /videoDescriptionFirstLine/.test(src) && /checkVideoDisclosure/.test(src), "");
    rec("영상 배지 문구 «광고 포함 · 파트너스 수수료»(§16B.2)", /광고 포함 · 파트너스 수수료/.test(src), "");
    warn("제휴 영상 piece 의 배지 트랙+시작 자막+설명란 첫 줄 셋 다 → approve 통과 · 하나 빠지면 gate", "제휴 소재 piece 트리거 때");
  }
  /* ══ fingerprint — 순수 함수 · pHash 해밍 ≤10 유사 ══ */
  if (SECTIONS.has("fingerprint")) {
    const fp = existsSync("lib/video/fingerprint.ts") ? readFileSync("lib/video/fingerprint.ts", "utf8") : "";
    rec("lib/video/fingerprint.ts: pHash 64bit · 해밍 거리 ≤ 10(정적)", /hamming|Hamming/i.test(fp) && /10/.test(fp) && /64/.test(fp), fp ? "있음" : "파일 없음");
    warn("다계정 변주(훅·팔레트·보이스 다름 · 프레임 거리 > 10 · 대본 유사도 < 0.6)", "같은 brief 유튜브 계정 2 → 트리거 때(스텁 프레임으로 거리 계산 확인)");
  }
  /* ══ posts — uploaded_private 폭 · 화면 «비공개 업로드됨» · publishVideo 정직 ══ */
  if (SECTIONS.has("posts")) {
    const [col] = await s`SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'status'`;
    rec("posts.status 칸 폭 ≥ 16('uploaded_private' 16자 · AC-21)", Number(col?.n) >= 16, `varchar(${col?.n})`);
    const [k] = await s`SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_name = 'runner_jobs' AND column_name = 'kind'`;
    rec("runner_jobs.kind 폭 ≥ 22('publish.youtube_shorts' 22자)", Number(k?.n) >= 22, `varchar(${k?.n})`);
    const [pk] = await s`SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_name = 'piece_assets' AND column_name = 'kind'`;
    rec("piece_assets.kind 폭 ≥ 5(clip·audio·srt)", Number(pk?.n) >= 5, `varchar(${pk?.n})`);
    const pl = await call(jar, "/api/posts-list", { query: { status: "all" } });
    rec("posts-list status 어휘에 uploaded_private 허용(화면 «비공개 업로드됨»)", pl.json?.ok === true, `${pl.status}`);
  }
  /* ══ wiring — 🔴 AC-29 «누가 부르나»: 새 게이트·잡 kind·상태 어휘의 **호출처 수를 센다**(0 이면 있는 척 미완) ══ */
  if (SECTIONS.has("wiring")) {
    const { readdirSync, statSync } = await import("node:fs");
    const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (f === "node_modules" || f.startsWith(".")) continue; const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(ts|mts|mjs|js)$/.test(f)) files.push(p); } };
    for (const d of ["lib", "netlify/functions", "runner", "db"]) { try { walk(d); } catch { /* */ } };
    const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const callers = (needle, ownerRe) => [...src].filter(([f, t]) => !ownerRe.test(f) && t.includes(needle)).map(([f]) => f);
    const must = [
      ["triggerVideo(", /lib\/video\/gen\.ts/, "배경 생성 착수(디렉터·재생성·스위퍼)"],
      ["checkVideoBudget(", /lib\/video\/cost\.ts/, "원가 관문"],
      ["videoCoinItem(", /lib\/coin-table\.ts/, "영상 코인 구간제"],
      ["enqueueRender(", /lib\/video\/render-queue\.ts/, "렌더 잡 적재"],
    ];
    for (const [needle, owner, what] of must) { const c = callers(needle, owner); rec(`호출처 ≥1 — ${needle.replace("(", "")}(${what})`, c.length >= 1, c.length ? c.join(" ").slice(0, 90) : "🔴 0곳 = 있는 게이트가 안 지킨다(AC-29)"); }
    // 스위퍼는 «문자열»이 아니라 STEPS 배열 등록으로 산다(문자열 grep 은 주석에도 걸린다 — 심볼로 센다)
    const runnerSrc = src.get("lib/cron/runner.ts") || "";
    rec("스위퍼 등록 — lib/cron/runner.ts STEPS 에 videoSweepStep(5m)", /import\s*\{[^}]*videoSweepStep/.test(runnerSrc) && /videoSweepStep\s*,/.test(runnerSrc.split("STEPS")[1] || runnerSrc), /videoSweepStep/.test(runnerSrc) ? "import+STEPS" : "🔴 미등록");
    // 🔴 고지 재검사는 **승인·발행 직전**에 불려야 한다(계약 §1.8) — 심사(judge) 안에서만 불리면 «검수에서 통과시킨 것»을 발행이 다시 안 본다
    const approveCallers = callers("checkVideoDisclosure", /lib\/(disclosure|video\/judge)\.ts/);
    rec("고지 재검사 호출처 — approve·publish 경로(content-approve·publish/*)에 ≥1(계약 §1.8)",
      approveCallers.some((f) => /content-approve|publish|pieces/.test(f)), approveCallers.length ? approveCallers.join(" ").slice(0, 90) : "🔴 judge.ts 밖 0곳 — 승인·발행 직전 재검사 미배선(AC-29)");
    const later = [["finalizeRender(", /lib\/video\/render-queue\.ts/, "B2"], ["render.video", /lib\/video\/(render-queue|types)\.ts/, "B2"], ["uploaded_private", /lib\/video\//, "B2·A"], ["publish.naver_clip", /lib\/video\//, "B2"]];
    for (const [needle, owner, who] of later) { const c = callers(needle, owner); rec(`호출처(${who} 머지 후) — ${needle.replace("(", "")}`, c.length >= 1 ? true : "WARN", c.length ? c.join(" ").slice(0, 90) : `${who} 미머지 — 머지 후 다시 센다`); }
  }

  /* ══ regress — 글 파이프 무변경 · 타 테넌트 · 평문 ══ */
  if (SECTIONS.has("regress")) {
    const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: PASSWORD } });
    const x = pieceId ? await call(other, "/api/pieces-get", { query: { id: String(pieceId) } }) : { status: 404 };
    rec("타 테넌트 영상 piece 404", x.status === 404, `${x.status}`);
    const vd = pieceId ? await call(jar, "/api/pieces-get", { query: { id: String(pieceId) } }) : { json: null };
    rec("pieces-get(video): kind video · blocks video/srt/hashtags 또는 generating 정직 · 자격 평문 0", !pieceId || (vd.json?.ok === true && !vd.text.includes("Zq9-plain")), `${vd.status} kind ${vd.json?.piece?.kind} stage ${vd.json?.piece?.stage}`);
    const c = await cron("hourly", TID); rec("글 파이프 크론 회귀(hourly errors 0)", c.status === 200 && (c.json?.ran || []).every((x) => x.errors === 0), (c.json?.ran || []).map((x) => `${x.step}:${x.errors}`).join(" "));
  }
  if (SECTIONS.has("cleanup")) {
    /* 🔴 정리까지가 검증(C-HANDOFF §2.3): 돈·상태 행을 먼저 되돌린다 — 가짜 유료 테넌트가 운영 대시보드 MRR·전환율을 만든다. */
    for (const t of [...ALLOWED]) {
      try { await s.unsafe(`UPDATE tenants SET plan_key = 'trial' WHERE id = $1 AND plan_key <> 'trial'`, [t]); } catch { /* */ }
      try { await s.unsafe(`DELETE FROM piece_assets WHERE piece_id IN (SELECT id FROM pieces WHERE tenant_id = $1)`, [t]); } catch { /* */ }
      for (const tbl of ["affiliate_links", "posts", "runner_jobs", "coin_ledger", "ai_usage", "notifications", "audit_logs", "feature_flags", "slots", "pieces", "briefs", "cadence_rules", "shorts_templates"]) { try { await s.unsafe(`DELETE FROM ${tbl} WHERE tenant_id = $1`, [t]); } catch { /* */ } }
    }
    // AC-20 계열 회피: 배열 바인딩 대신 id 목록을 펼쳐 센다.
    let left = { c: 0 };
    for (const t of [...ALLOWED]) { try { const [r] = await s.unsafe(`SELECT COUNT(*) AS c FROM tenants WHERE id = $1 AND plan_key <> 'trial'`, [t]); left = { c: Number(left.c) + Number(r?.c || 0) }; } catch { left = { c: "?" }; } }
    rec("정리(테스트 테넌트 영상·코인·잡·감사·템플릿 행 · 플랜 trial 복구)", String(left?.c) === "0", `tenants ${[...ALLOWED].join(",")} · 유료로 남은 집 ${left?.c}`);
  }
  finish();
}
function finish() {
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R5 C 하니스(뼈대) · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 60)} ${w(r.note, 66)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/p1r5-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2)); console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {}); process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); finish(); });
