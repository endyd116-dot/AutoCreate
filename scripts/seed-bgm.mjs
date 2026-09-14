/**
 * scripts/seed-bgm.mjs — 배경음악 시드(계약 P1R5 §1.4c(3) · §4 B 몫).
 *   FreePD(퍼블릭 도메인 · CC0) 곡을 받아 R2 `autocreate/bgm/` 에 올리고 **라이선스 메타를 같이 남긴다**.
 *   사용: node scripts/seed-bgm.mjs            (받고 올린다 · 이미 있으면 건너뜀)
 *         node scripts/seed-bgm.mjs --check    (HEAD 만 · 주소가 살아 있는지 빠르게 · 내려받지도 올리지도 않는다 · R2 자격 불요)
 *         node scripts/seed-bgm.mjs --dry      (통째로 받아 보기만 · R2 쓰기 0)
 *         node scripts/seed-bgm.mjs --force    (이미 있어도 다시 올린다)
 *
 *   ══ 멱등 ══ 같은 키가 R2 에 있으면 다시 올리지 않는다(HEAD 확인). 매니페스트는 **항상** 다시 쓴다(곡이 늘면 반영돼야 한다).
 *   ══ 정직 ══ 받지 못한 곡은 **조용히 빠지지 않는다** — 실패 목록을 찍고 종료코드 1. 곡 하나라도 못 받으면 매니페스트에도 안 들어간다.
 *   ══ 라이선스 ══ 매니페스트 `license` 는 사람이 검증할 재료다. 🔴 `BGM_LICENSE_VERIFIED=1` env 는 **사장님·메인이** 시드 결과를
 *      눈으로 확인한 뒤 꽂는다 — 그 전까지 `lib/video/bgm.ts resolveBgm` 은 null(무음)을 돌려준다. 스크립트가 스스로 켜지 않는다.
 *
 *   env: R2_ACCOUNT_ID|R2_ENDPOINT · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET (`.env` 자동 로드)
 */
import { existsSync, readFileSync } from "node:fs";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }

const DRY = process.argv.includes("--dry");
const CHECK = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");
const PREFIX = "autocreate/bgm";
const MANIFEST_KEY = `${PREFIX}/manifest.json`;

/**
 * 카탈로그 — FreePD 정본(Kevin MacLeod 외 · 퍼블릭 도메인 헌정 PD/CC0).
 *   🔴 **원 배포처 freepd.com 은 폐쇄됐다**(AM 2026 실측 · 이 표를 그 주소로 두면 전건 404). 시드 소스는 **archive.org 공식 미러**
 *      (item `freepd` = "Free Public Domain Music" · 카테고리 폴더가 원 카탈로그와 1:1).
 *   AM 원본: ../AutoMarketing/lib/video-render.ts `BGM_LIBRARY`(★D7-B 2026-08-03 «BGM이 항상 똑같아» 수리 · 실존 HEAD 200 검증 그대로 이식).
 *   무드 4종(uplift·calm·focus·warm) × 3곡 = **무드당 3곡이라 연속 3건이 서로 다른 곡**이 된다(AM 이 그래서 3곡으로 맞췄다).
 *   `mood` 는 `lib/video/bgm.ts resolveBgm` 이 고르는 축 · R2 키는 `autocreate/bgm/<mood>-<n>.mp3`(메인 지정).
 *   곡을 늘릴 때는 이 표에만 줄을 더한다(코드 무변경).
 */
