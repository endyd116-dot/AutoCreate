/**
 * scripts/verify-r5-render.mts — 🔴 **영상 렌더 전 구간 실증**(계약 P1R5 §2.1~2.2 · §5).
 *
 *   ══ 쓰는 법(C 검증 재현용) ══
 *     npx --yes tsx --env-file=.env scripts/verify-r5-render.mts            # 두 경로 다 잰다(무음 · BGM) · 끝나면 정리
 *     npx --yes tsx --env-file=.env scripts/verify-r5-render.mts --keep     # 테넌트·자산 남김(행을 직접 볼 때)
 *     npx --yes tsx --env-file=.env scripts/verify-r5-render.mts --only=bgm # 한 경로만(silent|bgm)
 *
 *   준비물(둘 다 없으면 즉시 정직하게 멈춘다 · 조용한 실패 0):
 *     · **ffmpeg + ffprobe** — 없으면 러너가 렌더 잡을 아예 claim 하지 않는다(`caps.ffmpeg:false`). 설치는 `runner/install.md`.
 *     · **R2 5키**(`.env` R2_*) — 없으면 시작하자마자 exit 2.
 *   걸리는 시간 ≈ 40초/경로. 인자 없이 돌리면 남는 것 0. 토큰·기기 등록·로컬 함수 서버는 스크립트가 알아서 만든다.
 *
 *   ══ 두 경로를 **반드시 둘 다** 잰다 ══
 *     ① silent — narration 0 · bgm null. **AM #907**(`amix=inputs=0` 이면 ffmpeg 가 종료코드 -34 로 죽는다) 방어 확인.
 *     ② bgm    — BGM 1입력(짧은 wav 를 `-stream_loop -1` 로 늘려 씀). 🔴 **2026-09-14 라이브 회귀가 여기서만 잡힌다**:
 *                `-t maxSeconds` 였을 때 무한 BGM 이 maxSeconds 까지 늘어나 **장면 끝~maxSeconds 구간에 «정지 화면 + 음악» 꼬리**가 붙었다
 *                (영상 12s · 컨테이너 15s). 무음 경로에서는 longest=나레이션이라 **영영 드러나지 않는다**.
 *     그래서 매 경로마다 **ffprobe 로 컨테이너·영상·오디오 세 길이가 같은지** 잰다(러너 보고를 믿지 않는다).
 *     ⚠️ 잔가시: `volumedetect` 같은 측정 출력은 ffmpeg **stderr** 로 나온다(stdout 만 받으면 늘 «측정 실패»).
 *
 *   ══ 판정을 두 가지로 나눠 읽어라(중요) ══
 *     ① **렌더 판정** = 종료코드 — 이 스크립트가 책임지는 범위(B2). 굽고 올렸고 **R2 HEAD 실존** + **길이 일치**인가.
 *     ② **심사 판정** = «심사 축»(B-1 `judgeVideo`) — 여기서 P0 가 떠도 **렌더 실패가 아니다**.
 *        🔴 알려진 것: `frames_not_blank` 는 이 하니스에서 **항상 ✗**(합성 재료를 비전이 «빈 프레임»으로 본다).
 *           **하니스 한계이지 제품 결함이 아니다** — 그래서 piece 는 failed 로 끝난다. «렌더 실패»로 적으면 기록이 틀린다.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync as zlibSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { r2Put, r2Head, r2PresignGet, r2Configured } from "../lib/r2";
import { registerDevice } from "../lib/runner-jobs";
import { DISCLOSURE_TEXT } from "../lib/disclosure";
import { enqueueRender } from "../lib/video/render-queue";
import handler, { config } from "../netlify/functions/runner";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 최소 PNG 인코더(외부 의존 0). 🔴 단색이 아니라 **디테일 있는** 그림 — 단색은 31KB 로 줄어 «빈 영상» 오판을 부른다(실측). */
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = new Int32Array(256).map((_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (buf: Buffer) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const grad = y / h, checker = ((x >> 5) + (y >> 5)) & 1 ? 28 : 0;
      const noise = ((x * 2654435761 + y * 40503) >>> 16) & 31;
      raw[o] = Math.min(255, Math.round(rgb[0] * (0.45 + grad * 0.55)) + checker + noise);
      raw[o + 1] = Math.min(255, Math.round(rgb[1] * (0.45 + (1 - grad) * 0.55)) + checker + noise);
      raw[o + 2] = Math.min(255, Math.round(rgb[2] * (0.5 + grad * 0.5)) + checker + noise);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * 최소 WAV(16bit PCM mono 44.1k) — 시험용 BGM.
 *   🔴 **일부러 본체보다 짧게**(3초) 만든다. 그래야 `-stream_loop -1` 로 늘려 쓰는 경로가 실제로 돌고,
 *      «무한 BGM 이 길이를 끌고 가는» 회귀가 재현된다.
 */
function makeWav(seconds: number, freq = 220): Buffer {
  const rate = 44_100, samples = Math.round(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const env = Math.min(1, i / (rate * 0.05), (samples - i) / (rate * 0.05));   // 톡 소리 방지(페이드)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9_000 * env), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** ffprobe 경로 — ffmpeg 사다리와 같은 자리에서 찾는다. */
function resolveFfprobe(): string {
  const cands = [
    process.env.FFPROBE_PATH,
    process.env.FFMPEG_PATH ? String(process.env.FFMPEG_PATH).replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : null,
    "ffprobe",
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\ffprobe.exe` : null,
  ].filter(Boolean) as string[];
  for (const c of cands) {
    try { const r = spawnSync(c, ["-version"], { stdio: "ignore" }); if (!r.error && r.status === 0) return c; } catch { /* 다음 */ }
  }
  return "";
}

interface Durations { container: number | null; video: number | null; audio: number | null }
/** 🔴 러너 보고를 믿지 않고 **실제 파일**을 잰다(컨테이너·영상·오디오). ffprobe 는 presigned URL 을 직접 읽는다. */
function probeDurations(probe: string, url: string): Durations {
  const r = spawnSync(probe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", url],
    { encoding: "utf8", maxBuffer: 8 << 20 });
  const out: Durations = { container: null, video: null, audio: null };
  try {
    const j = JSON.parse(String(r.stdout || "{}")) as { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] };
    out.container = j.format?.duration ? Number(j.format.duration) : null;
    for (const s of j.streams ?? []) {
      const d = s.duration ? Number(s.duration) : null;
      if (s.codec_type === "video" && out.video === null) out.video = d;
      if (s.codec_type === "audio" && out.audio === null) out.audio = d;
    }
  } catch { /* 파싱 실패 = null 들 */ }
  return out;
}

function startServer(): Promise<{ port: number; close: () => void }> {
  const paths: string[] = Array.isArray(config?.path) ? config.path : [String(config?.path ?? "")];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!paths.includes(url.pathname)) { res.writeHead(404).end('{"ok":false,"step":"harness"}'); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    try {
      const out = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method ?? "GET", headers, ...(body.length && req.method !== "GET" ? { body } : {}) }));
      res.writeHead(out.status, { "Content-Type": "application/json" }).end(await out.text());
    } catch (e) {
      res.writeHead(500).end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ port: (server.address() as { port: number }).port, close: () => server.close() });
  }));
}

const BODY_MS = 12_000;        // 장면 합계
const MAX_SECONDS = 15;        // 규격 상한 — 🔴 본체(12s)보다 **크게** 둬야 «꼬리» 회귀가 재현된다
const DISC = DISCLOSURE_TEXT.coupang;

async function runScenario(port: number, withBgm: boolean, keep: boolean): Promise<boolean> {
  const label = withBgm ? "bgm" : "silent";
  const stamp = Date.now();
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${`r5r${label}${stamp}`.slice(0, 40)}, ${`R5 렌더 실증(${label})`}, 'pro', 'active') RETURNING id`);
  const tid = n(t?.id);
  console.log(`\n━━ [${label}] 테넌트 ${tid} ━━`);
  console.log(withBgm
    ? "   BGM 1입력(3초 wav 를 -stream_loop -1 로 늘림) — 🔴 «정지 화면 꼬리» 회귀가 여기서만 잡힌다."
    : "   무음(narration 0 · bgm null) — AM #907 `amix=inputs=0` 방어를 탄다.");

  let ok = false;
  try {
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, format, title, body, blocks, meta, status)
      VALUES (${tid}, 'youtube_shorts', 'video', 'info', ${`[R5 실증:${label}] ${stamp}`}, ${"<p>렌더 실증</p>"}, ${jsonb([])}, ${jsonb({ stage: "clips" })}, 'generating') RETURNING id`);
    const pieceId = n(p?.id);

    const keys: string[] = [];
    for (const [i, rgb] of ([[230, 90, 40], [40, 90, 230]] as [number, number, number][]).entries()) {
      const key = `verify/r5/${tid}/${pieceId}/scene-${i}.png`;
      await r2Put(key, makePng(1080, 1920, rgb), "image/png");
      keys.push(key);
    }
    let bgmKey = "";
    if (withBgm) {
      bgmKey = `verify/r5/${tid}/${pieceId}/bgm.wav`;
      await r2Put(bgmKey, makeWav(3), "audio/wav");
    }
    console.log(`   재료 R2 ✓ (장면 ${keys.length}${withBgm ? " · BGM 3초" : ""})`);

    const reg = await registerDevice(tid, `렌더 실증 PC(${label})`, "own");
    const payload = {
      pieceId, tenantId: tid,
      out: { w: 1080, h: 1920, fps: 30, maxSeconds: MAX_SECONDS, crf: 20 },
      scenes: [
        { idx: 0, startMs: 0, endMs: BODY_MS / 2, imageKey: keys[0], motion: "kenburns", captionIdx: [0] },
        { idx: 1, startMs: BODY_MS / 2, endMs: BODY_MS, imageKey: keys[1], motion: "kenburns", captionIdx: [1] },
      ],
      captions: { preset: "keyword_center", phrases: [
        { idx: 0, text: "겨울 이불\n집에서 빨까?", startMs: 200, endMs: 5800, keyword: "집에서" },
        { idx: 1, text: "코인워시가\n싸게 먹혔어요", startMs: 6200, endMs: 11800, keyword: "싸게" },
      ], srtKey: "" },
      audio: {
        narration: [],
        bgm: withBgm ? { key: bgmKey, gainDb: -18 } : null,
        sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 },
      },
      overlay: { badge: { text: "광고", corner: "tr" }, safeZone: { top: 220, bottom: 300 }, endcard: null },
      disclosureCaption: { text: "광고 포함 · 파트너스 수수료", untilMs: 3000 },
    };
    // B 의 gen.ts 와 같은 순서: meta.render = payload 를 먼저 쓰고 렌더를 요청한다(심사기가 그 payload 를 읽는다).
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ render: payload, hook: "겨울 이불 집에서 빨까?", description: DISC, disclosure: DISC, affiliate: { provider: "coupang" }, adDisclosure: true })}, updated_at = NOW() WHERE id = ${pieceId}`);
    const enq = await enqueueRender(pieceId, payload as never);
    console.log(`   piece ${pieceId} · render 잡 ${enq.jobId}`);

    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "runner", "ac-runner.mjs"), "--once"], {
        cwd: path.join(ROOT, "runner"), stdio: "inherit",
        env: { ...process.env, AC_SERVER: `http://127.0.0.1:${port}`, AC_RUNNER_TOKEN: reg.device.token, RUNNER_SHOTS: "1" },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });

    const jobs = await q(sql`SELECT id, status, error_kind, result FROM runner_jobs WHERE tenant_id = ${tid} ORDER BY id`);
    for (const j of jobs) console.log(`   job #${j.id} → ${j.status}${j.error_kind ? ` (${j.error_kind})` : ""}`);

    const assets = await q(sql`SELECT kind, r2_key FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${pieceId} ORDER BY sort`);
    let videoKey = "";
    for (const a of assets) {
      const h = await r2Head(String(a.r2_key));
      console.log(`      · ${a.kind} → R2 HEAD ${h ? `${(h.bytes / 1024).toFixed(0)}KB` : "✗ 없음"}`);
      if (String(a.kind) === "video" && h && h.bytes > 0) { videoKey = String(a.r2_key); ok = true; }
    }

    /* 🔴 길이 검사 — 러너가 보고한 숫자가 아니라 **파일**을 잰다. 세 길이가 갈라지면 «정지 화면 꼬리»다. */
    if (videoKey) {
      const probe = resolveFfprobe();
      if (!probe) console.log("   ⚠️ ffprobe 없음 — 길이 검사를 건너뛴다(설치 권함).");
      else {
        const d = probeDurations(probe, await r2PresignGet(videoKey, 900));
        const fmt = (v: number | null) => (v === null ? "?" : `${v.toFixed(2)}s`);
        const vals = [d.container, d.video, d.audio].filter((v): v is number => v !== null);
        const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
        const lenOk = vals.length > 0 && spread <= 0.35 && Math.abs((d.video ?? 0) - BODY_MS / 1000) <= 0.35;
        console.log(`   ffprobe 컨테이너 ${fmt(d.container)} · 영상 ${fmt(d.video)} · 오디오 ${fmt(d.audio)} (장면 합계 ${(BODY_MS / 1000).toFixed(2)}s)`);
        console.log(lenOk
          ? "      ✓ 세 길이 일치 — 정지 화면 꼬리 없음"
          : `      ✗ 길이 불일치(차 ${spread.toFixed(2)}s) — maxSeconds(${MAX_SECONDS}s)까지 늘어난 꼬리 의심`);
        if (!lenOk) ok = false;
      }
    }

    const [gr] = await q(sql`SELECT gate_report FROM pieces WHERE id = ${pieceId}`);
    const axes = ((gr?.gate_report as Record<string, unknown> | null)?.axes ?? []) as { key: string; pass: boolean; grade: string }[];
    const p0 = axes.filter((a) => !a.pass && a.grade === "P0").map((a) => a.key);
    console.log(`   렌더 판정: ${ok ? "✓ 통과" : "✗ 실패"}${axes.length ? ` · 심사: ${p0.length ? `P0 ${p0.join(",")}` : "통과"}` : ""}${p0.includes("frames_not_blank") ? "  (frames_not_blank = 하니스 한계 · 제품 결함 아님)" : ""}`);
    void code;
  } finally {
    if (!keep) {
      for (const table of ["runner_jobs", "runner_devices", "piece_assets", "pieces", "notifications", "audit_logs"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tid}`).catch(() => {});
    } else console.log(`   (테넌트 ${tid} 유지)`);
  }
  return ok;
}

async function main() {
  if (!r2Configured()) { console.error("\n  ✗ R2 미설정 — 렌더 결과를 올릴 곳이 없어요(.env R2_* 확인).\n"); process.exit(2); }
  const keep = process.argv.includes("--keep");
  const only = String(process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
  const { port, close } = await startServer();
  console.log(`\n── P1R5 렌더 실증 (로컬 서버 127.0.0.1:${port}) ──`);

  const results: Record<string, boolean> = {};
  try {
    if (only !== "bgm") results.silent = await runScenario(port, false, keep);
    if (only !== "silent") results.bgm = await runScenario(port, true, keep);
  } finally {
    close();
    await pgClient.end({ timeout: 5 });
  }
  const allOk = Object.values(results).every(Boolean);
  console.log(`\n── 렌더 판정 종합 ── ${Object.entries(results).map(([k, v]) => `${k}:${v ? "✓" : "✗"}`).join(" · ")}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
