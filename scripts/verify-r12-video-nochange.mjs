/**
 * scripts/verify-r12-video-nochange.mjs — 🔴 «어제와 같은 영상인가»를 **나온 파일**로 잰다 (C · R12 · 2026-09-17)
 *   사용: node scripts/verify-r12-video-nochange.mjs [--mutate=tail|length|overlay] [--fast] [--keep]
 *   종료코드: 0 통과 · 1 빨강 · 2 «못 쟀음»(ffmpeg·playwright·베이스 커밋이 없다 — 통과가 아니다 · AC-9) · 3 변이 «못 심음»
 *
 *   ══ 왜 «다른 층»인가 (트리거 C1) ══
 *   B2 도 무회귀 축을 세운다. 🔴 **같은 축을 두 벌 만들지 않는다** — B2 는 **필터 문자열**(«-t 가 무엇인가»)을 보고,
 *   여기서는 **나온 파일**을 본다: `ffprobe` 로 컨테이너·영상·오디오 길이와 **실프레임 수**, 그리고 `framemd5` 로
 *   **프레임 한 장 한 장의 해시**. 문자열 축은 «필터가 같다»까지만 말하고, 이 자는 «**구워진 그림이 같다**»를 말한다.
 *   AC-33 의 규율 그대로다 — 판정에 쓰는 숫자는 **산출물을 직접 재서** 만든다.
 *
 *   ══ 베이스를 «기억»하지 않는다 — 옛 코드를 실제로 다시 돌린다 ══
 *   골든 파일(«어제 해시는 이거였다»)을 저장하면 ffmpeg 판·폰트가 바뀌는 순간 전부 빨개진다.
 *   ⇒ 대신 **베이스 커밋의 `runner/` 를 통째로 꺼내** 같은 재료로 **지금 여기서** 굽고, 그 자리에서 맞댄다.
 *      같은 기계·같은 ffmpeg·같은 순간이라 «환경이 달라서 다르다»가 원리상 없다.
 *
 *   🔴 **무엇을 얼리고 무엇을 얼리지 않나 — 잣대는 «실제로 남아 있는 것»이다**(2026-09-17 B 가 정리해 준 한 줄).
 *     · **표본(데이터)은 얼려야 산다** — 계약이 줄어도 **옛 글은 그 값을 들고 DB 에 남는다.**
 *       계약에서 표본을 읽어 오면 계약이 바뀌는 날 **표본이 같이 사라지고** 그 회귀는 영영 안 보인다(B 의 format 다섯을 손으로 적은 까닭).
 *     · **환경은 얼리면 죽는다** — ffmpeg·폰트는 **안 남는다.** 골든 해시를 저장하면 판이 바뀌는 날 **전부 빨개진다.**
 *     ⇒ 데이터는 얼리고, 환경은 **그때그때 다시 만든다.** 이 파일이 베이스 러너를 꺼내 굽는 까닭이 그것이다.
 *     ⚠️ 🔴 **한 쌍으로 읽어라 — 한쪽만 보면 반대로 적용하기 딱 좋다.** 이 잣대는 두 창이 **반대 방향에서** 만나 생겼다:
 *        여기(C)는 «환경을 얼리면 죽는다»에서 골든 해시를 버렸고, 같은 날 B 는 «표본을 얼려야 산다»에서
 *        `verify-r11-mutants.mjs` 의 format 다섯을 **계약에서 읽지 않고 손으로 적었다**(계약이 줄어도 옛 글은 DB 에 남는다).
 *        같은 문장이 한쪽에선 «얼리지 마라», 다른 쪽에선 «얼려라»가 된다 — 가르는 것은 **«그것이 실제로 남아 있나»** 하나다.
 *
 *   ══ 자를 먼저 찌른다 (계약 §4-5 · AC-100 ⑦) ══
 *     ⓪ **원판** = 베이스 판 두 번 → **바이트까지 같아야 한다.** 여기가 빨강이면 **표 전체를 버린다**(인코딩이 안 결정적이다).
 *     ⓪b **대조군** = 자막을 **통째로 뺀 판**과 맞댄다 → **반드시 달라져야 한다.**
 *        🔴 이 줄이 없으면 «전부 같다»가 «아무것도 안 구웠다»와 구별되지 않는다(AC-99 ⑨).
 *     `--mutate=tail`    : `-t` 를 `bodySec` → `maxSec` 으로(AC-31 의 그 꼬리) → ① 이 빨개져야 한다
 *     `--mutate=length`  : 장면 하나를 200ms 늘린다 → ① 이 빨개져야 한다
 *     `--mutate=overlay` : 자막 오버레이를 한 장 빼먹는다 → **⑦** 이 빨개져야 한다
 *   🔴 리포 파일은 안 건드린다 — 베이스도 현재도 **스크래치 사본**에서만 돈다.
 *
 *   ══ 칸 이름은 B2 가 정했다(2026-09-17 · 창끼리 직접 · PARALLEL_GUIDE §2.7) ══
 *     · 자막 모션 = `captions.type.motion` (**전역 한 곳** · 구절별 칸 없음) · `none|fade|slide_up|pop` · 키 없음 = 종전
 *     · 컷 전환   = `transition` (**RenderPayload 최상위**) · `none|fade|slide` · 키 없음 = 종전 · 길이는 러너 상수
 *     · 🔴 **말 속도·컷 하한은 payload 에 안 온다**(TTS·scenes 단계에서 끝난다) — 이 파일의 축이 아니다.
 *       그 둘은 순수 함수(`lib/video/tempo.ts resolveNarrationTempo` · `lib/video/scenes.ts applyCutFloor`)라
 *       **다른 자**로 잰다(§⑥ 에서 있는지 확인만 하고, 없으면 ⊘ 로 적는다).
 *
 *   ══ 🔴 대조군이 **같은 영상 안에** 있다 (B2 가 계약으로 준 것) ══
 *     모션을 켜도 다음 셋은 **언제나 `none`** 이어야 한다 — 안 걸어야 할 데 걸면 못 잡는 것보다 나쁘다(AC-68):
 *       ① 제휴 고지 층(법이 읽는 문장) ② 엔드카드 층 ③ 창이 **400ms 미만**인 구절(읽을 시간을 먹는다)
 *     ⇒ 프레임 해시를 **시간 구간별로** 갈라 «여기는 그대로 · 저기는 달라졌다»를 따로 판정한다.
 *        이건 필터 문자열로는 원리상 못 보는 축이다.
 *
 *   ══ 정직한 한계 ══
 *     · 재료가 합성이다(패턴·사인파). 실고객 영상이 아니다 — 여기서 초록은 «**렌더 파이프라인이 안 달라졌다**»까지다.
 *     · 🔴 새 칸을 아무도 안 읽으면 «보내도 출력이 같다»가 나온다. 그건 **통과가 아니라 ⊘ 못 쟀음**이다(자동으로 가른다).
 *     · 컷 경계 <800ms 건너뛰기는 **파일로는 못 가린다**(전환이 통째로 없을 때와 그림이 같다) — B2 의 `planTransitions` 순수 격자 몫이다.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const MUT = (ARGS.find((a) => a.startsWith("--mutate=")) || "").split("=")[1] || "";
const KEEP = ARGS.includes("--keep");
const FAST = ARGS.includes("--fast");
const FPS = 30;

/* 🔴 B2 가 확정한 칸 이름 — 여기 한 곳에만 적는다. 바뀌면 이 표만 고친다. */
const NEW = { motion: "fade", transition: "fade" };