const SRC = "https://archive.org/download/freepd/";
const CATALOG = [
  { slug: "uplift-1", title: "City Sunshine (Kevin MacLeod)", mood: "uplift", url: `${SRC}upbeat/City%20Sunshine.mp3` },
  { slug: "uplift-2", title: "Funshine (Kevin MacLeod)",      mood: "uplift", url: `${SRC}upbeat/Funshine.mp3` },
  { slug: "uplift-3", title: "Advertime",                     mood: "uplift", url: `${SRC}upbeat/Advertime.mp3` },
  { slug: "calm-1",   title: "Lovely Piano Song",             mood: "calm",   url: `${SRC}romantic/Lovely%20Piano%20Song.mp3` },
  { slug: "calm-2",   title: "Nostalgic Piano",               mood: "calm",   url: `${SRC}romantic/Nostalgic%20Piano.mp3` },
  { slug: "calm-3",   title: "Study and Relax",               mood: "calm",   url: `${SRC}featured/Study%20and%20Relax.mp3` },
  { slug: "focus-1",  title: "Arpent",                        mood: "focus",  url: `${SRC}electronic/Arpent.mp3` },
  { slug: "focus-2",  title: "Meditating Beat",               mood: "focus",  url: `${SRC}electronic/Meditating%20Beat.mp3` },
  { slug: "focus-3",  title: "Backbeat",                      mood: "focus",  url: `${SRC}electronic/Backbeat.mp3` },
  { slug: "warm-1",   title: "Happy Whistling Ukulele",       mood: "warm",   url: `${SRC}upbeat/Happy%20Whistling%20Ukulele.mp3` },
  { slug: "warm-2",   title: "Be Chillin",                    mood: "warm",   url: `${SRC}upbeat/Be%20Chillin.mp3` },
  { slug: "warm-3",   title: "Relaxing Ballad",               mood: "warm",   url: `${SRC}upbeat/Relaxing%20Ballad.mp3` },
];
const LICENSE = {
  source: "FreePD 정본 카탈로그 — 시드는 archive.org 공식 미러(item: freepd · 원 배포처 freepd.com 은 2026 폐쇄)",
  mirror: SRC,
  license: "PD/CC0 — 퍼블릭 도메인 헌정(상업 사용 가 · 크레딧 불요 · 로열티 프리)",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  attributionRequired: false,
  note: "전곡 우리 R2 로 1회 시드해 외부 의존 0 으로 서빙한다. 실사용 게이트는 BGM_LICENSE_VERIFIED(사람 확인 후 ON).",
};

function r2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey || !process.env.R2_BUCKET) {
    console.error("R2 환경변수가 없습니다 — R2_ACCOUNT_ID(또는 R2_ENDPOINT)·R2_ACCESS_KEY_ID·R2_SECRET_ACCESS_KEY·R2_BUCKET");
    process.exit(2);
  }
  return { client: new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: false }), bucket: process.env.R2_BUCKET };
}

async function head(client, bucket, key) {
  try { const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return { bytes: Number(r.ContentLength || 0) }; }
  catch { return null; }
}

