/**
 * scripts/verify-r5-render.mts — 🔴 **영상 렌더 전 구간 실증**(계약 P1R5 §2.1~2.2 · §5).
 *
 *   `npx tsx --env-file=.env scripts/verify-r5-render.mts [--keep]`
 *
 *   한 프로세스 안에서 전부 한다:
 *     ① 로컬 함수 서버(`netlify/functions/runner.ts` default export 그대로)
 *     ② 테넌트·piece 생성 → **시험용 PNG 2장을 R2 에 올림**(러너가 presigned GET 으로 받을 재료)
 *     ③ `enqueueRender(pieceId, payload)` → `render.video` 잡 1건
 *     ④ 기기 등록 → `runner/ac-runner.mjs --once` 를 자식으로 실행 → 러너가 **진짜 ffmpeg 로 굽고** presigned PUT 업로드
 *     ⑤ 서버 `reportJob` 이 **R2 HEAD 로 실존 확인** → `finalizeRender` → `judgeVideo` → piece_assets·상태
 *     ⑥ 증거 출력(잡 행 · R2 HEAD 바이트 · piece_assets · chainStage · 심사 등급)
 *
 *   🔴 **무음 경로를 일부러 탄다** — audio.narration=[] · bgm=null.
 *      그래야 AM #907(`amix=inputs=0` 이면 ffmpeg 가 종료코드 -34 로 죽는다)의 방어가 실제로 도는지 증명된다.
 *   🔴 발행은 하지 않는다 — 렌더까지다(`render.video` 는 발행 잡이 아니다).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync as zlibSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { r2Put, r2Head, r2Configured } from "../lib/r2";
import { registerDevice } from "../lib/runner-jobs";
import { DISCLOSURE_TEXT } from "../lib/disclosure";
import { enqueueRender } from "../lib/video/render-queue";
import handler, { config } from "../netlify/functions/runner";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 최소 PNG 인코더(하니스 관례 그대로 — 외부 의존 0). */
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
  /* 🔴 단색이 아니라 **디테일이 있는** 그림을 만든다. 2026-09-14 실측: 단색 2장 6초가 31KB 로 나와
     심사기의 frames_not_blank 가 «빈 영상 의심»으로 P0 를 찍었다 — 실제 사진·클립에 가까운 소재라야 실증이 의미가 있다. */
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
      const text = await out.text();
      res.writeHead(out.status, { "Content-Type": "application/json" }).end(text);
    } catch (e) {
      res.writeHead(500).end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ port: (server.address() as { port: number }).port, close: () => server.close() });
  }));
}

