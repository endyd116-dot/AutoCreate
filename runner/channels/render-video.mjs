/**
 * runner/channels/render-video.mjs — 쇼츠 렌더(계약 P1R5 §2.2). AM 원본: ../AutoMarketing/scripts/content-runner-core.mjs §render
 *   (ffmpeg 사다리 · buildTtsMixFilters 의 amix/loudnorm 규칙 · 오버레이 프레임 캡처 관례를 **파일 분리 이식** · core.mjs 흐름 무접촉)
 *
 *   하는 일: payload(장면·자막·오디오·오버레이) → 1080×1920 mp4 + 포스터 1장 → **presigned PUT 으로 직접 업로드**.
 *   🔴 러너에 R2 자격이 없다 — 서버가 준 presigned URL 로만 읽고 쓴다(§2.1).
 *   🔴 «서버에 다시 묻지 않는다» — payload 만 보고 굽는다.
 *
 *   ── AM 에서 피 흘려 배운 것(그대로 가져온다) ──
 *   · ffmpeg 탐지: PATH 만 믿으면 «winget 으로 방금 깔았는데 없다»가 된다(shim 이 열린 셸 PATH 에 없다).
 *     명시 env > PATH > winget shim > 표준 경로 순으로 **실제 실행해 보고** 고른다.
 *   · `amix=inputs=0` 금지(AM #907 · 러너 실사고): 오디오 라벨이 0개면 ffmpeg 가 죽는다(종료코드 -34).
 *     라벨이 없으면 **오디오 매핑을 통째로 건너뛴다**(무음 영상).
 *   · `loudnorm` 은 반드시 **amix 뒤**. 개별 입력에 걸면 서로 밀어내며 펌핑이 생긴다.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shot, failShot, settle } from "../lib/browser.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/* ───────── ffmpeg 사다리(AM §B6 이식) ───────── */
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\ffmpeg.exe` : null,
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg",
].filter(Boolean);

let _resolved = null;   // null=미탐색 · ""=없음(같은 실행에서 재탐색 안 함)
let _version = "";

/** 실제로 `-version` 을 돌려 보고 고른다(1회·캐시). 없으면 "". */
export function resolveFfmpeg() {
  if (_resolved !== null) return _resolved;
  for (const cand of FFMPEG_CANDIDATES) {
    try {
      const r = spawnSync(cand, ["-version"], { encoding: "utf8", shell: false });
      if (!r.error && r.status === 0) {
        _resolved = cand;
        _version = String(r.stdout || "").split("\n")[0].slice(0, 40);
        return cand;
      }
    } catch { /* 다음 후보 */ }
  }
  _resolved = "";
  return "";
}

/** 하트비트에 실을 능력(§2.4). 🔴 ffmpeg 가 없으면 서버가 렌더 잡을 안 주고 화면이 «ffmpeg 없음» 칩을 띄운다. */
export function caps() {
  const f = resolveFfmpeg();
  return f ? { ffmpeg: true, ffmpegVersion: _version } : { ffmpeg: false };
}

const X264 = ["-crf", String(process.env.RENDER_CRF || "20"), "-preset", String(process.env.RENDER_X264_PRESET || "medium")];
const LOUDNORM_DEFAULT = { I: -16, TP: -1.5, LRA: 11 };

function runFfmpeg(bin, args, timeoutMs = 15 * 60_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); if (err.length > 20_000) err = err.slice(-8_000); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* */ } reject(BLOCK("encode", `ffmpeg 시간 초과(${Math.round(timeoutMs / 1000)}초)`)); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); reject(BLOCK("encode", `ffmpeg 실행 실패: ${String(e?.message ?? e).slice(0, 120)}`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(BLOCK("encode", `ffmpeg 종료코드 ${code} · ${err.split("\n").filter(Boolean).slice(-3).join(" / ").slice(0, 300)}`));
    });
  });
}

/** presigned GET URL(또는 그냥 URL)에서 받아 임시 파일로. 실패는 clip_fetch. */
async function fetchTo(url, path) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch((e) => {
    throw BLOCK("clip_fetch", `내려받기 실패: ${String(e?.message ?? e).slice(0, 120)}`);
  });
  if (!r.ok) throw BLOCK("clip_fetch", `내려받기 실패(HTTP ${r.status})`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  return path;
}

/** presigned PUT 으로 올린다. 실패는 upload. */
async function putTo(url, path, contentType) {
  const body = readFileSync(path);
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body, signal: AbortSignal.timeout(300_000) })
    .catch((e) => { throw BLOCK("upload", `업로드 실패: ${String(e?.message ?? e).slice(0, 120)}`); });
  if (!r.ok) throw BLOCK("upload", `업로드 실패(HTTP ${r.status})`);
  return body.length;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 오버레이 페이지(AM `buildRenderPage` 이식) — 자막·키워드 강조·배지·엔드카드 레이어.
 *   투명 배경으로 찍어 ffmpeg 가 영상 위에 얹는다. 안전여백(safeZone)은 payload 가 준다.
 *   폰트는 러너 동봉 Pretendard 를 쓰되, 없으면 시스템 산세리프로 내려간다(글자가 사라지지 않게).
 */
function buildOverlayHtml(payload) {
  const { out, overlay, captions } = payload;
  const safe = overlay?.safeZone ?? { top: 220, bottom: 300 };
  const preset = captions?.preset ?? "keyword_center";
  const size = preset === "talking_big" ? 92 : preset === "clip_top" ? 64 : 78;
  const pos = preset === "clip_top" ? `top:${safe.top}px;` : `bottom:${safe.bottom}px;`;
  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face{font-family:Pretendard;src:local("Pretendard"),local("Pretendard Variable");}
  html,body{margin:0;padding:0;background:transparent;width:${out.w}px;height:${out.h}px;overflow:hidden;}
  body{font-family:Pretendard,"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
  #cap{position:absolute;left:60px;right:60px;${pos}text-align:center;font-weight:800;font-size:${size}px;line-height:1.25;
       color:#fff;text-shadow:0 4px 18px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.9);white-space:pre-wrap;}
  #cap .kw{color:#ffe14d;}
  #badge{position:absolute;top:${Math.max(24, safe.top - 140)}px;right:44px;padding:14px 24px;border-radius:999px;
         background:rgba(0,0,0,.62);color:#fff;font-size:34px;font-weight:700;}
  #end{position:absolute;left:80px;right:80px;top:50%;transform:translateY(-50%);text-align:center;color:#fff;
       font-size:72px;font-weight:800;line-height:1.3;text-shadow:0 4px 18px rgba(0,0,0,.8);}
  #end .u{display:block;margin-top:28px;font-size:40px;font-weight:600;opacity:.9;}
  .off{display:none!important;}
</style>
<div id="cap" class="off"></div>
<div id="badge" class="off">${esc(overlay?.badge?.text ?? "")}</div>
<div id="end" class="off">${esc(overlay?.endcard?.text ?? "")}${overlay?.endcard?.url ? `<span class="u">${esc(overlay.endcard.url)}</span>` : ""}</div>
<script>
  // 러너가 부른다: 한 장면(문구 하나)만 켜고 찍는다. 시간 위에서 찍지 않으므로 «애니메이션 도중» 프레임이 없다(AM 카드뉴스 교훈).
  window.__show = (html, opts) => {
    const cap = document.getElementById("cap"), badge = document.getElementById("badge"), end = document.getElementById("end");
    cap.classList.toggle("off", !html); if (html) cap.innerHTML = html;
    badge.classList.toggle("off", !(opts && opts.badge));
    end.classList.toggle("off", !(opts && opts.endcard));
  };
  window.__ready = true;
</script>`;
}