const out = [];
/** ok: true 초록 · false 빨강 · null ⊘ 못 쟀음(통과 아님) */
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

/* ═══ ffmpeg·ffprobe 사다리(러너와 같은 자리) ═══ */
/** 🔴 **반드시 절대 경로로 돌려준다.** 맨 이름(`ffmpeg`)을 그대로 쓰면 아래 shim 이 자기를 부른다 —
 *  Windows 의 `CreateProcess` 는 맨 이름을 **부르는 실행 파일이 있는 폴더부터** 찾기 때문이다.
 *  2026-09-17 C 가 실제로 밟았다: shim 안에 `"ffmpeg"` 을 박았더니 shim 이 자기를 불러 **프로세스가 무한 증식**했다(200개 넘게 떴다).
 *  🔴 «내 계측이 제품보다 먼저 고장 난다»의 또 한 얼굴이다(AC-95·AC-100 ③). */
function ladder(bin, envKey) {
  const la = process.env.LOCALAPPDATA;
  const cands = [process.env[envKey], bin,
    la ? `${la}\\Microsoft\\WinGet\\Links\\${bin}.exe` : null,
    `C:\\Program Files\\ffmpeg\\bin\\${bin}.exe`, `C:\\ffmpeg\\bin\\${bin}.exe`,
    `/opt/homebrew/bin/${bin}`, `/usr/local/bin/${bin}`, `/usr/bin/${bin}`].filter(Boolean);
  for (const c of cands) {
    try {
      const r = spawnSync(c, ["-version"], { encoding: "utf8", shell: false });
      if (!r.error && r.status === 0) return { bin: absolutize(c, bin), ver: String(r.stdout || "").split("\n")[0].slice(0, 60) };
    } catch { /* 다음 */ }
  }
  return { bin: "", ver: "" };
}
function absolutize(cand, bin) {
  if (cand.includes("/") || cand.includes("\\")) return cand;
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(finder, [bin], { encoding: "utf8", shell: false });
    const first = String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  } catch { /* 아래로 */ }
  return cand;
}
const FF = ladder("ffmpeg", "FFMPEG_PATH");
const FP = ladder("ffprobe", "FFPROBE_PATH");

const sh = (bin, args, opts = {}) => {
  const r = spawnSync(bin, args, { encoding: "utf8", shell: false, maxBuffer: 128 * 1024 * 1024, timeout: 10 * 60_000, ...opts });
  return { code: r.status, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
};

const SCRATCH = process.env.CLAUDE_SCRATCHPAD || join(tmpdir(), "ac-c-r12video");
const WORK = join(SCRATCH, "r12-nochange");
const BASE_REF = process.env.AC_BASE || "9d81a2b";

/* ═══ 러너 사본 둘 ═══ */
function checkoutRunner(ref, dest) {
  const names = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "runner"], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean);
  for (const rel of names) {
    const buf = execFileSync("git", ["show", `${ref}:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    const abs = join(dest, rel.slice("runner/".length));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
  return names.length;
}
function copyRunner(dest) {
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(join(ROOT, "runner"))) {
    if (["node_modules", "profiles", "_shots", "tmp", "dist"].includes(f)) continue;
    const src = join(ROOT, "runner", f);
    if (statSync(src).isDirectory()) cpSync(src, join(dest, f), { recursive: true }); else cpSync(src, join(dest, f));
  }
}
const linkModules = (dest) => { try { symlinkSync(join(ROOT, "runner", "node_modules"), join(dest, "node_modules"), "junction"); return true; } catch { return false; } };

/* ═══ 변이 — 심을 자리가 1곳이 아니면 «🟠 못 심음»으로 끝낸다(AC-99 ⑥⑫) ═══ */
const MUTATIONS = {
  tail: { find: "const bodySec = Math.min(maxSec, totalMs / 1000);", to: "const bodySec = maxSec; /* 변이 tail */",
    expect: "① 무회귀가 빨개져야 한다 — AC-31 의 «정지 화면 + 음악» 꼬리" },
  length: { find: "durMs: Math.max(200, Number(s.endMs) - Number(s.startMs))", to: "durMs: Math.max(200, Number(s.endMs) - Number(s.startMs)) + (s.idx === 1 ? 200 : 0) /* 변이 length */",
    expect: "① 무회귀가 빨개져야 한다 — 장면 하나가 200ms 길어진다" },
  /* 🔴 자막 한 장을 빼먹게 한다 — ⑦(자막이 보이나)이 빨개져야 한다.
     ⚠️ 앵커는 **호출부 한 줄 전체**가 아니라 그 줄의 **변하지 않는 앞머리**로 잡는다 — B2 가 그 줄을 고치자
        옛 앵커가 «0곳»이 되어 «🟠 못 심음»으로 떨어졌다(그게 맞는 신호다 · AC-99 ⑦). 다시 낡으면 또 그렇게 말한다. */
  overlay: { find: "for (const ph of phrases) {", to: "for (const ph of phrases) { if (ph.idx === 1) continue; /* 변이 overlay */",
    expect: "⑦ 자막이 보이나 — 자막 한 장(idx 1)이 안 얹혀 그 창이 빨개져야 한다" },
};
function applyMutation(dir, key) {
  const file = join(dir, "channels", "render-video.mjs");
  const m = MUTATIONS[key];
  const src = readFileSync(file, "utf8");
  const hits = src.split(m.find).length - 1;
  if (hits !== 1) return { ok: false, hits };
  writeFileSync(file, src.split(m.find).join(m.to), "utf8");
  return { ok: true, hits };
}

/* ═══ 재료 ═══ */
function buildMaterials(dir, nScenes) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < nScenes; i++) {
    const f = join(dir, `sc-${i}.png`);
    const r = sh(FF.bin, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=12", "-ss", String(i * 0.9), "-frames:v", "1", "-update", "1", f]);
    if (r.code !== 0 || !existsSync(f)) throw new Error(`장면 ${i} 생성 실패: ${r.stderr.slice(-200)}`);
  }
  for (const [i, freq] of [[0, 330], [1, 440]]) {
    const r = sh(FF.bin, ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=2`, "-ar", "44100", "-ac", "1", join(dir, `nar-${i}.wav`)]);
    if (r.code !== 0) throw new Error(`나레이션 ${i} 생성 실패`);
  }
  // 🔴 BGM 이 있어야 AC-31 의 «정지 화면 + 음악» 꼬리가 드러난다(BGM 이 없으면 longest = 나레이션이라 안 보인다)
  const rb = sh(FF.bin, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-b:a", "96k", join(dir, "bgm.mp3")]);
  if (rb.code !== 0) throw new Error("BGM 생성 실패");
}

