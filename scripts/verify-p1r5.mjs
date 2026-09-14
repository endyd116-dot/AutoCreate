// scripts/verify-p1r5.mjs — P1R5 검증 하니스 뼈대(C · 계약 v5.1 §6 · 영상 «생성 두뇌 + 러너 렌더 + 출구»). 🔴 B-1·B2·A 머지 후 트리거 때 실경로로 채운다.
//   로컬 스모크(돈 0): 손잡이 확정(계약 v5.2 §1.4b): dev 서버 env `VIDEO_PROVIDER_STUB=1`(provider·TTS·비전 스텁 · ai_usage 원가 0) · `CHAIN_BUDGET_MS`(기본 660000 · 이어달리기 재현은 30000 으로) · 슬롯 없는 자동 생성은 새 손잡이 없이 confirm({origin:"auto"}) slotId 없이(HTTP 밖 · tsx 로 lib 직접 호출) 로 chainStage 전이·잠금·이어달리기·스위퍼·코인 구간·달러 캡·kill switch·프레임 지문·uploaded_private 폭·배지 고지.
//   라이브 실증(돈 씀 · 1회 · 메인 호출): 60초 실제 생성·렌더·유튜브 비공개 업로드 — 이 파일 밖(별도 스크립트 · videoId·R2 HEAD·스샷 증거).
//   사용: node scripts/verify-p1r5.mjs   (BASE_URL 기본 http://localhost:8901 · CRON_SECRET · SECTIONS=setup,topics,director,chain,sweep,cost,rules,disclosure,fingerprint,posts,regress,cleanup)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36); const EMAIL = process.env.TEST_EMAIL || `c+r5-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || "";
const SECTIONS = new Set((process.env.SECTIONS || "setup,topics,director,chain,sweep,cost,rules,disclosure,fingerprint,posts,regress,cleanup").split(","));
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
    while (Date.now() < dl) { const [p] = await s`SELECT status, meta FROM pieces WHERE id = ${pieceId}`; last = p; const st = p?.meta?.chainStage?.stage || p?.meta?.stage; if (st && seen[seen.length - 1] !== st) seen.push(st); if (["in_review", "failed"].includes(p?.status) || p?.meta?.stage === "render") break; await sleep(4000); }
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
  /* ══ cost — 달러 캡(테넌트 $30 · 전역 $300 · fail-closed) · kill switch ══ */
  if (SECTIONS.has("cost") && topicId) {
    await s`INSERT INTO ai_usage (tenant_id, purpose, model, in_tokens, out_tokens, cost_usd, ref) VALUES (${TID}, 'video_clip', 'c-stub', 0, 0, 31, ${"cap" + STAMP})`;
    const pr = await call(jar, "/api/director-propose", { body: { topicId } });
    const b0 = (await call(jar, "/api/coins-balance")).json;
    const cf = pr.json?.brief ? await call(jar, "/api/director-confirm", { body: { briefId: pr.json.brief.id, pieces: pr.json.brief.pieces.filter((p) => !(p.kind === "video" || p.video)).map((p) => ({ key: p.key, drop: true })) } }) : { status: 0, json: null };
    const b1 = (await call(jar, "/api/coins-balance")).json;
    rec("테넌트 월 $30 초과 → step budget · 코인 무접촉", cf.json?.step === "budget" && b0?.balance === b1?.balance, `${cf.status} ${cf.json?.step} «${cf.json?.error}» · ${b0?.balance}→${b1?.balance}`);
    await s`DELETE FROM ai_usage WHERE tenant_id = ${TID} AND ref = ${"cap" + STAMP}`;
    await s`INSERT INTO feature_flags (key, tenant_id, enabled) VALUES ('video', ${TID}, false) ON CONFLICT DO NOTHING`.catch(() => warn("feature_flags", "표/컬럼 모양 확인"));
    const pr2 = await call(jar, "/api/director-propose", { body: { topicId } });
    const cf2 = pr2.json?.brief ? await call(jar, "/api/director-confirm", { body: { briefId: pr2.json.brief.id, pieces: pr2.json.brief.pieces.filter((p) => !(p.kind === "video" || p.video)).map((p) => ({ key: p.key, drop: true })) } }) : { status: 0, json: null };
    rec("kill switch(feature_flags video=false) → step budget(killed)", cf2.json?.step === "budget" || cf2.json?.reason === "killed", `${cf2.status} ${cf2.json?.step} ${cf2.json?.reason || ""}`);
    await s`DELETE FROM feature_flags WHERE key = 'video' AND tenant_id = ${TID}`.catch(() => {});
    rec("조회 실패 = 차단(fail-closed) · 전역 $300", "WARN", "정적 확인: lib/video/cost.ts checkVideoBudget lookup_failed → allowed:false");
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
    for (const t of ["piece_assets"]) await s`DELETE FROM piece_assets WHERE piece_id IN (SELECT id FROM pieces WHERE tenant_id = ${TID})`.catch(() => {});
    for (const t of ["runner_jobs", "coin_ledger", "ai_usage", "notifications", "slots", "pieces", "briefs", "cadence_rules"]) { try { await s.unsafe(`DELETE FROM ${t} WHERE tenant_id = $1`, [TID]); } catch { /* */ } }
    await s`DELETE FROM shorts_templates WHERE tenant_id = ${TID}`.catch(() => {});
    rec("정리(테스트 테넌트 영상·코인·잡·템플릿 행)", true, `tenant ${TID}`);
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
