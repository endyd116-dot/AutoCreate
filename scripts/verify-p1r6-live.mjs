// scripts/verify-p1r6-live.mjs — P1R6 **라이브 게이트**(배포 #5 · 로컬에서 못 재는 것만).
//   BASE_URL=https://autocreate-endyd.netlify.app node scripts/verify-p1r6-live.mjs   (OPS_USER·OPS_PASS·CRON_SECRET)
//   ① 🔴 AC-36 감사 3연속 — 서버리스는 응답 뒤 인보케이션을 닫는다. 로컬(`netlify dev`)은 그 동결을 재현 못 해서
//      «가끔 사라지는 감사»가 안 보인다. 라이브에서 403 을 **세 번** 내고 `ops_forbidden` 이 **3/3** 남는지 본다.
//   ② 공유 카드 PNG 실물 — 열리는지 · **글자가 실제로 그려졌는지**(0원 카드와 금액 다른 카드가 서로 달라야 한다).
//   ③ `clampedFrom` — 디렉터 실경로에서 naver_clip 60초 요청이 30 으로 내려가고 **그 사실이 남는지**(조용한 하향 0).
//   ④ 내보내기 1회 — 라이브에서 ZIP 을 실제로 받아 푼다(C 수리가 라이브에서 도는지).
//   🔴 테스트 테넌트·임시 operator 만 · 끝나면 지운다 · 보존 4집(3·13·109·116) 무접촉 · 운영 admin 비밀번호는 건드리지 않는다.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "https://autocreate-endyd.netlify.app").replace(/\/$/, "");
const OPS_USER = process.env.OPS_USER || "admin", OPS_PASS = process.env.OPS_PASS || "admin1234";
const STAMP = Date.now().toString(36); const PASSWORD = "Cp1Verify2026x";
const results = []; const t0 = Date.now();
const rec = (step, ok, note = "", ev) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, ev }); return !!ok; };
const warn = (step, note, ev) => rec(step, "WARN", note, ev);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
let sql = null;
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const KEEP = new Set([3, 13, 109, 116]);
function zipEntries(buf) {
  let eo = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error("EOCD 없음");
  const count = buf.readUInt16LE(eo + 10); let p = buf.readUInt32LE(eo + 16); const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    out.push({ name: buf.slice(p + 46, p + 46 + nlen).toString("utf8"), method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
function zipRead(buf, e) { const nlen = buf.readUInt16LE(e.lho + 26), elen = buf.readUInt16LE(e.lho + 28); const st = e.lho + 30 + nlen + elen; const raw = buf.slice(st, st + e.csize); return e.method === 0 ? raw : inflateRawSync(raw); }
/** PNG 픽셀에서 «글자가 실제로 그려졌는지» 를 재는 재료 — 색이 몇 가지나 쓰였나(배경 한 색이면 글자가 없다). */
function pngColorSpread(buf) {
  // IDAT 를 풀어 스캔라인 필터를 빼고 대충 세 본다(정확한 복원 대신 «다양성»만 본다).
  const idats = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.slice(p + 4, p + 8).toString("latin1");
    if (type === "IDAT") idats.push(buf.slice(p + 8, p + 8 + len));
    p += 12 + len; if (type === "IEND") break;
  }
  if (!idats.length) return 0;
  let raw; try { raw = inflateSync(Buffer.concat(idats)); } catch { return 0; }
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 997) seen.add(raw[i]);   // 성기게 훑는다(속도) — 값 종류가 곧 «단색 아님»
  return seen.size;
}

async function main() {
  const s = await db();
  const madeTenants = []; let opId = 0;

  /* ══ ① 🔴 AC-36 — 라이브에서 감사가 **3번 다 남는가** ══ */
  const aj = new Jar();
  const admin = await call(aj, "/api/ops-login", { body: { email: OPS_USER, password: OPS_PASS } });
  rec("운영 로그인(admin · 조회·생성용)", admin.json?.ok === true, `${admin.status} role ${admin.json?.role}`);
  if (admin.json?.ok) {
    const opEmail = `c-r6-live-op-${STAMP}@ops.local`;
    const mk = await call(aj, "/api/ops-operators", { body: { email: opEmail, name: "C R6 라이브 운영자", role: "operator" } });
    opId = Number(mk.json?.operator?.id || 0);
    rec("임시 operator 생성(super_admin 은 만들지 않는다 · 끝나면 삭제)", opId > 0, `${mk.status} operator ${opId}`);
    if (opId) {
      const { default: bcrypt } = await import("bcryptjs");
      await s`UPDATE operators SET password_hash = ${await bcrypt.hash("Cr6LiveOp2026x", 10)}, must_change_password = false WHERE id = ${opId}`;
      const oj = new Jar();
      const lo = await call(oj, "/api/ops-login", { body: { email: opEmail, password: "Cr6LiveOp2026x" } });
      rec("operator 로그인", lo.json?.ok === true, `${lo.status} role ${lo.json?.role}`);
      const t1 = new Date(Date.now() - 5_000);
      const codes = [];
      for (let i = 0; i < 3; i++) { const r = await call(oj, "/api/ops-plans"); codes.push(r.status); await sleep(1200); }
      rec("operator → 요금제 403 **3회**(권한 게이트)", codes.every((c) => c === 403), `상태 ${codes.join(",")}`);
      await sleep(3000);   // 감사 쓰기가 응답보다 늦을 수 있다 — 여유를 준다(그래도 안 남으면 그게 결함)
      const aud = await s`SELECT id, created_at FROM audit_logs WHERE action = 'ops_forbidden' AND actor_id = ${opId}
        AND created_at > ${t1.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id`;
      /* 🔴 라이브는 **정확히 3** 이어야 한다. 로컬(`netlify dev`)은 함수가 4xx 를 내면 `.html`·`/index.html` 로 **다시 부른다**(AC-7)
         — 한 번 누른 게 여러 번 들어와 감사가 부풀려진다. 그건 로컬 인공물이지 결함이 아니므로 로컬에선 «≥3» 으로 본다. */
      const local = /localhost|127\.0\.0\.1/.test(BASE);
      rec("🔴 AC-36 — `ops_forbidden` 감사가 **3/3** 남는다(던지고 잊으면 여기서 빠진다)",
        local ? aud.length >= 3 : aud.length === 3,
        `감사 ${aud.length}/3${local && aud.length > 3 ? " (로컬 정적 폴백으로 부풀려짐 · AC-7 · 라이브에선 정확히 3)" : ""} · id ${aud.map((a) => a.id).slice(0, 4).join(",") || "없음"}`,
        `audit_logs ${aud.map((a) => a.id).slice(0, 4).join(",")}`);
      // ops-runners — 메인이 머지 충돌을 푼 자리(권한·감사)
      const t2 = new Date(Date.now() - 2_000);
      const rr = await call(oj, "/api/ops-runners");
      const aud2 = await s`SELECT id FROM audit_logs WHERE action = 'ops_forbidden' AND actor_id = ${opId} AND created_at > ${t2.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
      rec("ops-runners — operator 권한 판정이 «통과 또는 403+감사» 중 하나로 일관",
        rr.status === 200 || (rr.status === 403 && aud2.length >= 1),
        `${rr.status} ${rr.status === 403 ? `감사 ${aud2.length}건` : `목록 ${Array.isArray(rr.json?.devices) ? rr.json.devices.length : "-"}`}`);
    }
  }

  /* ══ 고객 테스트 집 ══ */
  const jar = new Jar(); const email = `c+r6live-${STAMP}@autocreate.test`;
  const reg = await call(jar, "/api/auth-register", { body: { email, password: PASSWORD, name: "C R6 라이브", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); const TID = Number(me.json?.tenant?.id || 0);
  if (TID && !KEEP.has(TID)) madeTenants.push(TID);
  rec("라이브 가입", reg.json?.ok === true && TID > 0, `tid ${TID} · mailSent ${reg.json?.mailSent}`);
  if (!TID) return finish(madeTenants, opId);
  await call(jar, "/api/onboarding", { body: { kinds: ["text", "video"], channels: ["naver_blog", "naver_clip"] } });
  await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 200, ${"r6live:" + STAMP}, 'R6 라이브 게이트')`;
  const [clipAcc] = await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
    VALUES (${TID}, 'naver_clip', ${"c_r6l_clip_" + STAMP}, 'session', 'active', ${`t${TID}-naver_clip`}) RETURNING id`;

  /* ══ ② 공유 카드 PNG 실물 ══ */
  const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  await s`INSERT INTO revenue_daily (tenant_id, source, day, amount_krw, currency, freshness, raw)
    VALUES (${TID}, 'adpost', ${day}::date, 87650, 'KRW', 'manual', ${s.json({ note: "R6 라이브" })})`;
  const card = await call(jar, "/api/share-card", { query: { month } });
  if (card.json?.ok && card.json.imageUrl) {
    const img = await fetch(card.json.imageUrl).catch(() => null);
    const bytes = img?.ok ? Buffer.from(await img.arrayBuffer()) : null;
    const isPng = !!bytes && bytes[0] === 0x89 && bytes.slice(1, 4).toString("latin1") === "PNG";
    const w = isPng ? bytes.readUInt32BE(16) : 0, h = isPng ? bytes.readUInt32BE(20) : 0;
    rec("공유 카드 PNG 가 라이브에서 열린다(시그니처·크기)", isPng && w === 1080 && h === 1080 && bytes.length > 10_000, `${img?.status} ${bytes?.length}B · ${w}×${h}`);
    if (isPng) {
      mkdirSync("_shots", { recursive: true });
      const out = `_shots/r6-live-share-card-${STAMP}.png`;
      writeFileSync(out, bytes);
      const spread = pngColorSpread(bytes);
      rec("카드에 **글자가 실제로 그려졌다**(단색 판이 아니다 · 픽셀 값 다양도)", spread >= 16, `값 종류 ${spread} · 저장 ${out}`, out);
      // 금액이 다르면 그림도 달라야 한다 — 같은 파일이면 «글자를 안 그린 판» 이다
      await s`UPDATE revenue_daily SET amount_krw = 12340 WHERE tenant_id = ${TID}`;
      const card2 = await call(jar, "/api/share-card", { query: { month, nocache: String(Date.now()) } });
      let same = null;
      if (card2.json?.ok && card2.json.imageUrl) {
        const img2 = await fetch(card2.json.imageUrl).catch(() => null);
        const b2 = img2?.ok ? Buffer.from(await img2.arrayBuffer()) : null;
        if (b2) same = Buffer.compare(bytes, b2) === 0;
      }
      rec("금액이 바뀌면 카드 그림도 바뀐다(숫자가 실제로 인쇄된다)", same === false, same === null ? "두 번째 카드를 못 받아 못 쟀다" : same ? "🔴 두 판이 완전히 같다" : "다르다");
      warn("한글 글리프가 안 깨지는지", `기계로는 «단색 아님»까지만 잴 수 있다 — **사람 눈 확인용 파일**을 남겼다: ${out}`, out);
    }
  } else rec("공유 카드 생성", false, `${card.status} ${card.json?.step} «${String(card.json?.error || "").slice(0, 50)}»`);

  /* ══ ③ clampedFrom — 디렉터 실경로 ══ */
  let topicId = 0;
  for (let i = 0; i < 12 && !topicId; i++) {
    const tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
    const list = tl.json?.topics || [];
    if (list.length) { topicId = Number(list[0].id); break; }
    if (i === 0) await call(jar, "/api/topics-refresh", { body: {} });
    await sleep(8000);
  }
  if (!topicId) warn("clampedFrom(디렉터 실경로)", "소재를 못 얻어 못 쟀다");
  else {
    const pr = await call(jar, "/api/director-propose", { body: { topicId } });
    const specs = pr.json?.brief?.pieces || [];
    const clip = specs.find((p) => p.channel === "naver_clip" && p.video);
    if (!clip) warn("clampedFrom(디렉터 실경로)", `naver_clip 영상 제안이 없어 못 쟀다(제안 ${specs.length}건: ${specs.map((p) => `${p.channel}/${p.kind ?? "post"}`).join(",")})`);
    else {
      // ⓐ 기본 제안(사용자가 고른 적 없음) — 채널 상한대로 30초. 🔴 이때 `clampedFrom` 은 **없는 게 맞다**(알릴 것이 없다).
      rec("naver_clip 기본 제안은 30초 · 사용자가 고른 적 없으니 clampedFrom 없음(설명할 것이 없다)",
        Number(clip.video.seconds) === 30 && clip.video.clampedFrom === undefined,
        `seconds ${clip.video.seconds} · clampedFrom ${clip.video.clampedFrom ?? "없음"} · format ${clip.video.format}`);
      // ⓑ 🔴 사용자가 손보기에서 **60초를 직접 고르면** 30 으로 내려가고 **그 사실을 남긴다**(조용한 하향 0 · 계약 §2.3).
      const cf = await call(jar, "/api/director-confirm", { body: { briefId: pr.json.brief.id, pieces: [{ key: clip.key, video: { seconds: 60 } }] } });
      const pid = (cf.json?.pieceIds || []).map(Number).filter(Boolean);
      const rows = pid.length ? await s.unsafe(`SELECT id, meta->'video'->>'seconds' AS sec, meta->'video'->>'clampedFrom' AS cfrom FROM pieces WHERE tenant_id=$1 AND kind='video' AND id = ANY($2)`, [TID, pid]) : [];
      const v = rows[0];
      rec("🔴 손보기에서 60초를 골라도 클립은 30 으로 내려가고 **그 사실을 말한다**(clampedFrom 60)",
        Number(v?.sec) === 30 && Number(v?.cfrom) === 60,
        `${cf.status} piece ${v?.id ?? "-"} · seconds ${v?.sec ?? "-"} · clampedFrom ${v?.cfrom ?? "없음"}`, v?.id ? `piece ${v.id}` : undefined);
    }
  }

  /* ══ ④ 내보내기 1회 — 라이브에서 ZIP 을 받아 푼다 ══ */
  const from = new Date(Date.now() + 9 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10);
  const st = await call(jar, "/api/export-start", { body: { kinds: ["post", "revenue"], from, to: day } });
  rec("내보내기 시작 202(라이브)", st.status === 202 && st.json?.started === true, `${st.status} ${JSON.stringify(st.json ?? {}).slice(0, 70)}`);
  let ex = null; const dl = Date.now() + 240_000;
  while (Date.now() < dl) { const g = await call(jar, "/api/export-status"); ex = g.json?.export ?? g.json; if (ex && ex.running === false && (ex.url || ex.error)) break; await sleep(5000); }
  rec("🔴 배경 함수가 **자기를 거절하지 않는다**(C 수리가 라이브에서 돈다)", !!ex && ex.running === false && !!ex.url,
    `running ${ex?.running} · bytes ${ex?.bytes} · progress ${JSON.stringify(ex?.progress ?? {})} · error ${ex?.error ?? "-"}`);
  if (ex?.url) {
    const res = await fetch(ex.url).catch(() => null);
    const buf = res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
    let names = [];
    try { names = buf ? zipEntries(buf).map((e) => e.name) : []; } catch { /* */ }
    rec("라이브 ZIP 을 실제로 받아 풀었다", !!buf && names.length > 0 && names.some((n) => /manifest\.json$/.test(n)), `${buf?.length}B · ${names.slice(0, 5).join(", ").slice(0, 90)}`);
    const csvEntry = buf ? zipEntries(buf).find((e) => /\.csv$/i.test(e.name)) : null;
    if (csvEntry && buf) { const raw = zipRead(buf, csvEntry); rec("수익 CSV BOM·«(KST)»(라이브)", raw[0] === 0xef && /\(KST\)/.test(raw.toString("utf8")), `${csvEntry.name}`); }
  }
  await finish(madeTenants, opId);
}
async function finish(tenants = [], opId = 0) {
  const s = sql;
  if (s) {
    /* [P1R7 §3.5] 공용 teardown — 예전엔 **행만 지우고 집(tenants)은 남겼다**(그래서 라이브에 테스트 테넌트가 쌓였다 · 대청소 88집).
       이제 하니스가 만든 집은 통째로 지운다. 보존 id(3·13·109·116·198)와 «살아 있는 구독»은 `_teardown.mjs` 가 먼저 거부한다. */
    try {
      const { teardownRun } = await import("./_teardown.mjs");
      const r = await teardownRun(s, { tenants, operatorIds: opId ? [opId] : [], label: "P1R6-live" });
      rec("정리(teardown)", !r.failed, `${r.text} · operator ${opId || "-"}`);
    } catch (e) { rec("정리(teardown)", false, String(e?.message ?? e).slice(0, 160)); }
  }
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R6 라이브 게이트 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(128)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 60)} ${w(r.note, 62)}`);
  console.log(`${"─".repeat(128)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true });
  writeFileSync(`_verify/p1r6-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  if (s) s.end().catch(() => {});
  process.exit(fails ? 1 : 0);
}
main().catch(async (e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); await finish([], 0); });