function startServer(matDir, outDir) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const name = u.pathname.replace(/^\/(m|o)\//, "");
    if (req.method === "GET" && u.pathname.startsWith("/m/")) {
      const f = join(matDir, name);
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      const b = readFileSync(f);
      res.writeHead(200, { "Content-Length": b.length }); return res.end(b);
    }
    if (req.method === "PUT" && u.pathname.startsWith("/o/")) {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => { writeFileSync(join(outDir, name), Buffer.concat(chunks)); res.writeHead(200); res.end("ok"); });
      return;
    }
    res.writeHead(405); res.end();
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port })));
}

/* ═══ 페이로드 ═══
   F1(기본) = 장면 4 × 1000ms · 자막 4 — ⓪ ⓪b ① 이 쓴다.
   F2(관측) = 고지·엔드카드·짧은 창을 일부러 넣어 **대조군을 같은 영상 안에** 둔다 — ② 이후가 쓴다. */
const F1 = { scenes: [1000, 1000, 1000, 1000], phrases: [[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000]], disclosure: 0, endcard: false };
/* 🔴 F2 의 시각은 **겹치지 않게** 짰다 — 층이 겹치면 «어느 층이 달라졌나»를 프레임으로 못 가른다.
   엔드카드는 러너가 `totalMs-2500` 에 얹으므로(상수) 자막은 그 전에 끝나야 한다.
     [0,1500) 고지만 · [1500,2200) 자막0(700ms · 모션 걸려야) · [2200,2450) 자막1(250ms <400 → 언제나 none) · [2500,5000) 엔드카드만 */
const F2 = {
  scenes: [1000, 1000, 1000, 600, 1400],                            // 합 5000ms · 600ms 컷 하나(<800ms 경계 = 전환 건너뜀)
  phrases: [[1500, 2200], [2200, 2450]],
  disclosure: 1500, endcard: true,
};
function makePayload(base, label, fx, { withNew = false, color = null, noCaptions = false } = {}) {
  let t = 0;
  const scenes = fx.scenes.map((d, i) => { const s = { idx: i, startMs: t, endMs: t + d, imageKey: `${base}/m/sc-${i}.png`, motion: "none", captionIdx: [] }; t += d; return s; });
  const totalMs = t;
  const phrases = noCaptions ? [] : fx.phrases.map(([a, b], i) => ({ idx: i, text: `자막 ${i} 한 줄`, startMs: a, endMs: b, ...(i === 0 ? { keyword: "자막" } : {}) }));
  /* `withNew`: true = 모션+전환 · "motion" = 모션만 · "transition" = 전환만.
     🔴 **모션만** 보내는 갈래가 꼭 필요하다 — 전환은 **배경 그림**을 바꾸므로, 둘을 같이 보내면
        «고지 창이 달라졌다»가 모션 탓인지 전환 탓인지 못 가른다(2026-09-17 C 가 여기서 거짓 빨강을 냈다). */
  const wantMotion = withNew === true || withNew === "motion";
  const wantTransition = withNew === true || withNew === "transition";
  const type = {};
  if (color) type.color = color;
  if (wantMotion) type.motion = NEW.motion;
  const p = {
    pieceId: 90001, tenantId: 1,
    out: { w: 1080, h: 1920, fps: FPS, maxSeconds: 15, crf: 20 },
    scenes,
    captions: { preset: "keyword_center", phrases, srtKey: "", ...(Object.keys(type).length ? { type } : {}) },
    audio: {
      narration: [{ key: `${base}/m/nar-0.wav`, startMs: 0 }, { key: `${base}/m/nar-1.wav`, startMs: 4000 }],
      bgm: { key: `${base}/m/bgm.mp3`, gainDb: -18 }, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 },
    },
    overlay: { badge: null, safeZone: { top: 180, bottom: 390, side: 60 }, endcard: fx.endcard ? { text: "구독 부탁드려요" } : null },
    channel: "youtube_shorts",
    disclosureCaption: fx.disclosure ? { text: "광고 포함", untilMs: fx.disclosure } : null,
    upload: { putUrl: `${base}/o/${label}.mp4`, key: `k/${label}.mp4`, posterPutUrl: `${base}/o/${label}.jpg`, posterKey: `k/${label}.jpg` },
  };
  if (wantTransition) p.transition = NEW.transition;   // 🔴 최상위 — B2 확정
  return { payload: p, totalMs };
}