/** 자막 한 문구를 HTML 로 — keyword 가 있으면 그 부분만 강조색. */
function phraseHtml(ph) {
  const text = esc(ph?.text ?? "");
  const kw = String(ph?.keyword ?? "").trim();
  if (!kw) return text;
  const safeKw = esc(kw);
  return text.split(safeKw).join(`<span class="kw">${safeKw}</span>`);
}

/** 가장 선명한 프레임 1장(AM `pickSharpestFrame` 이식 관례) — 라플라시안 분산 대신 **파일 크기**로 고른다.
 *  같은 인코더·같은 해상도의 JPEG 은 디테일이 많을수록 커진다(흐린 프레임이 가장 작다). 외부 의존 0. */
function pickSharpest(paths) {
  let best = null, bestSize = -1;
  for (const p of paths) {
    try { const s = statSync(p).size; if (s > bestSize) { bestSize = s; best = p; } } catch { /* 건너뜀 */ }
  }
  return best;
}

export async function run({ ctx, job, shotKey, dryRun }) {
  const bin = resolveFfmpeg();
  if (!bin) throw BLOCK("ffmpeg_missing", "이 PC 에 ffmpeg 가 없어요. runner/install.md 의 «영상을 만들려면» 대로 설치해 주세요.");

  const p = job.payload ?? {};
  const out = p.out ?? { w: 1080, h: 1920, fps: 30, maxSeconds: 60, crf: 20 };
  const scenes = Array.isArray(p.scenes) ? p.scenes : [];
  if (!scenes.length) throw BLOCK("encode", "장면이 하나도 없어요(payload.scenes 가 비었어요).");
  if (!p.upload?.putUrl || !p.upload?.posterPutUrl) throw BLOCK("upload", "업로드 주소가 없어요(서버가 presigned PUT 을 안 줬어요).");

  const dir = mkdtempSync(join(tmpdir(), "ac-render-"));
  try {
    /* ① 재료 내려받기 — 서버가 presigned GET 으로 치환해 준 주소들. */
    const sceneFiles = [];
    for (const s of scenes) {
      const src = s.clipKey || s.imageKey;
      if (!src) throw BLOCK("clip_fetch", `장면 ${s.idx} 에 영상도 이미지도 없어요.`);
      const isClip = !!s.clipKey;
      const f = join(dir, `sc-${String(s.idx).padStart(3, "0")}.${isClip ? "mp4" : "png"}`);
      await fetchTo(src, f);
      sceneFiles.push({ ...s, file: f, isClip, durMs: Math.max(200, Number(s.endMs) - Number(s.startMs)) });
    }
    const narration = [];
    for (const [i, a] of (p.audio?.narration ?? []).entries()) {
      if (!a?.key) continue;
      narration.push({ file: await fetchTo(a.key, join(dir, `nar-${i}.wav`)), atMs: Math.max(0, Number(a.startMs) || 0) });
    }
    let bgm = null;
    if (p.audio?.bgm?.key) bgm = { file: await fetchTo(p.audio.bgm.key, join(dir, "bgm.mp3")), gainDb: Number(p.audio.bgm.gainDb ?? -18) };

    /* ② 오버레이 프레임 — 자막 문구마다 **투명 PNG 한 장**(시간 위에서 찍지 않는다).
       ffmpeg 가 `enable=between(t,…)` 으로 제때 얹는다. */
    const pagePath = join(dir, "overlay.html");
    writeFileSync(pagePath, buildOverlayHtml(p), "utf8");
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.setViewportSize({ width: out.w, height: out.h });
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => window.__ready);

    const layers = [];   // { file, startMs, endMs }
    const phrases = p.captions?.phrases ?? [];
    const hasBadge = !!p.overlay?.badge?.text;
    for (const ph of phrases) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), [phraseHtml(ph), { badge: hasBadge, endcard: false }]);
      const f = join(dir, `ov-${String(ph.idx).padStart(3, "0")}.png`);
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      layers.push({ file: f, startMs: Math.max(0, Number(ph.startMs) || 0), endMs: Math.max(0, Number(ph.endMs) || 0) });
    }
    // 시작 3초 제휴 고지(§16B) — 자막과 같은 자리에 먼저 얹는다.
    if (p.disclosureCaption?.text) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), [esc(p.disclosureCaption.text), { badge: hasBadge, endcard: false }]);
      const f = join(dir, "ov-disc.png");
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      layers.unshift({ file: f, startMs: 0, endMs: Math.max(1000, Number(p.disclosureCaption.untilMs) || 3000) });
    }
    const totalMs = sceneFiles.reduce((a, s) => a + s.durMs, 0);
    if (p.overlay?.endcard?.text) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), ["", { badge: false, endcard: true }]);
      const f = join(dir, "ov-end.png");
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      layers.push({ file: f, startMs: Math.max(0, totalMs - 2500), endMs: totalMs });
    }
    await shot(page, shotKey, "01-오버레이");

    /* ③ 드라이런이면 여기까지 — 굽지도 올리지도 않는다(계약: 발행 위험 0). */
    if (dryRun) return { dryRun: true, notes: [`재료 ${sceneFiles.length}장면 · 자막 ${layers.length}장 준비(굽지 않음)`] };

    /* ④ ffmpeg — 입력 순서: 장면들 → 오버레이 PNG 들 → 나레이션 → BGM. */
    const args = ["-y"];
    sceneFiles.forEach((s) => {
      if (s.isClip) args.push("-i", s.file);
      else args.push("-loop", "1", "-t", (s.durMs / 1000).toFixed(3), "-i", s.file);
    });
    const ovBase = sceneFiles.length;
    layers.forEach((l) => args.push("-i", l.file));
    const narBase = ovBase + layers.length;
    narration.forEach((nr) => args.push("-i", nr.file));
    const bgmIdx = bgm ? narBase + narration.length : -1;
    if (bgm) args.push("-stream_loop", "-1", "-i", bgm.file);

    const fc = [];
    // 장면 정규화 → 이어 붙이기
    sceneFiles.forEach((s, i) => {
      const kb = s.motion === "kenburns" && !s.isClip
        ? `,zoompan=z='min(zoom+0.0012,1.12)':d=${Math.max(1, Math.round((s.durMs / 1000) * out.fps))}:s=${out.w}x${out.h}:fps=${out.fps}`
        : "";
      fc.push(`[${i}:v]scale=${out.w}:${out.h}:force_original_aspect_ratio=increase,crop=${out.w}:${out.h},setsar=1,fps=${out.fps}${kb},trim=duration=${(s.durMs / 1000).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    });
    fc.push(`${sceneFiles.map((_, i) => `[v${i}]`).join("")}concat=n=${sceneFiles.length}:v=1:a=0[base]`);
    // 오버레이 얹기 — 각자 제 시간에만(eof_action=pass 로 뒤를 막지 않는다)
    let vcur = "[base]";
    layers.forEach((l, k) => {
      const nxt = k === layers.length - 1 ? "[vout]" : `[ov${k}]`;
      fc.push(`${vcur}[${ovBase + k}:v]overlay=0:0:enable='between(t,${(l.startMs / 1000).toFixed(3)},${(l.endMs / 1000).toFixed(3)})':eof_action=pass${nxt}`);
      vcur = nxt;
    });
    if (!layers.length) fc.push(`${vcur}null[vout]`);

    /* 오디오 — 🔴 AM #907: 라벨이 0개면 `amix=inputs=0` 이 되어 ffmpeg 가 죽는다.
       라벨이 없으면 **오디오를 통째로 매핑하지 않는다**(무음 영상). loudnorm 은 반드시 amix **뒤**. */
    const alabels = [];
    narration.forEach((nr, k) => { fc.push(`[${narBase + k}:a]adelay=${nr.atMs}|${nr.atMs}[n${k}]`); alabels.push(`[n${k}]`); });
    if (bgmIdx >= 0) { fc.push(`[${bgmIdx}:a]volume=${Math.pow(10, (bgm.gainDb ?? -18) / 20).toFixed(4)}[bg]`); alabels.push("[bg]"); }
    const ln = p.audio?.loudnorm ?? LOUDNORM_DEFAULT;
    if (alabels.length) {
      fc.push(`${alabels.join("")}amix=inputs=${alabels.length}:duration=longest:dropout_transition=0:normalize=0[amixed]`);
      fc.push(`[amixed]loudnorm=I=${ln.I}:TP=${ln.TP}:LRA=${ln.LRA}[aout]`);
    }

    const outPath = join(dir, "out.mp4");
    const maxSec = Math.max(1, Number(out.maxSeconds) || 60);
    /* 🔴 길이는 **장면 끝**으로 잠근다(2026-09-14 라이브 회귀 · B-1 이 BGM 실측하다 잡음).
       종전엔 `-t maxSeconds` 였다. BGM 은 `-stream_loop -1`(무한)이고 `amix=duration=longest` 라서
       **오디오가 무한**이 되고, 그 무한이 maxSeconds 에서 잘렸다 →
       장면 합계 < maxSeconds 면 차이만큼 **정지 화면 + 음악**이 꼬리로 붙는다(실측: 영상 12s · 컨테이너 15s).
       «60초 쇼츠»인데 본체가 47초면 13초가 정지 화면이다 — 쇼츠에선 이탈로 직결된다.
       BGM 이 없을 땐 longest = 나레이션이라 **드러나지 않았다**(무음 하니스가 영영 못 잡는 결함이었다).
       기준은 `totalMs`(= concat 이 실제로 만들어 내는 길이 = 장면 durMs 합). 이어진 타임라인이면 max(endMs) 와 같다.
       이 값으로 잠가야 아래 `durationMs` 보고도 **참말**이 된다(심사 duration_fit 이 그 값을 믿는다). */
    const bodySec = Math.min(maxSec, totalMs / 1000);
    args.push("-filter_complex", fc.join(";"), "-map", "[vout]");
    if (alabels.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push("-c:v", "libx264", ...X264, "-pix_fmt", "yuv420p", "-r", String(out.fps),
      "-t", bodySec.toFixed(3), "-movflags", "+faststart", outPath);
    await runFfmpeg(bin, args);
    if (!existsSync(outPath) || statSync(outPath).size < 1024) throw BLOCK("encode", "영상이 만들어지지 않았어요(빈 파일).");

    /* ⑤ 포스터 — 후보 몇 장을 뽑아 **가장 선명한** 1장. */
    const posterDir = join(dir, "poster-%02d.jpg");
    await runFfmpeg(bin, ["-y", "-i", outPath, "-vf", `fps=1/${Math.max(1, Math.floor(bodySec / 5))},scale=${out.w}:${out.h}`, "-frames:v", "5", "-q:v", "3", posterDir], 120_000);
    const cands = [1, 2, 3, 4, 5].map((i) => join(dir, `poster-0${i}.jpg`)).filter((f) => existsSync(f));
    const poster = pickSharpest(cands);
    if (!poster) throw BLOCK("encode", "포스터를 뽑지 못했어요.");

    /* ⑥ 업로드 — presigned PUT(러너에 R2 자격 0). */
    const bytes = await putTo(p.upload.putUrl, outPath, "video/mp4");
    await putTo(p.upload.posterPutUrl, poster, "image/jpeg");

    // 🔴 위 `-t bodySec` 과 **같은 값**을 보고한다. 두 식이 갈라지면 또 «컨테이너와 다른 길이»를 참말처럼 보고하게 된다.
    const durationMs = Math.round(bodySec * 1000);
    return {
      render: {
        key: p.upload.key, posterKey: p.upload.posterKey,
        durationMs, bytes, frameCount: Math.round((durationMs / 1000) * out.fps),
        ffmpegVersion: _version || undefined,
      },
      notes: [`${sceneFiles.length}장면 · 자막 ${layers.length} · ${(bytes / 1024 / 1024).toFixed(1)}MB`],
    };
  } catch (e) {
    try { const pg = ctx.pages()[0]; if (pg) await failShot(pg, shotKey); } catch { /* 무시 */ }
    throw e;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
  }
}

export const channel = "video";