async function main() {
  if (!r2Configured()) { console.error("\n  ✗ R2 미설정 — 렌더 결과를 올릴 곳이 없어요(.env R2_* 확인).\n"); process.exit(2); }
  const keep = process.argv.includes("--keep");
  const stamp = Date.now();
  const { port, close } = await startServer();

  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${`r5r${stamp}`.slice(0, 40)}, ${"R5 렌더 실증"}, 'pro', 'active') RETURNING id`);
  const tid = n(t?.id);
  console.log(`\n── P1R5 렌더 실증 (테넌트 ${tid} · 로컬 서버 127.0.0.1:${port}) ──`);
  console.log("   🔴 무음(narration 0 · bgm null) — AM #907 `amix=inputs=0` 방어를 일부러 탄다.\n");

  let ok = false;
  try {
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, format, title, body, blocks, meta, status)
      VALUES (${tid}, 'youtube_shorts', 'video', 'info', ${`[R5 실증] 렌더 ${stamp}`}, ${"<p>렌더 실증</p>"}, ${jsonb([])}, ${jsonb({ stage: "clips" })}, 'generating') RETURNING id`);
    const pieceId = n(p?.id);

    // ② 재료 — 1080×1920 단색 2장을 R2 에 올린다(러너는 presigned GET 으로 받는다).
    const keys: string[] = [];
    for (const [i, rgb] of ([[230, 90, 40], [40, 90, 230]] as [number, number, number][]).entries()) {
      const key = `verify/r5/${tid}/${pieceId}/scene-${i}.png`;
      await r2Put(key, makePng(1080, 1920, rgb), "image/png");
      keys.push(key);
    }
    console.log(`   재료 R2 업로드 ✓ (${keys.length}장)`);

    // 🔴 기기를 **먼저** 등록한다 — 안 그러면 enqueueRender 가 «러너 없음»으로 보고 awaiting_runner 를 찍는다(§7-2 설계대로).
    const reg = await registerDevice(tid, "렌더 실증 PC", "own");

    const payload = {
      pieceId, tenantId: tid,
      out: { w: 1080, h: 1920, fps: 30, maxSeconds: 15, crf: 20 },
      scenes: [
        { idx: 0, startMs: 0, endMs: 6000, imageKey: keys[0], motion: "kenburns", captionIdx: [0] },
        { idx: 1, startMs: 6000, endMs: 12000, imageKey: keys[1], motion: "kenburns", captionIdx: [1] },
      ],
      captions: { preset: "keyword_center", phrases: [
        { idx: 0, text: "겨울 이불\n집에서 빨까?", startMs: 200, endMs: 2900, keyword: "집에서" },
        { idx: 1, text: "코인워시가\n싸게 먹혔어요", startMs: 3200, endMs: 5900, keyword: "싸게" },
      ], srtKey: "" },
      audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
      overlay: { badge: { text: "광고", corner: "tr" }, safeZone: { top: 220, bottom: 300 }, endcard: null },
      // 🔴 시작 3초 자막은 «광고»라는 말이 들어가야 한다(checkVideoDisclosure) — 화면에서 바로 읽히는 표시여야 하기 때문.
      disclosureCaption: { text: "광고 포함 · 파트너스 수수료", untilMs: 3000 },
    };
    /* 🔴 B 의 gen.ts 와 **같은 순서**로 둔다: meta.render = payload 를 먼저 쓰고 렌더를 요청한다.
       심사기(judgeVideo)가 그 payload 로 disclosure·duration_fit 을 판정한다 — 하니스가 실제 흐름을 흉내 내야 의미가 있다. */
    // 🔴 설명란 첫 줄은 **공식 문구와 글자 그대로** 같아야 한다(isDisclosureText) — 정본에서 가져온다(직접 타이핑 금지).
    const DISC = DISCLOSURE_TEXT.coupang;
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ render: payload, hook: "겨울 이불 집에서 빨까?", description: DISC, disclosure: DISC, affiliate: { provider: "coupang" }, adDisclosure: true })}, updated_at = NOW() WHERE id = ${pieceId}`);
    const enq = await enqueueRender(pieceId, payload as never);
    console.log(`   테넌트 ${tid} · piece ${pieceId} · render 잡 ${enq.jobId}(created=${enq.created})\n`);

    // ④ 러너 — 드라이런 아님(실제로 굽고 올려야 report 까지 탄다). 헤드리스.
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "runner", "ac-runner.mjs"), "--once"], {
        cwd: path.join(ROOT, "runner"), stdio: "inherit",
        env: { ...process.env, AC_SERVER: `http://127.0.0.1:${port}`, AC_RUNNER_TOKEN: reg.device.token, RUNNER_SHOTS: "1" },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });

    // ⑥ 증거
    console.log(`\n── 증거(러너 종료코드 ${code}) ──`);
    const jobs = await q(sql`SELECT id, kind, status, error_kind, result FROM runner_jobs WHERE tenant_id = ${tid} ORDER BY id`);
    for (const j of jobs) console.log(`   job #${j.id} ${j.kind} → ${j.status}${j.error_kind ? ` (${j.error_kind})` : ""} · ${JSON.stringify(j.result)}`);

    const assets = await q(sql`SELECT kind, r2_key, meta FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${pieceId} ORDER BY sort`);
    console.log(`   piece_assets ${assets.length}행`);
    for (const a of assets) {
      const h = await r2Head(String(a.r2_key));
      console.log(`      · ${a.kind} ${String(a.r2_key).slice(-42)} → R2 HEAD ${h ? `${(h.bytes / 1024).toFixed(0)}KB ${h.contentType}` : "✗ 없음"}`);
      if (String(a.kind) === "video" && h && h.bytes > 0) ok = true;   // 판정은 «R2 에 실존하나» — 크기 문턱은 멀쩡한 영상을 죽인다(실측 교훈)
    }
    const [pp] = await q(sql`SELECT status, meta FROM pieces WHERE id = ${pieceId}`);
    const meta = (pp?.meta ?? {}) as Record<string, unknown>;
    console.log(`   piece status=${pp?.status} · chainStage=${String(meta.chainStage ?? "-")} · judgeGrade=${String(meta.judgeGrade ?? "-")}`);
    const [gr] = await q(sql`SELECT gate_report FROM pieces WHERE id = ${pieceId}`);
    const axes = ((gr?.gate_report as Record<string, unknown> | null)?.axes ?? []) as { key: string; pass: boolean; grade: string; detail?: string }[];
    if (axes.length) {
      console.log("   심사 축:");
      for (const a of axes) console.log(`      ${a.pass ? "✓" : "✗"} ${a.key}(${a.grade})${a.detail ? ` — ${a.detail}` : ""}`);
    }


    console.log(ok
      ? "\n   ✓ 렌더 전 구간 통과 — 러너가 실제로 굽고 올렸고, 서버가 R2 에서 실존을 확인했다.\n"
      : "\n   ✗ 렌더가 끝까지 가지 못했다 — 위 잡 행의 사유를 보라.\n");
  } finally {
    if (!keep) {
      for (const table of ["runner_jobs", "runner_devices", "piece_assets", "pieces", "notifications", "audit_logs"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tid}`).catch(() => {});
      console.log(`   (테넌트 ${tid} 정리 완료 — 남기려면 --keep)`);
    } else console.log(`   (테넌트 ${tid} 유지)`);
    close();
    await pgClient.end({ timeout: 5 });
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