/* ═══ 굽기 ═══ */
let chromium = null;
async function render(runnerDir, payload, label, env = {}) {
  process.stdout.write(`  · 굽는 중 ${label} …`);
  const t0 = Date.now();
  const url = pathToFileURL(join(runnerDir, "channels", "render-video.mjs")).href + `?r=${label}`;
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === null) delete process.env[k]; else process.env[k] = env[k]; }
  try {
    const mod = await import(url);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
      await ctx.newPage();
      const out0 = await mod.run({ ctx, job: { id: label, payload }, shotKey: label, dryRun: false });
      console.log(` ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return out0;
    } finally { await browser.close(); }
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

/* ═══ 🔴 잰다 — 나온 파일을 직접 ═══ */
const md5 = (s) => createHash("md5").update(s).digest("hex").slice(0, 12);
function measure(file) {
  if (!existsSync(file)) return null;
  const num = (v) => { const x = Number(String(v ?? "").trim()); return Number.isFinite(x) && x > 0 ? x : 0; };
  const p = (args) => { const r = sh(FP.bin, ["-v", "error", ...args, file]); return r.code === 0 ? r.stdout : ""; };
  const containerSec = num(p(["-show_entries", "format=duration", "-of", "csv=p=0"]).trim());
  if (!containerSec) return null;
  let videoSec = 0, audioSec = 0;
  for (const line of p(["-show_entries", "stream=codec_type,duration", "-of", "csv=p=0"]).split(/\r?\n/).filter(Boolean)) {
    const [t, d] = line.split(","); if (t === "video") videoSec = videoSec || num(d); else if (t === "audio") audioSec = audioSec || num(d);
  }
  const frames = num(p(["-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0"]).trim());
  const wh = p(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0"]).trim();
  const strip = (s) => s.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim()).filter(Boolean);
  const vLines = strip(sh(FF.bin, ["-v", "error", "-i", file, "-an", "-f", "framemd5", "-"]).stdout);
  const aLines = strip(sh(FF.bin, ["-v", "error", "-i", file, "-vn", "-f", "framemd5", "-"]).stdout);
  return {
    containerMs: Math.round(containerSec * 1000), videoMs: Math.round((videoSec || containerSec) * 1000),
    audioMs: audioSec ? Math.round(audioSec * 1000) : 0, frameCount: frames, wh,
    bytes: statSync(file).size, fileHash: md5(readFileSync(file)),
    vFrames: vLines.length, vHash: md5(vLines.join("\n")), aHash: md5(aLines.join("\n")), vLines,
  };
}
function diff(a, b) {
  if (!a || !b) return ["한쪽을 못 쟀다"];
  const d = [];
  for (const k of ["containerMs", "videoMs", "audioMs", "frameCount", "wh"]) if (a[k] !== b[k]) d.push(`${k} ${a[k]}≠${b[k]}`);
  if (a.vHash !== b.vHash) {
    const n = Math.min(a.vLines.length, b.vLines.length);
    let first = -1, cnt = 0;
    for (let i = 0; i < n; i++) if (a.vLines[i] !== b.vLines[i]) { if (first < 0) first = i; cnt++; }
    d.push(`영상 프레임 ${cnt}장 다름(${a.vFrames} vs ${b.vFrames} · 처음 #${first < 0 ? "길이만" : first})`);
  }
  if (a.aHash !== b.aHash) d.push("오디오 프레임 해시 다름");
  return d;
}
/* ═══ 🔴 **프레임 해시로는 «그림이 달라졌나»를 못 가른다** — 2026-09-17 C 가 자기 자를 여기서 두 번 고쳤다 ═══
   `framemd5` 는 **디코딩된** 프레임의 해시다. 그런데 libx264 의 P 프레임은 **앞 프레임을 참조**하므로
   **프레임 0 한 장만 바뀌어도 뒤 120장이 전부 다른 해시**가 된다(눈에는 한 점도 안 달라 보인다).
   ⇒ 그래서 «자막이 이 창에서 보이나»를 프레임 해시로 물으면 **언제나 «보인다»**가 나온다 — 가짜 초록이다.
   실측: 자막 있는 판 ↔ 없는 판의 **보이는 픽셀 차이**는 프레임 0 에서 0.68%, 프레임 1~ 에서 **정확히 0** 이었다.
   🔴 그래서 **눈에 보이는 차이**를 따로 잰다: 두 영상을 빼고(`blend=difference`) 임계값으로 자른 뒤
      프레임마다 «다른 픽셀의 비율»을 받는다. 인터프레임 예측에 **원리상 안 속는다.**
   ⚠️ 바이트 동일(무회귀 ①·③)은 그대로 `framemd5`·`ffprobe` 로 본다 — 거긴 «정확히 같음»이 맞는 물음이다. */
function pixelDiffPerFrame(a, b, thresh = 16) {
  const r = sh(FF.bin, ["-v", "error", "-i", a, "-i", b, "-filter_complex",
    `[0:v][1:v]blend=all_mode=difference,format=gray,lut=y='if(gt(val,${thresh}),255,0)',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-f", "null", "-"]);
  return [...String(r.stdout || "").matchAll(/YAVG=([0-9.]+)/g)].map((m) => Number(m[1]) / 255);
}
/** 🔴 구간 [fromMs,toMs) 안에서 «눈에 보이게 달라진» 프레임을 센다. `min` = 다른 픽셀 비율의 바닥(0.1%). */
function visibleIn(frac, fromMs, toMs, pad = 2, min = 0.001) {
  const lo = Math.max(0, Math.round((fromMs / 1000) * FPS) + pad);
  const hi = Math.min(frac.length, Math.round((toMs / 1000) * FPS) - pad);
  let n = 0, peak = 0;
  for (let i = lo; i < hi; i++) { if (frac[i] >= min) n++; if (frac[i] > peak) peak = frac[i]; }
  return { n, of: Math.max(0, hi - lo), peak, span: `${(fromMs / 1000).toFixed(1)}~${(toMs / 1000).toFixed(1)}s (프레임 ${lo}~${hi - 1})` };
}
/** 🔴 시간 구간 [fromMs,toMs) 안의 프레임이 같은가 — 경계 프레임은 ±2 장 물러서서 본다(enable 경계가 한 장 흔들린다). */
function sameRange(a, b, fromMs, toMs, pad = 2) {
  const lo = Math.round((fromMs / 1000) * FPS) + pad, hi = Math.round((toMs / 1000) * FPS) - pad;
  const n = Math.min(a.vLines.length, b.vLines.length);
  let cnt = 0, first = -1;
  for (let i = Math.max(0, lo); i < Math.min(hi, n); i++) if (a.vLines[i] !== b.vLines[i]) { if (first < 0) first = i; cnt++; }
  return { same: cnt === 0, cnt, first, span: `${(fromMs / 1000).toFixed(1)}~${(toMs / 1000).toFixed(1)}s (프레임 ${Math.max(0, lo)}~${Math.min(hi, n) - 1})` };
}

/* ═══ 낮은 ffmpeg 흉내 — 🔴 **진짜 .exe** 로 만든다 ═══
   `.cmd` 는 못 쓴다: Node 는 `shell:false` 로 `.bat/.cmd` 실행을 막는다(AC-95 의 뿌리 · npx.cmd 가 그래서 죽었다).
   러너의 사다리도 `shell:false` 라 `.cmd` shim 은 **조용히 건너뛰어지고 진짜 ffmpeg 이 뽑힌다** — 그러면 이 축은 «잰 척»이 된다.
   ⇒ Windows 에 늘 있는 `csc.exe`(.NET Framework)로 **콘솔 exe** 를 굽는다.
   흉내 내는 것은 둘: ①`-version` 이 4.2 라고 말한다 ②🔴 **`-filters` 목록에서 `xfade` 줄을 뺀다**
   (B2 가 «판 번호가 아니라 `-filters` 로 잰다»고 했다 — 재는 그 자리를 그대로 흉내 내야 한다).
   나머지 인자는 **진짜 ffmpeg 에 그대로 넘긴다** — §9: 못 해도 영상은 나가야 한다. */
function buildLowFfmpegExe(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const csc = ["C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"].find((p) => existsSync(p));
    if (!csc) return null;
    /* 🔴 절대 경로가 아니면 **굽지 않는다** — 맨 이름이면 shim 이 자기를 불러 무한 증식한다(위 `absolutize` 주석). */
    if (!FF.bin.includes("/") && !FF.bin.includes("\\")) return null;
    const cs = join(dir, "low.cs");
    const real = FF.bin.replace(/\\/g, "\\\\");
    const src = [
      "using System; using System.Diagnostics; using System.Text;",
      "class P { static int Main(string[] a) {",
      `  string real = "${real}";`,
      // 🔴 자기를 부르면 즉시 죽는다(무한 증식 방지 · 두 겹째 방어)
      "  string self = System.Reflection.Assembly.GetExecutingAssembly().Location;",
      "  if (String.Equals(System.IO.Path.GetFullPath(real), System.IO.Path.GetFullPath(self), StringComparison.OrdinalIgnoreCase)) { Console.Error.Write(\"shim would call itself\\n\"); return 97; }",
      /* 🔴 «인자가 딱 하나일 때»로 좁히면 흉내가 안 먹는다 — 제품은 `-hide_banner -filters` 로 묻는다.
         2026-09-17 C 가 여기서 **자기 자에 속았다**: shim 이 그냥 통과시켜 진짜 ffmpeg 이 답했고,
         전환이 멀쩡히 걸린 걸 보고 «내려앉기가 없다»고 빨강을 낼 뻔했다. 재는 쪽을 **인자 어디에 있든** 잡는다. */
      "  bool version = Array.IndexOf(a, \"-version\") >= 0 && a.Length <= 2;",
      "  if (version) { Console.Out.Write(\"ffmpeg version 4.2.7-0ubuntu0.1 Copyright (c) 2000-2020 the FFmpeg developers\\n\"); return 0; }",
      "  var psi = new ProcessStartInfo(real); foreach (var x in a) psi.Arguments += \"\\\"\" + x + \"\\\" \";",
      "  bool filters = Array.IndexOf(a, \"-filters\") >= 0;",
      "  psi.UseShellExecute = false; psi.RedirectStandardOutput = filters; psi.RedirectStandardError = filters;",
      "  var p = Process.Start(psi);",
      "  if (filters) {",
      "    string o = p.StandardOutput.ReadToEnd(); string e = p.StandardError.ReadToEnd(); p.WaitForExit();",
      "    foreach (var ln in o.Split('\\n')) if (ln.IndexOf(\"xfade\", StringComparison.OrdinalIgnoreCase) < 0) Console.Out.Write(ln + \"\\n\");",
      "    foreach (var ln in e.Split('\\n')) if (ln.IndexOf(\"xfade\", StringComparison.OrdinalIgnoreCase) < 0) Console.Error.Write(ln + \"\\n\");",
      "    return p.ExitCode;",
      "  }",
      "  p.WaitForExit(); return p.ExitCode; } }",
    ].join("\n");
    writeFileSync(cs, src, "utf8");
    const exe = join(dir, "ffmpeg.exe");
    const r = sh(csc, ["/nologo", "/target:exe", `/out:${exe}`, cs]);
    if (r.code !== 0 || !existsSync(exe)) return null;
    const v = sh(exe, ["-version"]);
    const f = sh(exe, ["-filters"]);
    if (v.code !== 0 || !/version 4[.]2/.test(v.stdout)) return null;
    if (/xfade/i.test(f.stdout)) return null;                       // 🔴 자기 자신을 먼저 찌른다 — 안 걷혔으면 못 쓴다
    return exe;
  } catch { return null; }
}

/* ═══ 본체 ═══ */
async function main() {
  console.log("\n═══ R12 영상 무회귀 — «나온 파일»로 잰다 (C) ═══");
  if (!FF.bin || !FP.bin) { console.log(`⊘ 못 쟀음 — ffmpeg/ffprobe 가 없다(ffmpeg:${FF.bin || "없음"} ffprobe:${FP.bin || "없음"})`); process.exit(2); }
  console.log(`ffmpeg  ${FF.ver}\nffprobe ${FP.ver}`);

  const pw = await requirePlaywright();
  chromium = pw.chromium;

  let baseSha = "";
  try { baseSha = execFileSync("git", ["rev-parse", BASE_REF], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { console.log(`⊘ 못 쟀음 — 베이스 커밋 ${BASE_REF} 이 저장소에 없다(AC-98)`); process.exit(2); }
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  console.log(`베이스 ${baseSha.slice(0, 7)} ↔ 지금 ${headSha.slice(0, 7)}${MUT ? ` · 변이 ${MUT}` : ""}`);

  rmSync(WORK, { recursive: true, force: true });
  const DIR_BASE = join(WORK, "runner-base"), DIR_CURR = join(WORK, "runner-curr");
  const MAT = join(WORK, "mat"), OUT = join(WORK, "out");
  mkdirSync(OUT, { recursive: true });

  const n = checkoutRunner(baseSha, DIR_BASE);
  /* 🔴 `AC_CURR=<커밋|브랜치>` = «지금 판»을 **남의 창 커밋**으로 물린다 — 머지하지 않고 그 자리에서 잰다.
     안 주면 내 워킹트리다. 이러면 B2 가 «고쳤습니다» 할 때마다 **내 폴더를 안 흔들고** 바로 구워 볼 수 있다. */
  let currLabel = "워킹트리";
  if (process.env.AC_CURR) {
    let sha = "";
    try { sha = execFileSync("git", ["rev-parse", process.env.AC_CURR], { cwd: ROOT, encoding: "utf8" }).trim(); }
    catch { console.log(`⊘ 못 쟀음 — AC_CURR=${process.env.AC_CURR} 을 저장소에서 못 찾았다(AC-98: 부르기 전에 읽어라)`); process.exit(2); }
    checkoutRunner(sha, DIR_CURR);
    currLabel = `${process.env.AC_CURR}(${sha.slice(0, 7)})`;
  } else copyRunner(DIR_CURR);
  console.log(`지금 판 = ${currLabel}`);
  if (!linkModules(DIR_BASE) || !linkModules(DIR_CURR)) { console.log("⊘ 못 쟀음 — node_modules 정션 실패"); process.exit(2); }
  rec("베이스 러너를 꺼냈다", n > 0, `${n}개 파일 @ ${baseSha.slice(0, 7)}`);

  if (MUT) {
    const r = applyMutation(DIR_CURR, MUT);
    if (!r.ok) { console.log(`🟠 못 심음 — 변이 ${MUT} 의 앵커가 ${r.hits}곳(1곳이어야 한다 · AC-99 ⑥⑫). 표를 버린다.`); process.exit(3); }
    console.log(`변이 ${MUT} 심음 — 기대: ${MUTATIONS[MUT].expect}`);
  }
  if (FAST) process.env.RENDER_X264_PRESET = "ultrafast";

  buildMaterials(MAT, Math.max(F1.scenes.length, F2.scenes.length));
  const { server, port } = await startServer(MAT, OUT);
  const base = `http://127.0.0.1:${port}`;
  const P = (label, fx, o) => makePayload(base, label, fx, o).payload;
  try {
    /* ⓪ 원판 — 베이스 판 두 번. 같지 않으면 표 전체가 무의미하다(AC-100 ⑦). */
    await render(DIR_BASE, P("base1", F1), "base1");
    await render(DIR_BASE, P("base2", F1), "base2");
    const m1 = measure(join(OUT, "base1.mp4")), m2 = measure(join(OUT, "base2.mp4"));
    const d0 = diff(m1, m2);
    if (!rec("⓪ 원판 — 베이스 판 두 번이 같다", d0.length === 0, d0.length ? d0.join(" · ") : `${m1?.vFrames}프레임 · ${m1?.containerMs}ms · ${m1?.fileHash}`)) {
      console.log("\n🔴 원판이 초록이 아니다 — 인코딩이 결정적이지 않다. **아래 표 전체를 버린다**(AC-100 ⑦).");
      report(); process.exit(1);
    }

    /* ⓪b 대조군 — 자막을 **통째로 뺀 판**과 맞댄다. 안 달라지면 이 자는 아무것도 못 본다.
       ⚠️ 🔴 첫 판에서는 `captions.type.color` 를 바꾸는 것을 대조군으로 썼는데 **엉뚱한 이유로 초록**이었다:
          자막이 실제로는 **프레임 0 한 장에만** 얹히는데, 그 한 장이 바뀌면 **P 프레임이 그걸 참조**해
          `framemd5` 는 120장 전부 다르게 나온다. «전 프레임이 달라졌다»가 «자막이 보인다»가 아니었다.
          ⇒ 대조군을 «자막 있음 ↔ 없음»으로 바꾸고, **창 안쪽**을 따로 보는 축(⑦)을 세웠다. */
    await render(DIR_CURR, P("curr1", F1), "curr1");
    await render(DIR_CURR, P("nocap", F1, { noCaptions: true }), "nocap");
    const mNoCap = measure(join(OUT, "nocap.mp4"));
    const mCurr1 = measure(join(OUT, "curr1.mp4"));
    const dc = diff(mCurr1, mNoCap);
    if (!rec("⓪b 대조군 — 자막을 빼면 **달라진다**(이 자가 보고 있다)", dc.length > 0, dc.length ? dc.join(" · ") : "🔴 자막을 통째로 빼도 출력이 같다 = 이 자가 아무것도 안 보고 있다")) {
      console.log("\n🔴 대조군이 안 걸렸다 — «전부 같다»가 «아무것도 안 구웠다»와 구별되지 않는다(AC-99 ⑨). 표를 버린다.");
      report(); process.exit(1);
    }

    /* ⑦ 🔴 **자막이 «창 안»에서 정말 보이나** — 이 자만 볼 수 있는 축이다.
       B2 의 축은 **ffmpeg 인자**를 본다: 인자는 맞다(`overlay=…enable='between(t,…)'`). 그런데 **그림에는 안 얹힌다.**
       2026-09-17 C 실측(ffmpeg 8.1.2): 오버레이 입력이 `-i ov.png` **단일 프레임**이라 즉시 EOF 나고
       `eof_action=pass` 가 그때부터 본편을 통과시킨다 ⇒ **프레임 0 한 장에만** 얹히고 그 뒤로는 통째로 없다.
       🔴 제휴 고지(`disclosureCaption`)·배지·엔드카드가 **같은 사슬**이다 — 법이 읽는 문장이 영상에 안 실린다.
       프레임 0 은 일부러 뺀다(`pad`) — 거기만 보면 «보인다»가 거짓으로 초록이 된다. */
    const capFrac = pixelDiffPerFrame(join(OUT, "curr1.mp4"), join(OUT, "nocap.mp4"));
    for (const [i, [a, b]] of F1.phrases.entries()) {
      const v = visibleIn(capFrac, a, b);
      rec(`⑦ 🔴 자막 ${i} 가 제 창에서 영상에 **보인다**(${(a / 1000).toFixed(1)}~${(b / 1000).toFixed(1)}s)`, v.n > 0,
        v.n > 0 ? `${v.span} 중 ${v.n}/${v.of}장에 보이는 차이(최대 ${(v.peak * 100).toFixed(2)}%)`
          : `🔴 자막이 있으나 없으나 **창 안 픽셀이 한 점도 안 다르다**(최대 ${(v.peak * 100).toFixed(3)}%) — 자막이 안 얹혔다`);
    }
    /* 🔴 프레임 0 은 따로 본다 — 여기만 얹히고 그 뒤가 통째로 비는 것이 지금 실측된 모양이다. */
    rec("⑦-0 참고 — 프레임 0 에는 얹힌다(«한 장만 얹히는» 모양인지 가른다)", capFrac[0] >= 0.001 ? true : null,
      `프레임 0 에서 ${(100 * (capFrac[0] || 0)).toFixed(2)}% 다름 · 프레임 1 에서 ${(100 * (capFrac[1] || 0)).toFixed(3)}%`);

    /* ① 🔴 무회귀 — **안 보내면** 지금 판이 베이스와 같아야 한다.
       ⚠️ 🔴 **여기에 이름 붙인 예외가 하나 있다**(2026-09-17 · B2 `6d58013`): 오버레이 합성이 `eof_action=pass` →
          `repeat` 으로 바뀌었다. 종전 판에서는 **자막이 한 장도 안 얹혔으므로**(⑦ 이 잡은 그것) 그 한 글자를 고치면
          오버레이가 있는 판은 **당연히 달라진다.** 그걸 «무회귀 깨짐»으로 세면 진짜 회귀를 못 본다.
       ⇒ 두 조각으로 나눠 **예외를 좁게** 만든다:
          ①a **오버레이가 없는 판**은 여전히 **바이트까지 같아야 한다**(장면·오디오·인코딩은 안 건드렸다).
          ①b 베이스에서는 자막이 **안 보였다**는 것을 그 자리에서 잰다 — 예외가 «주장»이 아니라 **잰 값**이 된다. */
    await render(DIR_BASE, P("baseNo", F1, { noCaptions: true }), "baseNo");
    const mBaseNo = measure(join(OUT, "baseNo.mp4"));
    const d1 = diff(mBaseNo, mNoCap);
    rec("①a 🔴 무회귀 — 오버레이가 없는 판은 베이스와 **바이트까지 같다**", d1.length === 0,
      d1.length ? d1.join(" · ") : `프레임 ${mNoCap.vFrames}장 · ${mNoCap.containerMs}ms · 해시 동일(장면·오디오·인코딩 무변화)`);
    const baseCapFrac = pixelDiffPerFrame(join(OUT, "base1.mp4"), join(OUT, "baseNo.mp4"));
    const baseVisible = F1.phrases.some(([a, b]) => visibleIn(baseCapFrac, a, b).n > 0);
    rec("①b 🔴 무회귀의 **이름 붙인 예외** — 베이스에서는 자막이 안 보였다(그래서 지금 달라지는 게 맞다)", !baseVisible,
      baseVisible ? "🔴 베이스에서도 자막이 보인다 ⇒ 예외가 성립 안 한다. 지금 판의 차이는 **다른 이유**다 — 다시 봐라"
        : `베이스: 창 안 최대 차이 ${(100 * Math.max(...F1.phrases.map(([a, b]) => visibleIn(baseCapFrac, a, b).peak))).toFixed(3)}% (안 보임) ↔ 지금: ⑦ 참조`);

    await render(DIR_CURR, P("curr2", F2), "curr2");
    const mC2 = measure(join(OUT, "curr2.mp4"));

    /* ② 새 칸을 **보냈을 때** */
    await render(DIR_CURR, P("new", F2, { withNew: true }), "new");
    const mNew = measure(join(OUT, "new.mp4"));
    const dNew = diff(mC2, mNew);
    const wired = dNew.length > 0;
    if (!wired) {
      rec("② `captions.type.motion` + 최상위 `transition` 을 보냈다", null,
        `⊘ 못 쟀음 — 보낸 판이 **안 보낸 판과 바이트까지 같다**. 아직 아무도 그 칸을 안 읽는다(B2 미착지). 통과가 아니다.`);
      for (const s of ["③ 🔴 전체 길이가 안 밀린다(전환은 컷 «안»에서)", "④a 🔴 제휴 고지 층엔 모션이 안 걸린다", "④b 🔴 엔드카드 층엔 모션이 안 걸린다", "④c 🔴 창 400ms 미만 구절엔 모션이 안 걸린다", "④d 모션이 실제로 그림을 바꾼다(양성)"])
        rec(s, null, "⊘ 못 쟀음 — ② 가 안 도는 동안은 못 잰다");
    } else {
      rec("② `captions.type.motion` + 최상위 `transition` 을 보내면 그림이 달라진다", true, dNew.join(" · "));
      const lenSame = mC2.containerMs === mNew.containerMs && mC2.videoMs === mNew.videoMs && mC2.frameCount === mNew.frameCount;
      rec("③ 🔴 전체 길이가 안 밀린다(전환은 컷 «안»에서 빌린다)", lenSame,
        lenSame ? `컨테이너 ${mNew.containerMs}ms · 프레임 ${mNew.frameCount} — 그대로` : `🔴 길이가 밀렸다 ⇒ 코인이 틀어진다: ${mC2.containerMs}→${mNew.containerMs}ms · 프레임 ${mC2.frameCount}→${mNew.frameCount}`);

      /* 🔴 대조군 셋 — 같은 영상 안에서 «여기는 그대로여야 한다».
         🔴 여기는 **반드시 픽셀 자**로 본다 — 모션이 다른 창을 바꾸면 그 여파가 P 프레임을 타고
            고지·엔드카드 창까지 «해시가 다르다»로 번진다(그럼 멀쩡한데 빨개진다 · 거짓 양성). */
      const total = F2.scenes.reduce((a, b) => a + b, 0);
      /* 🔴 **모션만** 보낸 판으로 잰다. 전환까지 같이 보내면 **배경 그림**이 컷 경계에서 섞여
         고지 창까지 «달라졌다»가 뜬다 — 2026-09-17 C 가 그렇게 **거짓 빨강**을 한 번 냈다(전환 fade 가
         1.0s 경계에서 300ms 섞이는데 그 구간이 고지 창 [0,1.5s) 안이었다). 모션 대조군은 모션만으로. */
      await render(DIR_CURR, P("mot", F2, { withNew: "motion" }), "mot");
      const mf = pixelDiffPerFrame(join(OUT, "curr2.mp4"), join(OUT, "mot.mp4"));
      const still = (label, from, to, pad) => {
        const v = visibleIn(mf, from, to, pad);
        rec(label, v.n === 0, v.n === 0 ? `${v.span} 전부 그대로(최대 ${(v.peak * 100).toFixed(3)}%)`
          : `🔴 ${v.span} 중 ${v.n}/${v.of}장이 **보이게 달라졌다**(최대 ${(v.peak * 100).toFixed(2)}%)`);
      };
      still("④a 🔴 제휴 고지 층엔 모션이 안 걸린다(법이 읽는 문장)", 0, F2.disclosure, 2);
      still("④b 🔴 엔드카드 층엔 모션이 안 걸린다", total - 2500, total, 2);
      still("④c 🔴 창 400ms 미만 구절엔 모션이 안 걸린다(읽을 시간을 먹는다)", F2.phrases[1][0], F2.phrases[1][1], 1);
      const long0 = visibleIn(mf, F2.phrases[0][0], F2.phrases[0][1], 1);
      rec("④d 모션이 실제로 그림을 바꾼다(양성 대조)", long0.n > 0,
        long0.n > 0 ? `${long0.span} 중 ${long0.n}/${long0.of}장이 달라졌다(최대 ${(long0.peak * 100).toFixed(2)}%)`
          : "🔴 긴 구절에서도 그림이 그대로다 — 모션이 안 걸렸는데 ② 는 초록이다(다른 게 달라진 것)");
    }

    /* ⑤ 🔴 ffmpeg 가 낮을 때 — 흉내 낸 낮은 판(=xfade 없음)으로 굽고 «못 냈어요»가 적히나 */
    const exe = buildLowFfmpegExe(join(WORK, "shim"));
    if (!exe) rec("⑤ ffmpeg 가 낮으면 내려앉고 «못 냈어요»", null, "⊘ 못 쟀음 — 낮은 ffmpeg exe 를 못 구웠다(csc.exe 없음?)");
    else {
      let res = null, err = "";
      try { res = await render(DIR_CURR, P("low", F2, { withNew: true }), "low", { FFMPEG_PATH: exe, FFPROBE_PATH: FP.bin }); }
      catch (e) { err = String(e?.message ?? e); }
      const notes = JSON.stringify(res?.notes ?? []) + JSON.stringify(res?.render ?? {});
      const said = /못 (냈|했)|낮아|낮은 ffmpeg|전환 없이/.test(notes);
      const made = existsSync(join(OUT, "low.mp4"));
      if (err) rec("⑤ 🔴 ffmpeg 가 낮으면 `none` 으로 내려앉고 «못 냈어요»", false, `🔴 영상이 아예 안 나왔다(§9: 막지 마라) — ${err.slice(0, 200)}`);
      else if (!made) rec("⑤ 🔴 ffmpeg 가 낮으면 `none` 으로 내려앉고 «못 냈어요»", false, "🔴 낮은 판에서 영상이 안 올라왔다(§9: 막지 마라)");
      else if (said) rec("⑤ 🔴 ffmpeg 가 낮으면 `none` 으로 내려앉고 «못 냈어요»", true, `영상은 나왔고 «못 냈어요»가 적혔다 — ${notes.slice(0, 180)}`);
      else rec("⑤ 🔴 ffmpeg 가 낮으면 `none` 으로 내려앉고 «못 냈어요»", wired ? false : null,
        wired ? `🔴 영상은 나왔는데 «못 냈어요»가 없다 — 조용히 버렸다(AC-9) · notes=${notes.slice(0, 140)}`
          : `⊘ 못 쟀음 — 아직 전환 자체가 없다(② 가 ⊘) · 영상은 나왔다`);
    }

    /* ⑥ 말 속도·컷 하한은 payload 밖 — **순수 함수가 생겼나**만 여기서 적고, 격자는 다른 자로 잰다 */
    const tempoFile = join(ROOT, "lib", "video", "tempo.ts");
    const scenesSrc = existsSync(join(ROOT, "lib", "video", "scenes.ts")) ? readFileSync(join(ROOT, "lib", "video", "scenes.ts"), "utf8") : "";
    const hasTempo = existsSync(tempoFile) && readFileSync(tempoFile, "utf8").includes("resolveNarrationTempo");
    const hasFloor = scenesSrc.includes("applyCutFloor");
    rec("⑥ 말 속도·컷 하한 — 순수 함수가 섰나(격자는 다른 자로)", hasTempo && hasFloor ? true : null,
      `resolveNarrationTempo ${hasTempo ? "있다" : "아직"} · applyCutFloor ${hasFloor ? "있다" : "아직"}${hasTempo && hasFloor ? "" : " ⊘ 못 쟀음 — B2 미착지"}`);
  } finally {
    server.close();
    if (!KEEP) { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* 무시 */ } }
    else console.log(`\n(--keep) 산출물: ${OUT}`);
  }
  report();
  process.exit(out.some((r) => r.ok === false) ? 1 : 0);
}

function report() {
  console.log("");
  for (const r of out) console.log(`${r.ok === true ? "✓" : r.ok === false ? "✗" : "⊘"} ${r.step}${r.note ? ` — ${r.note}` : ""}`);
  const g = out.filter((r) => r.ok === true).length, red = out.filter((r) => r.ok === false).length, gray = out.filter((r) => r.ok === null).length;
  console.log(`\n합계 ${g} 통과 · ${red} 빨강 · ${gray} ⊘ 못 쟀음${gray ? " — 🔴 못 쟀음은 «통과»가 아니다(AC-9)" : ""}`);
}

main().catch((e) => { console.error("하니스 자체가 죽었다:", e); process.exit(2); });
