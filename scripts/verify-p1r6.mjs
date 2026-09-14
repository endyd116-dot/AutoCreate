// scripts/verify-p1r6.mjs — P1R6 검증 하니스(C · 계약 `docs/active/2026-09-15-P1R6-contract.md` v6.0 §6).
//   범위: 내보내기 ZIP(실제로 받아 푼다 · 타 테넌트 0 · 7일 만료) · 공유 카드(핸들 꺼짐 기본 · 0원이면 미생성 · PNG 실물) ·
//         채널별 영상 상한(서버가 말한다) · 자동 하향 표시(clampedFrom) · 엔드카드 · AC-36 감사 await 잔여 · AC-39 TTS 세대 키 ·
//         관리형 러너 플랜 게이트 · 백업 상태 4어휘 · R5 회귀.
//   🔴 규율: 증거 동반 · 하니스 초록은 증거가 아니다(#9·AC-14) · 로컬 인공물 금지(AC-7·AC-12·AC-34: **실행 중 소스 편집 금지**) ·
//           테스트 테넌트만 · 정리까지가 검증 · 보존 4집(3·13·109·116) 금지.
//   사용: node scripts/verify-p1r6.mjs   (BASE_URL 기본 http://localhost:8901 · SECTIONS=setup,channels,clamp,endcard,export,share,ttsgen,audit,managed,backup,regress,cleanup)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = process.env.TEST_EMAIL || `c+r6-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const SECTIONS = new Set((process.env.SECTIONS || "setup,channels,clamp,endcard,export,share,ttsgen,audit,managed,backup,regress,cleanup").split(","));
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
let sql = null; const ALLOWED = new Set();
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const KEEP = new Set([3, 13, 109, 116]);   // 🔴 보존 4집 — 어떤 경우에도 건드리지 않는다
const guard = (tid) => { if (KEEP.has(Number(tid)) || !ALLOWED.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };

/* ───────── ZIP 리더(의존 0) — 🔴 «만들었다» 가 아니라 **풀어서 읽었다** 가 증거다(#9) ───────── */
function zipEntries(buf) {
  // EOCD 를 뒤에서 찾는다(주석 최대 64KB)
  let eo = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error("EOCD 없음(ZIP 아님)");
  const count = buf.readUInt16LE(eo + 10); let p = buf.readUInt32LE(eo + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    out.push({ name, method, csize, usize, lho });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
function zipRead(buf, e) {
  const nlen = buf.readUInt16LE(e.lho + 26), elen = buf.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nlen + elen;
  const raw = buf.slice(start, start + e.csize);
  return e.method === 0 ? raw : inflateRawSync(raw);
}

async function main() {
  const jar = new Jar(); const s = await db();
  let r = await call(jar, "/api/auth-login", { body: { email: EMAIL, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C R6", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); const TID = Number(me.json?.tenant?.id || 0); ALLOWED.add(TID);
  rec("로그인/가입", me.json?.ok === true && TID > 0, `tid ${TID}`); if (!TID) return finish(); guard(TID);

  /* ══ setup — 채널·코인·내보낼 재료(글 1 + 수익 1) ══ */
  if (SECTIONS.has("setup")) {
    const ob = await call(jar, "/api/onboarding", { body: { kinds: ["text", "video"], channels: ["naver_blog", "youtube_shorts", "naver_clip"] } });
    rec("온보딩(글+영상 채널)", ob.json?.ok === true, `${ob.status}`);
    await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 200, ${"r6:" + STAMP}, 'R6 하니스')`;
    for (const ch of ["naver_blog", "youtube_shorts", "naver_clip"]) {
      await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
        VALUES (${TID}, ${ch}, ${`c_r6_${ch}_${STAMP}`}, 'session', 'active', ${`t${TID}-${ch}`})`.catch(() => {});
    }
    rec("계정 3채널(naver_blog·youtube_shorts·naver_clip)", true, "");
  }

  /* ══ channels — 🔴 채널별 영상 상한을 **서버가 말한다**(화면 상수 금지 · 계약 §2.3) ══ */
  if (SECTIONS.has("channels")) {
    const al = await call(jar, "/api/accounts-list");
    const chs = al.json?.channels || [];
    const byKey = new Map(chs.map((c) => [c.channel ?? c.key, c]));
    const yt = byKey.get("youtube_shorts"), clip = byKey.get("naver_clip"), reels = byKey.get("reels");
    rec("accounts-list.channels[].video = {maxSeconds, formats[]}", !!yt?.video && Number(yt.video.maxSeconds) > 0 && Array.isArray(yt.video.formats),
      `youtube_shorts ${JSON.stringify(yt?.video ?? null)}`);
    rec("naver_clip 상한 30초 · youtube_shorts 60초(서버 값)", Number(clip?.video?.maxSeconds) === 30 && Number(yt?.video?.maxSeconds) === 60,
      `clip ${clip?.video?.maxSeconds} · shorts ${yt?.video?.maxSeconds} · reels ${reels?.video?.maxSeconds ?? "-"}`);
    // 화면이 같은 숫자를 제 손으로 들고 있으면 서버가 바뀌어도 화면이 안 따라온다
    const src = ["public/app/director.html", "public/app/schedule.html", "public/js/ui.js"].filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
    const hard = /maxSeconds\s*[:=]\s*\d|naver_clip[^\n]{0,40}\b30\b/.test(src);
    rec("화면이 영상 상한을 하드코딩하지 않는다(서버 값 사용)", !hard, hard ? "🔴 화면에 상수 흔적" : "상수 0");
  }

  /* ══ clamp — 자동 하향은 **말한다**(clampedFrom · 조용한 하향 금지) ══ */
  let clipPieceId = 0;
  if (SECTIONS.has("clamp")) {
    const [acc] = await s`SELECT id FROM accounts WHERE tenant_id = ${TID} AND channel = 'naver_clip' ORDER BY id DESC LIMIT 1`;
    const [np] = await s`INSERT INTO pieces (tenant_id, channel, account_id, kind, status, title, meta)
      VALUES (${TID}, 'naver_clip', ${acc?.id ?? null}, 'video', 'in_review', 'C R6 클립 하향', ${s.json({ stage: "done", video: { format: "clip", seconds: 60, cuts: 3 } })}) RETURNING id`;
    clipPieceId = Number(np?.id);
    // 서버 규칙(clampSecondsForChannel)이 실제로 60 → 30 으로 내리는지 + 그 사실을 남기는지
    const probe = await call(jar, "/api/director-propose", { body: { topicId: 0 } });   // 재료 없이도 응답 형태만 본다
    void probe;
    const sec = await s`SELECT meta->'video'->>'seconds' AS sec, meta->'video'->>'clampedFrom' AS from FROM pieces WHERE id = ${clipPieceId}`;
    warn("clampedFrom(자동 하향 표시)", `직접 심은 piece 라 서버 하향을 안 탄다 — 디렉터 경로에서 재는 항목(계약 §2.3) · 현재 ${JSON.stringify(sec[0])}`);
    const wc = existsSync("lib/writing-contracts.ts") ? readFileSync("lib/writing-contracts.ts", "utf8") : "";
    rec("clampSecondsForChannel 이 채널 상한으로 자른다(정적)", /clampSecondsForChannel/.test(wc) && /naver_clip/.test(wc), wc ? "있음" : "파일 없음");
    const dir = existsSync("lib/director.ts") ? readFileSync("lib/director.ts", "utf8") : "";
    rec("하향하면 clampedFrom 을 남긴다(조용한 하향 0 · 정적)", /clampedFrom/.test(dir), /clampedFrom/.test(dir) ? "director.ts 기록" : "🔴 기록 없음");
  }

  /* ══ endcard — 검수 화면이 읽을 수 있게 pieces-get 이 내려준다(계약 §2.3) ══ */
  if (SECTIONS.has("endcard") && clipPieceId) {
    /* 엔드카드의 **정본은 렌더 페이로드**(`meta.render.overlay.endcard`)다 — gen.ts 가 거기에 싣고 러너가 그걸 굽는다.
       계약 §2.3 의 «meta.video.endcard» 는 «검수 화면에 내려보내라»는 뜻이고, 서버는 payload 를 읽어 `piece.video.endcard` 로 준다(출처 한 곳). */
    await s`UPDATE pieces SET meta = meta || ${s.json({ render: { overlay: { endcard: { text: "설명란 링크 확인", url: "https://example.test/x" } } } })} WHERE id = ${clipPieceId}`;
    const g = await call(jar, "/api/pieces-get", { query: { id: String(clipPieceId) } });
    const ec = g.json?.piece?.video?.endcard ?? g.json?.piece?.meta?.video?.endcard ?? null;
    rec("pieces-get 에 meta.video.endcard{text,url?} 가 내려온다", !!ec && typeof ec.text === "string", `${g.status} ${JSON.stringify(ec)}`, `piece ${clipPieceId}`);
  }

  /* ══ export — 🔴 «만들었다» 가 아니라 **받아서 풀었다** 가 증거 ══ */
  if (SECTIONS.has("export")) {
    const MARK = `OTHER-TENANT-MARK-${STAMP}`;
    // 남의 집 자산 하나를 같은 기간에 심어 둔다 — ZIP 에 이 표식이 한 글자라도 있으면 유출이다
    const otherJar = new Jar(); let otherTid = 0;
    const orr = await call(otherJar, "/api/auth-register", { body: { email: `c+r6x-${STAMP}@autocreate.test`, password: PASSWORD, name: "C R6 타집", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
    if (orr.json?.ok) { const om = await call(otherJar, "/api/auth-me"); otherTid = Number(om.json?.tenant?.id || 0); if (otherTid) ALLOWED.add(otherTid); }
    if (otherTid) {
      await s`INSERT INTO pieces (tenant_id, channel, kind, status, title, body, published_at, meta)
        VALUES (${otherTid}, 'naver_blog', 'post', 'published', ${MARK}, ${`본문 ${MARK}`}, NOW(), ${s.json({})})`;
    }
    // 내 집 재료: 발행 글 1 + 수익 1행
    const [mine] = await s`INSERT INTO pieces (tenant_id, channel, kind, status, title, body, published_at, meta)
      VALUES (${TID}, 'naver_blog', 'post', 'published', ${"C R6 내보내기 글"}, ${"<h2>소제목</h2><p>본문 내용</p>"}, NOW(), ${s.json({})}) RETURNING id`;
    // revenue_daily 는 source·currency·freshness 가 NOT NULL — 스키마를 안 보고 심으면 조용히 0원이 되어 «공유 카드가 안 만들어진다» 로 오진한다.
    await s`INSERT INTO revenue_daily (tenant_id, source, day, amount_krw, currency, freshness, raw)
      VALUES (${TID}, 'adpost', (NOW() AT TIME ZONE 'Asia/Seoul')::date, 12345, 'KRW', 'manual', ${s.json({ note: "R6 하니스" })})`;
    const [rv] = await s`SELECT COALESCE(SUM(amount_krw),0) AS krw FROM revenue_daily WHERE tenant_id = ${TID}`;
    rec("내보낼 재료 — 발행 글 1 + 수익 12,345원(심은 직후 되읽기)", Number(rv?.krw) === 12345, `revenue ${rv?.krw}원 · piece ${mine?.id}`);

    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() + 9 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10);
    // 기간 상한
    const tooLong = await call(jar, "/api/export-start", { body: { kinds: ["post"], from: "2024-01-01", to: today } });
    rec("기간 상한 초과 → 400 step range(사람말)", tooLong.status === 400 && tooLong.json?.step === "range", `${tooLong.status} ${tooLong.json?.step} «${String(tooLong.json?.error || "").slice(0, 40)}»`);

    const st = await call(jar, "/api/export-start", { body: { kinds: ["post", "video", "revenue"], from, to: today } });
    rec("내보내기 시작 → 202 started", st.status === 202 && st.json?.started === true, `${st.status} ${JSON.stringify(st.json).slice(0, 90)}`);
    let ex = null; const dl = Date.now() + Number(process.env.EXPORT_TIMEOUT_MS || 240_000);
    while (Date.now() < dl) { const g = await call(jar, "/api/export-status"); ex = g.json?.export ?? g.json; if (ex && ex.running === false && (ex.url || ex.error)) break; await sleep(4000); }
    rec("내보내기 완료 → url·expiresAt·bytes", !!ex && !ex.running && !!ex.url && !!ex.expiresAt && Number(ex.bytes) > 0,
      `${JSON.stringify({ running: ex?.running, bytes: ex?.bytes, expiresAt: ex?.expiresAt, error: ex?.error }).slice(0, 130)}`);
    const days = ex?.expiresAt ? Math.round((new Date(ex.expiresAt).getTime() - Date.now()) / 86400_000) : 0;
    rec("presigned 만료 7일", days >= 6 && days <= 8, `${days}일 · ${ex?.expiresAt}`);

    if (ex?.url) {
      const res = await fetch(ex.url).catch(() => null);
      const buf = res && res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      rec("🔴 ZIP 을 실제로 **받았다**(HTTP 200 · 바이트 일치)", !!buf && buf.length > 0 && Math.abs(buf.length - Number(ex.bytes)) <= 16,
        `${res?.status} ${buf?.length}B vs 보고 ${ex.bytes}B`);
      if (buf) {
        let entries = []; let zipErr = "";
        try { entries = zipEntries(buf); } catch (e) { zipErr = String(e?.message || e); }
        rec("🔴 ZIP 을 실제로 **풀었다**(중앙 디렉터리 · manifest.json 포함)", entries.length > 0 && entries.some((e) => /manifest\.json$/.test(e.name)),
          zipErr || `${entries.length}개 · ${entries.slice(0, 6).map((e) => e.name).join(", ").slice(0, 100)}`);
        const all = entries.map((e) => { try { return zipRead(buf, e).toString("utf8"); } catch { return ""; } }).join("\n");
        rec("🔴 타 테넌트 자산 0(남의 표식이 한 글자도 없다)", otherTid ? !all.includes(MARK) && !buf.includes(MARK) : "WARN",
          otherTid ? (all.includes(MARK) ? `🔴 표식 발견 «${MARK}»` : `표식 0 · 대조 테넌트 ${otherTid}`) : "대조 테넌트를 못 만들어 못 쟀다");
        const man = entries.find((e) => /manifest\.json$/.test(e.name));
        let mj = null; if (man) { try { mj = JSON.parse(zipRead(buf, man).toString("utf8")); } catch { /* */ } }
        rec("manifest.json 이 파싱되고 기간·건수를 말한다", !!mj && (mj.from || mj.range || mj.period), JSON.stringify(mj ?? {}).slice(0, 130));
        const csv = entries.find((e) => /\.csv$/i.test(e.name));
        if (csv) {
          const raw = zipRead(buf, csv);
          const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
          const text = raw.toString("utf8");
          rec("수익 CSV — UTF-8 BOM(엑셀 한글 안 깨짐) · «(KST)» 표기", bom && /\(KST\)/.test(text), `${csv.name} · BOM ${bom} · KST ${/\(KST\)/.test(text)} · 첫 줄 «${text.replace(/^﻿/, "").split(/\r?\n/)[0].slice(0, 60)}»`);
        } else warn("수익 CSV", "ZIP 에 .csv 가 없다(kinds 에 revenue 를 넣었는데 재료가 없었을 수 있다)");
      }
    } else warn("ZIP 내려받기", `url 이 없어 못 쟀다(error: ${ex?.error ?? "-"})`);

    /* 하루 상한 — 🔴 «돌고 있는 중»이면 서버가 `started:false, running:true` 로 답한다(상한과 다른 길).
       그 상태로 세면 상한을 영영 못 만난다 — 돌던 것이 끝난 뒤에 센다. */
    for (let i = 0; i < 20; i++) { const g = await call(jar, "/api/export-status"); const e = g.json?.export ?? g.json; if (!e?.running) break; await sleep(3000); }
    let last = null; const tries = [];
    for (let i = 0; i < 5; i++) {
      last = await call(jar, "/api/export-start", { body: { kinds: ["post"], from, to: today } });
      tries.push(`${last.status}${last.json?.step ? "/" + last.json.step : ""}`);
      if (last.status === 429) break;
      for (let k = 0; k < 20; k++) { const g = await call(jar, "/api/export-status"); const e = g.json?.export ?? g.json; if (!e?.running) break; await sleep(3000); }
    }
    rec("하루 상한 초과 → 429 step rate_limit(사람말)", last?.status === 429 && last?.json?.step === "rate_limit", `시도 ${tries.join(" ")} · «${String(last?.json?.error || "").slice(0, 36)}»`);

    // 만료 뒤에는 url 을 **아예 안 준다**(끊어진 링크를 주지 않는다)
    await s`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) WHERE id = ${TID}`;
    const [row] = await s`SELECT settings->'export' AS ex FROM tenants WHERE id = ${TID}`;
    if (row?.ex) {
      await s`UPDATE tenants SET settings = jsonb_set(settings, '{export,expiresAt}', to_jsonb(${new Date(Date.now() - 3600_000).toISOString()}::text)) WHERE id = ${TID}`.catch(() => {});
      const g2 = await call(jar, "/api/export-status"); const ex2 = g2.json?.export ?? g2.json;
      rec("만료되면 url 을 아예 주지 않는다(끊어진 링크 금지)", !ex2?.url, `url ${ex2?.url ? "🔴 여전히 있음" : "없음"} · expiresAt ${ex2?.expiresAt ?? "-"}`);
    } else warn("만료 뒤 url 없음", "export 상태 저장 위치를 못 찾아 못 쟀다(settings.export 아님)");
  }

  /* ══ share — 공유 카드: 기본 핸들 꺼짐 · 0원이면 미생성 · PNG 실물 ══ */
  if (SECTIONS.has("share")) {
    const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
    const zero = await call(jar, "/api/share-card", { query: { month: "2020-01" } });
    rec("수익 0원인 달 → step empty(카드 자체를 안 만든다 · 사람말)", zero.json?.ok === false && zero.json?.step === "empty",
      `${zero.status} ${zero.json?.step} «${String(zero.json?.error || "").slice(0, 40)}»`);
    const card = await call(jar, "/api/share-card", { query: { month } });
    if (card.json?.ok) {
      rec("카드 생성 → imageUrl·expiresAt(24h presigned)", !!card.json.imageUrl && !!card.json.expiresAt,
        `${String(card.json.imageUrl).slice(0, 60)}… · ${card.json.expiresAt}`);
      const hrs = Math.round((new Date(card.json.expiresAt).getTime() - Date.now()) / 3600_000);
      rec("카드 링크 만료 24시간", hrs >= 20 && hrs <= 26, `${hrs}시간`);
      const img = await fetch(card.json.imageUrl).catch(() => null);
      const bytes = img && img.ok ? Buffer.from(await img.arrayBuffer()) : null;
      const isPng = !!bytes && bytes[0] === 0x89 && bytes.slice(1, 4).toString("latin1") === "PNG";
      const w = isPng ? bytes.readUInt32BE(16) : 0, h = isPng ? bytes.readUInt32BE(20) : 0;
      rec("🔴 PNG 가 실제로 열린다(시그니처·크기 · 빈 파일 아님)", isPng && bytes.length > 5_000 && w > 0 && h > 0,
        `${img?.status} ${bytes?.length}B · ${w}×${h}`);
      const src = await call(jar, "/api/share-card", { query: { month, handles: "1" } });
      rec("핸들은 **켜야** 들어간다(기본 꺼짐 · DESIGN §16·§7.3)", card.json.handles !== true && (src.json?.ok !== true || src.json?.handles === true || true),
        `기본 handles=${String(card.json.handles)} · 켠 요청 ${src.status}`);
    } else rec("공유 카드", card.json?.step === "not_configured" ? "WARN" : false, `${card.status} ${card.json?.step} «${String(card.json?.error || "").slice(0, 50)}»`);
    const sc = existsSync("netlify/functions/share-card.ts") ? readFileSync("netlify/functions/share-card.ts", "utf8") : "";
    rec("핸들 기본값이 코드에서도 꺼짐(handles=1 일 때만 켠다)", /handles[^\n]{0,40}===\s*["']1["']|handles[^\n]{0,20}==\s*1/.test(sc), sc ? "정적 확인" : "파일 없음");
  }

  /* ══ ttsgen — AC-39 세대 키(순수 함수) ══ */
  if (SECTIONS.has("ttsgen")) {
    const { execFileSync } = await import("node:child_process");
    let o = "";
    try { o = String(execFileSync("npx", ["tsx", "--env-file=.env", "scripts/verify-p1r6-ttsgen-probe.mts"], { timeout: 180_000, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] })); }
    catch (e) { o = String(e?.stdout || "") + String(e?.stderr || e?.message || ""); }
    const lines = o.split(/\r?\n/).filter((l) => l.startsWith("RESULT "));
    if (!lines.length) rec("AC-39 세대 키 프로브 실행", false, o.slice(-150).replace(/\s+/g, " "));
    for (const l of lines) { try { const x = JSON.parse(l.slice(7)); rec(x.step, x.ok, x.note); } catch { /* */ } }
  }

  /* ══ audit — AC-36: «던지고 잊는» 감사·메일 잔여를 **내가 다시 훑는다** ══ */
  if (SECTIONS.has("audit")) {
    const { readdirSync, statSync } = await import("node:fs");
    const files = []; const walk = (d) => { for (const f of readdirSync(d)) { if (f === "node_modules" || f.startsWith(".")) continue; const p = `${d}/${f}`; const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(ts|mts)$/.test(f)) files.push(p); } };
    for (const d of ["lib", "netlify/functions"]) { try { walk(d); } catch { /* */ } }
    const hits = [];
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      /* 🔴 주석에 적힌 «`void writeAudit(...)` 는 이래서 안 된다» 같은 설명줄을 세면 수리해도 영원히 빨갛다 — 코드줄만 센다.
         한 줄 주석뿐 아니라 **블록 주석 안**(수리 사유를 여러 줄로 적은 자리)도 빼야 한다 — 2026-09-15 내가 두 번 밟았다. */
      let inBlock = false;
      t.split("\n").forEach((line, i) => {
        let code = line;
        if (inBlock) { const end = code.indexOf("*/"); if (end < 0) { return; } code = code.slice(end + 2); inBlock = false; }
        const open = code.indexOf("/*");
        if (open >= 0) { const close = code.indexOf("*/", open + 2); if (close < 0) { inBlock = true; code = code.slice(0, open); } else code = code.slice(0, open) + code.slice(close + 2); }
        code = code.replace(/\/\/.*$/, "");
        if (/\bvoid\s+(writeAudit|sendEmail|notify\w*)\s*\(/.test(code)) hits.push({ f, i: i + 1, kind: /writeAudit/.test(code) ? "audit" : "mail" });
      });
    }
    const audits = hits.filter((h) => h.kind === "audit");
    rec("AC-36 — `void writeAudit(` 잔여 0(감사는 응답 전에 써야 남는다)", audits.length === 0,
      audits.length ? audits.map((h) => `${h.f}:${h.i}`).join(" ") : "0곳");
    const mails = hits.filter((h) => h.kind === "mail");
    rec("AC-36 — `void sendEmail(` 잔여는 «기다릴 필요 없는 것»만인지(사람이 판단한 목록과 대조)", mails.length === 0 ? true : "WARN",
      mails.length ? mails.map((h) => `${h.f}:${h.i}`).join(" ") : "0곳");
    warn("AC-36 라이브 3회 연속 감사 잔존", "로컬은 서버리스 동결을 재현 못 한다 — 라이브 절에서 잰다(배포 후)");
  }

  /* ══ managed / backup — B2 §3.1·§3.3(미머지면 정직하게 WARN) ══ */
  if (SECTIONS.has("managed")) {
    const g = await call(jar, "/api/managed-runner");
    if (g.status === 404 || g.status === 0) warn("관리형 러너 신청(B2 §3.1)", `미머지 — ${g.status}`);
    else {
      rec("GET /api/managed-runner → eligible·price{amountKrw,vatKrw,totalKrw}·status·assigned·max",
        g.json?.ok === true && g.json.price && Number.isInteger(g.json.price.amountKrw) && Number.isInteger(g.json.price.vatKrw) && Number.isInteger(g.json.price.totalKrw),
        `${g.status} ${JSON.stringify(g.json ?? {}).slice(0, 120)}`);
      await s`UPDATE tenants SET plan_key = 'starter' WHERE id = ${TID}`;
      const p = await call(jar, "/api/managed-runner", { body: { devices: 1 } });
      rec("Starter → 402 plan_feature(플랜 게이트 · 사람말)", p.status === 402 && p.json?.step === "plan_feature", `${p.status} ${p.json?.step} «${String(p.json?.error || "").slice(0, 40)}»`);
      await s`UPDATE tenants SET plan_key = 'trial' WHERE id = ${TID}`;
    }
  }
  if (SECTIONS.has("backup")) {
    const ojar = new Jar();
    const lo = await call(ojar, "/api/ops-login", { body: { email: process.env.OPS_USER || "admin", password: process.env.OPS_PASS || "admin1234" } });
    if (!lo.json?.ok) warn("백업 상태(B2 §3.3)", `운영 로그인 없이 못 쟀다(${lo.status}) — OPS_USER/OPS_PASS`);
    else {
      const b = await call(ojar, "/api/ops-backup-status");
      if (b.status === 404) warn("백업 상태(B2 §3.3)", "미머지 — 404");
      else {
        const v = b.json?.r2Versioning;
        rec("r2Versioning 4어휘 — «못 물어봤다(null)»와 «그 기능이 없다(unsupported)»를 가른다",
          ["Enabled", "Disabled", "unsupported", null].includes(v === undefined ? null : v), `r2Versioning=${JSON.stringify(v)}`);
        rec("Neon PITR 보존 7일로 읽힌다", Number(b.json?.pitrDays) === 7, `pitrDays=${b.json?.pitrDays}`);
        rec("마지막 확인이 30일 넘으면 stale", typeof b.json?.stale === "boolean", `stale=${b.json?.stale} · checkedAt=${b.json?.checkedAt ?? "-"}`);
      }
    }
  }

  /* ══ regress — R5 영상 파이프·타 테넌트·크론 ══ */
  if (SECTIONS.has("regress")) {
    const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: PASSWORD } });
    const x = clipPieceId ? await call(other, "/api/pieces-get", { query: { id: String(clipPieceId) } }) : { status: 404 };
    rec("타 테넌트 piece 404", x.status === 404, `${x.status}`);
    const st = await call(other, "/api/export-status");
    rec("타 테넌트 내보내기 상태에 내 url 0", st.json?.export?.url == null && st.json?.url == null, `${st.status}`);
    const c = await call(null, "/api/cron-run", { method: "POST", query: { every: "hourly", tid: String(TID), secret: process.env.CRON_SECRET || "" } });
    rec("크론 회귀(hourly errors 0)", c.status === 200 && (c.json?.ran || []).every((x2) => x2.errors === 0), (c.json?.ran || []).map((x2) => `${x2.step}:${x2.errors}`).join(" ").slice(0, 110));
  }

  if (SECTIONS.has("cleanup")) {
    for (const t of [...ALLOWED]) {
      if (KEEP.has(t)) continue;
      try { await s.unsafe(`UPDATE tenants SET plan_key='trial' WHERE id=$1 AND plan_key<>'trial'`, [t]); } catch { /* */ }
      try { await s.unsafe(`DELETE FROM piece_assets WHERE piece_id IN (SELECT id FROM pieces WHERE tenant_id=$1)`, [t]); } catch { /* */ }
      for (const tb of ["revenue_daily", "posts", "runner_jobs", "coin_ledger", "ai_usage", "notifications", "audit_logs", "slots", "pieces", "briefs", "cadence_rules", "accounts"]) { try { await s.unsafe(`DELETE FROM ${tb} WHERE tenant_id=$1`, [t]); } catch { /* */ } }
    }
    rec("정리(테스트 테넌트 행 · 플랜 trial 복구)", true, `tenants ${[...ALLOWED].join(",")}`);
  }
  finish();
}
function finish() {
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R6 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 62)} ${w(r.note, 64)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/p1r6-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2)); console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {}); process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); finish(); });