async function fetchTrack(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "AutoCreate-bgm-seed/1.0" } });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const type = String(r.headers.get("content-type") || "");
    const buf = Buffer.from(await r.arrayBuffer());
    // 정직 검사 — 404 안내 HTML 을 mp3 로 착각해 올리지 않는다.
    if (!/audio|octet-stream/i.test(type) && !(buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) && !(buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
      return { ok: false, reason: `오디오가 아님(content-type ${type || "없음"} · 앞 4바이트 ${buf.subarray(0, 4).toString("hex")})` };
    }
    if (buf.length < 100_000) return { ok: false, reason: `너무 작음(${buf.length}B)` };
    return { ok: true, buf, type: /audio/i.test(type) ? type : "audio/mpeg" };
  } catch (e) {
    return { ok: false, reason: e?.name === "AbortError" ? "timeout_90s" : String(e?.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

/** --check — HEAD 만 던져 주소가 살아 있는지 본다(archive.org 는 302 로 노드 서버에 넘긴다 · fetch 가 따라간다). */
async function headTrack(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "AutoCreate-bgm-seed/1.0" } });
    const type = String(r.headers.get("content-type") || "");
    const len = Number(r.headers.get("content-length") || 0);
    if (!r.ok) return { ok: false, status: r.status, reason: `HTTP ${r.status}` };
    if (!/audio|octet-stream/i.test(type)) return { ok: false, status: r.status, reason: `오디오가 아님(content-type ${type || "없음"})` };
    return { ok: true, status: r.status, bytes: len, type, finalUrl: r.url };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.name === "AbortError" ? "timeout_30s" : String(e?.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

const main = async () => {
  if (CHECK) {
    console.log(`HEAD 확인 — ${CATALOG.length}곡 (미러 ${SRC})\n`);
    let bad = 0;
    for (const t of CATALOG) {
      const h = await headTrack(t.url);
      if (h.ok) console.log(`  ✅ ${t.slug.padEnd(9)} ${String(h.status)} ${String(Math.round((h.bytes || 0) / 1024)).padStart(6)}KB  ${h.type.padEnd(12)} ${t.title}`);
      else { bad++; console.log(`  ❌ ${t.slug.padEnd(9)} ${h.reason}  ${t.url}`); }
    }
    console.log(`\n${bad ? `❌ ${CATALOG.length - bad}/${CATALOG.length} — 주소가 죽은 곡 ${bad}건(CATALOG 를 고치세요)` : `✅ ${CATALOG.length}/${CATALOG.length} HEAD 200 — 본실행 가능`}`);
    process.exit(bad ? 1 : 0);
  }
  const { client, bucket } = DRY ? { client: null, bucket: "(dry)" } : r2();
  const tracks = [], failed = [];
  for (const t of CATALOG) {
    const key = `${PREFIX}/${t.slug}.mp3`;
    if (!DRY && !FORCE) {
      const h = await head(client, bucket, key);
      if (h && h.bytes > 0) { console.log(`· ${t.slug} 이미 있음(${Math.round(h.bytes / 1024)}KB) — 건너뜀`); tracks.push({ ...t, key, bytes: h.bytes, license: LICENSE }); continue; }
    }
    process.stdout.write(`↓ ${t.slug} ... `);
    const g = await fetchTrack(t.url);
    if (!g.ok) { console.log(`실패(${g.reason})`); failed.push({ slug: t.slug, url: t.url, reason: g.reason }); continue; }
    if (DRY) { console.log(`OK ${Math.round(g.buf.length / 1024)}KB (dry — 올리지 않음)`); tracks.push({ ...t, key, bytes: g.buf.length, license: LICENSE }); continue; }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: g.buf, ContentType: g.type, CacheControl: "public, max-age=31536000, immutable" }));
    console.log(`올림 ${Math.round(g.buf.length / 1024)}KB → ${key}`);
    tracks.push({ ...t, key, bytes: g.buf.length, license: LICENSE });
  }

  const manifest = { version: 1, updatedAt: new Date().toISOString(), prefix: PREFIX, defaultGainDb: -18, license: LICENSE, tracks: tracks.map(({ url, ...t }) => ({ ...t, sourceUrl: url })) };
  if (!DRY) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY, Body: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), ContentType: "application/json; charset=utf-8", CacheControl: "no-cache" }));
    console.log(`\n매니페스트 → ${MANIFEST_KEY} (곡 ${tracks.length})`);
  } else {
    console.log(`\n(dry) 매니페스트 미리보기 — 곡 ${tracks.length}\n${JSON.stringify(manifest, null, 2).slice(0, 800)}`);
  }

  if (failed.length) {
    console.error(`\n🔴 받지 못한 곡 ${failed.length}건 — 매니페스트에 넣지 않았습니다(조용한 누락 0):`);
    for (const f of failed) console.error(`   - ${f.slug}: ${f.reason}  ${f.url}`);
    console.error("   URL 이 바뀌었으면 CATALOG 를 고치고 다시 돌리세요.");
  }
  console.log(`\n다음 단계: 곡을 들어 보고 라이선스를 확인한 뒤 \`BGM_LICENSE_VERIFIED=1\` 을 env 에 넣으세요.`);
  console.log(`  그 전까지는 \`lib/video/bgm.ts resolveBgm\` 이 null 을 돌려주고 영상은 **무음**으로 나갑니다(정직 경로).`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error("seed-bgm 실패:", e); process.exit(1); });
