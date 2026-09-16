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

/* ───────── ffprobe 사다리 ─────────
   🔴 2026-09-14 C 수리: 여태 보고한 `durationMs`·`frameCount` 는 **잰 값이 아니라 계획값**이었다
      (`durationMs = -t 에 넘긴 bodySec` · `frameCount = durationMs/1000 × fps`).
      두 숫자가 «서로 일관되게» 계산되니 심사의 `okFrames` 는 **항상 참인 항등식**이 되고,
      산출물이 계획과 달라도(=AC-31 의 «정지 화면 + 음악» 13초 꼬리) 심사는 영영 통과시킨다.
      → 굽고 나서 **파일을 직접 재서** 보고한다. 심사는 그 값으로 «컨테이너와 영상 길이가 갈라졌는가»를 본다.
   사다리는 ffmpeg 것과 같은 자리 + env FFPROBE_PATH(B2 하니스 resolveFfprobe 와 동일) —
   «방금 winget 으로 깔았는데 못 찾는다»(AC-27 계열)를 막는다. */
const FFPROBE_CANDIDATES = () => [
  process.env.FFPROBE_PATH,
  _resolved ? String(_resolved).replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe")) : null,
  "ffprobe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\ffprobe.exe` : null,
  "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe", "C:\\ffmpeg\\bin\\ffprobe.exe",
  "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe",
].filter(Boolean);

let _probe = null;
export function resolveFfprobe() {
  if (_probe !== null) return _probe;
  resolveFfmpeg();                                   // ffmpeg 경로를 먼저 정해야 옆자리 후보가 생긴다
  for (const cand of FFPROBE_CANDIDATES()) {
    try { const r = spawnSync(cand, ["-version"], { encoding: "utf8", shell: false }); if (!r.error && r.status === 0) { _probe = cand; return cand; } } catch { /* 다음 후보 */ }
  }
  _probe = "";
  return "";
}

const probeNum = (v) => { const x = Number(String(v ?? "").trim()); return Number.isFinite(x) && x > 0 ? x : 0; };

/**
 * measureOutput — 구운 파일을 **직접 잰다**. 못 재면 `null`(«모른다»)이다 — 계획값을 잰 값인 척 돌려주지 않는다(AC-9).
 *   containerMs = format.duration · videoMs/audioMs = 스트림별 duration · frameCount = 실제 패킷 수.
 */
function measureOutput(file) {
  const probe = resolveFfprobe();
  if (!probe) return null;
  const run = (args) => { try { const r = spawnSync(probe, args, { encoding: "utf8", shell: false, timeout: 120_000 }); return r.status === 0 ? String(r.stdout || "") : ""; } catch { return ""; } };
  const containerSec = probeNum(run(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
  if (!containerSec) return null;
  const streams = run(["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", file]).split(/\r?\n/).filter(Boolean);
  let videoSec = 0, audioSec = 0;
  for (const line of streams) { const [type, dur] = line.split(","); if (type === "video") videoSec = videoSec || probeNum(dur); else if (type === "audio") audioSec = audioSec || probeNum(dur); }
  const frames = probeNum(run(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]).trim());
  return {
    containerMs: Math.round(containerSec * 1000),
    videoMs: Math.round((videoSec || containerSec) * 1000),   // 스트림 duration 이 N/A 인 컨테이너도 있다 → 컨테이너로 대신한다
    audioMs: audioSec ? Math.round(audioSec * 1000) : 0,      // 0 = 오디오 트랙 없음(무음 경로)
    frameCount: frames,
  };
}

/** 하트비트에 실을 능력(§2.4). 🔴 ffmpeg 가 없으면 서버가 렌더 잡을 안 주고 화면이 «ffmpeg 없음» 칩을 띄운다. */
export function caps() {
  const f = resolveFfmpeg();
  return f ? { ffmpeg: true, ffmpegVersion: _version, ffprobe: !!resolveFfprobe() } : { ffmpeg: false };
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
export function buildOverlayHtml(payload) {
  const { out, overlay, captions } = payload;
  /* 🔴 폴백을 **가장 보수적인 값**으로 바꿨다(R8-A §3 · 2026-09-15). 종전 폴백 220/300 은
     쇼츠·릴스·틱톡 **셋 다 미달**이라, 서버가 채널값을 안 보내면 자막이 UI 에 먹혔다. 모르면 안전한 쪽(AC-9). */
  const safe = overlay?.safeZone ?? { top: 220, bottom: 450, side: 60 };
  const preset = captions?.preset ?? "keyword_center";

  /* ═══ [R10-6] 🔴 **자막 모양을 상수에서 값으로 연다** ═══
   *
   *   2026-09-16 실측(`docs/active/2026-09-16-B2-video-capability.md` §1): 자막은 ffmpeg `drawtext` 가 아니라
   *   **브라우저가 HTML/CSS 로 그린 PNG** 다 ⇒ **CSS 로 되는 것은 원리상 다 된다**(굵기·크기·색·외곽선·자간).
   *   못 냈던 이유는 «렌더가 못 해서»가 아니라 **그 CSS 가 상수로 박혀 있어서**였다.
   *   ⇒ 레퍼런스가 「굵기 900 · 강조는 주황 · 한 줄 14자」를 배워 와도 **넣을 칸이 없던** 것을 여기서 연다.
   *
   *   🔴 **안 주면 지금까지와 똑같다.** 아래 기본값은 전부 **종전에 박혀 있던 그 값**이다 —
   *      값을 여는 변경이 화면을 바꾸면 그건 «칸 열기»가 아니라 **조용한 개편**이다(구운 영상이 달라진다).
   *   🔴 **모르는 축은 `null` 로 둔다**(AC-92) — 예: `maxCharsPerLine` 은 기본이 없다. «한 줄 몇 자»를
   *      우리가 지어내면 심사(`judge.ts`)가 재는 2줄 규칙과 **다른 숫자 두 벌**이 생긴다.
   */
  const t = captions?.type ?? {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const side = num(t.side, Number(safe.side ?? 60));
  const size = num(t.size, preset === "talking_big" ? 92 : preset === "clip_top" ? 64 : 78);
  const weight = num(t.weight, 800);
  const lineHeight = num(t.lineHeight, 1.25);
  const color = String(t.color ?? "#fff");
  const accent = String(t.accentColor ?? "#ffe14d");
  const shadow = String(t.shadow ?? "0 4px 18px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.9)");
  /* 외곽선 — 🔴 종전엔 **아예 없었다**(그림자만). 안 주면 여전히 안 그린다(무회귀). */
  const stroke = num(t.strokeWidth, 0) > 0
    ? `-webkit-text-stroke:${num(t.strokeWidth, 0)}px ${String(t.strokeColor ?? "#000")};paint-order:stroke fill;`
    : "";
  /* 자리 — 🔴 `position` 을 주면 그게 이기고, 안 주면 **종전대로 프리셋이 정한다**. */
  const place = String(t.position ?? (preset === "clip_top" ? "top" : "bottom"));
  const pos = place === "top" ? `top:${safe.top}px;`
    : place === "middle" ? `top:50%;transform:translateY(-50%);`
      : `bottom:${safe.bottom}px;`;
  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face{font-family:Pretendard;src:local("Pretendard"),local("Pretendard Variable");}
  html,body{margin:0;padding:0;background:transparent;width:${out.w}px;height:${out.h}px;overflow:hidden;}
  body{font-family:Pretendard,"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
  #cap{position:absolute;left:${side}px;right:${side}px;${pos}text-align:center;font-weight:${weight};font-size:${size}px;line-height:${lineHeight};
       color:${color};text-shadow:${shadow};${stroke}white-space:pre-wrap;}
  #cap .kw{color:${accent};}
  /* 배지는 안전영역 «안»에 둔다. 종전 safe.top - 140 은 안전영역 위쪽 바깥이라,
     쇼츠(상단 UI 180px) 기준 top=80px 로 배지가 통째로 UI 에 가려졌다 — 그 배지가 제휴 고지다(16B).
     품질 문제가 아니라 정책 문제라 자리를 안으로 들였다. */
  #badge{position:absolute;top:${safe.top}px;right:${Math.max(side, 44)}px;padding:14px 24px;border-radius:999px;
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
function phraseHtml(ph, maxCharsPerLine = null) {
  const text = esc(wrapPhrase(ph?.text ?? "", maxCharsPerLine));
  const kw = String(ph?.keyword ?? "").trim();
  if (!kw) return text;
  const safeKw = esc(kw);
  return text.split(safeKw).join(`<span class="kw">${safeKw}</span>`);
}

/**
 * [R10-6] 🔴 **한 줄 글자 수를 «규칙»으로 만든다.**
 *
 *   심사(`lib/video/judge.ts`)는 «자막 2줄 이내»를 **이미 재고 있는데** 만드는 쪽엔 규칙이 없었다.
 *   그 파일 주석이 자백해 뒀다: 「지금 값(구절 ≤12음절)으로는 **우연히** 2줄 안에 들어가지만,
 *   **우연히 맞는 것은 규칙이 아니다** — 다음 사람이 글자 크기만 키우면 깨진다」(`judge.ts:68`).
 *   ⇒ 여기서 **낱말 경계로** 줄을 끊는다. CSS 는 `white-space:pre-wrap` 이라 우리가 넣은 개행을 그대로 그린다.
 *
 *   🔴 **안 주면 아무 일도 안 한다**(`null`). «한 줄 몇 자»의 기본값을 우리가 지어내면
 *      심사가 재는 규칙과 **다른 숫자 두 벌**이 생긴다(AC-92 · AC-78). 값은 서버·레퍼런스가 준다.
 *   ⚠️ 낱말 하나가 상한보다 길면 **자르지 않는다** — 자르면 그 낱말을 못 읽는다(강조 낱말이면 더 나쁘다).
 */
export function wrapPhrase(raw, maxCharsPerLine) {
  const s = String(raw ?? "");
  const cap = Number(maxCharsPerLine);
  if (!Number.isFinite(cap) || cap < 2 || !s.trim()) return s;
  const out = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const w of para.split(/(\s+)/)) {
      if (/^\s+$/.test(w)) { if (line) line += w; continue; }
      const next = line ? line.trimEnd() + " " + w : w;
      if (next.length > cap && line.trim()) { out.push(line.trimEnd()); line = w; }
      else line = next;
    }
    out.push(line.trimEnd());
  }
  return out.join("\n");
}

/* ═══════════════════ [R12-1] 자막 모션 — 🔴 **PNG 는 여전히 한 장이다** ═══════════════════
 *
 *   ══ AM 이 이 길에서 무너진 적이 있다(R9 의 그 규율을 R12 에도 건다) ══
 *     AM 카드뉴스는 «시간 위에서» 프레임을 찍었다. 우리는 안 그런다 — **구절당 PNG 한 장**을 두고
 *     **ffmpeg 이 그 한 장의 자리·투명도·크기를 시간에 따라 바꾼다.**
 *     🔴 우리가 AM 과 다른 점 셋(코드에 적어 둔다):
 *       ① **프레임마다 다시 안 그린다** — 글자를 프레임 수만큼 그리면 **원가가 프레임 수만큼 곱해진다.**
 *       ② **나가는 모션이 없다** — 구절이 끝나면 다음 구절이 바로 온다. 나가는 동안 겹치면 **두 줄이 동시에 보이고**
 *          그건 심사(`judge.ts`)의 «자막 2줄» 규칙과 정면으로 싸운다(계약의 두 부분이 서로 싸우는 자리 · CLAUDE §9).
 *       ③ **길이를 고객이 못 정한다** — 120~200ms 안에서 우리가 정한다. 길면 **읽을 시간을 먹는다**(`judge.ts reading_time`).
 *
 *   🔴 **무회귀**: `motion` 이 없거나 `none` 이면 ffmpeg 인자가 **한 글자도 안 바뀐다**(아래 `buildFilters` 의 분기).
 */
export const CAPTION_MOTIONS = new Set(["none", "fade", "slide_up", "pop"]);
/** 우리가 정한 모션 길이(ms) — 설계 «120~200ms» 의 가운데. 🔴 payload 로 안 받는다. */
export const CAPTION_MOTION_MS = 160;
/** 이보다 짧은 구절엔 **안 건다** — 모션이 구절 수명의 절반을 먹으면 그건 꾸밈이 아니라 방해다. */
export const CAPTION_MOTION_MIN_WINDOW_MS = 400;
/** `slide_up` 이 올라오는 거리(px · 1080×1920 기준). */
export const CAPTION_MOTION_SLIDE_PX = 24;
/** `pop` 이 시작하는 크기. 1.0 에서 끝난다(끝이 정확히 1.0 이라 **모션이 끝나면 `none` 과 같은 그림**이다). */
export const CAPTION_MOTION_POP_FROM = 0.94;

/**
 * 이 오버레이 층에 걸 모션. 🔴 **순수** — `scripts/verify-video-motion.mjs` 가 그대로 돌린다.
 *
 *   🔴 **대조군이 같은 영상 안에 있다**(AC-68 «안 걸어야 할 데 걸면 더 나쁘다»):
 *     · `disclosure` — **법이 읽는 문장이다.** 고지를 우리가 꾸미지 않는다(러너 `plan.mjs` 의 고지 규칙과 같은 결).
 *     · `endcard`    — 마무리 카드는 2.5초 내내 한 장이다. 들어오는 모션을 걸 «들어옴»이 없다.
 *     · 짧은 구절    — 400ms 미만.
 *
 * @param kind      "phrase" | "disclosure" | "endcard"
 * @param windowMs  그 층이 화면에 있는 시간(ms)
 * @param typeMotion payload `captions.type.motion`
 */
export function motionForLayer(kind, windowMs, typeMotion) {
  const want = String(typeMotion ?? "none");
  if (!CAPTION_MOTIONS.has(want) || want === "none") return "none";
  if (String(kind) !== "phrase") return "none";
  if (!(Number(windowMs) >= CAPTION_MOTION_MIN_WINDOW_MS)) return "none";
  return want;
}

/* ═══════════════════ [R12-2] 컷 전환 — 🔴 **컷 «안»에서 빌린다** ═══════════════════
 *
 *   `concat` 은 겹치는 구간이 없다. 전환을 넣으려면 두 컷이 겹치는 시간이 있어야 하고,
 *   컷 «사이»에서 빌리면 **전체 길이가 짧아진다** — 0.3초 × 12컷 = **3.6초가 사라진다**(15초가 11.4초).
 *   🔴 길이가 밀리면 **코인이 틀어진다**(길이 구간제) ⇒ 각 컷을 전환 길이만큼 **늘려서** 겹친다. 합은 그대로다.
 *   🔴 **나레이션·자막 시각은 안 건드린다** — 전환은 **그림에만** 건다.
 */
export const TRANSITION_XFADE = { fade: "fade", slide: "slideleft" };
export const TRANSITION_MS = 300;
export const TRANSITION_MAX_MS = 400;
/** 컷이 이보다 짧으면 그 경계는 **건너뛴다** — 겹칠 자리가 없다. */
export const TRANSITION_MIN_CUT_MS = 800;

/**
 * 전환 계획. 🔴 **순수** — `scripts/verify-video-motion.mjs` 가 그대로 돌린다.
 *   돌려주는 것:
 *     · `ms`        걸 전환 길이(0 = 안 건다 ⇒ 러너는 **종전 `concat` 경로를 그대로** 탄다)
 *     · `at[i]`     컷 i 와 i+1 사이에 전환을 거나
 *     · `extendMs[i]` 컷 i 의 입력을 얼마나 늘려야 하나(= 앞 경계가 전환이면 `ms`) — **길이 보존의 전부가 이 줄이다**
 *     · `runs`      xfade 로 이어지는 연속 덩어리들(덩어리 사이는 `concat`)
 *     · `skipped`   건너뛴 경계 수(«짧아서 못 걸었다»를 보고에 싣는다 · AC-9)
 */
export function planTransitions(durMs, kind) {
  const d = (Array.isArray(durMs) ? durMs : []).map((x) => Math.max(0, Number(x) || 0));
  const n = d.length;
  const off = { ms: 0, kind: "none", at: new Array(Math.max(0, n - 1)).fill(false), extendMs: new Array(n).fill(0), runs: d.map((_, i) => [i]), skipped: 0 };
  const k = String(kind ?? "none");
  if (!TRANSITION_XFADE[k] || n < 2) return off;
  const ms = Math.min(TRANSITION_MAX_MS, TRANSITION_MS);
  const at = [];
  for (let i = 0; i + 1 < n; i++) at.push(d[i] >= TRANSITION_MIN_CUT_MS && d[i + 1] >= TRANSITION_MIN_CUT_MS);
  const skipped = at.filter((x) => !x).length;
  if (!at.some(Boolean)) return { ...off, skipped };
  const extendMs = d.map((_, i) => (i > 0 && at[i - 1] ? ms : 0));
  const runs = [];
  let cur = [0];
  for (let i = 0; i + 1 < n; i++) { if (at[i]) cur.push(i + 1); else { runs.push(cur); cur = [i + 1]; } }
  runs.push(cur);
  return { ms, kind: k, at, extendMs, runs, skipped };
}

let _xfade = null;
/**
 * 🔴 **«4.3 이상인가»를 판 번호로 짐작하지 않는다 — `-filters` 로 실제로 있는지 잰다.**
 *   판 문자열은 배포판마다 제각각이다(`n4.3`·`4.2.2-static`·`N-109xxx-g…`) — 파싱은 **틀리는 쪽**으로 틀린다.
 *   못 읽으면 `false`(전환 없이 굽는다 · **영상은 나간다**).
 */
export function hasXfade() {
  if (_xfade !== null) return _xfade;
  const bin = resolveFfmpeg();
  if (!bin) { _xfade = false; return _xfade; }
  try {
    const r = spawnSync(bin, ["-hide_banner", "-filters"], { encoding: "utf8", shell: false, timeout: 20_000 });
    _xfade = r.status === 0 && /(^|\s)xfade(\s|$)/m.test(String(r.stdout || ""));
  } catch { _xfade = false; }
  return _xfade;
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

/**
 * buildRenderArgs — payload 재료 → **ffmpeg 인자 배열**. 🔴 **순수**(파일도 프로세스도 안 건드린다).
 *
 *   ══ 왜 `run()` 밖으로 뽑았나 ══
 *     🔴 계약 §4-4: «**있나**»가 아니라 «**도나**»를 재라. 인자 조립이 `run()` 안에 있으면 하니스가
 *     브라우저·ffmpeg·R2 없이는 한 줄도 못 돌리고, 그러면 결국 «그 줄이 소스에 있나»를 세게 된다(AC-99 ⑩).
 *     ⇒ **재료를 받아 인자를 돌려주는 함수**로 뽑았다. `scripts/verify-video-motion.mjs` 가 이걸 그대로 돌려
 *     🔴 «모션·전환을 안 보내면 **인자가 종전과 한 글자도 안 다른가**»를 **손으로 적은 기댓값**과 맞대 본다
 *     (기댓값을 이 함수 출력에서 뽑아 오면 그게 AC-78 — 검사가 값을 베끼는 것이다).
 *
 * @param ctx.deco  꾸밈(모션·전환)을 켜나. 🔴 **`false` 면 어느 줄도 종전과 다르지 않다** — 그게 이 갈래의 계약이다.
 */
export function buildRenderArgs(ctx) {
  const { sceneFiles, layers, narration, bgm, out, outPath, bodySec, deco, wantTransition } = ctx;
  const p = ctx.payload ?? {};
  const sec = (ms) => (Math.max(0, Number(ms) || 0) / 1000).toFixed(3);
  const tr = deco ? planTransitions(sceneFiles.map((s) => s.durMs), wantTransition) : planTransitions([], "none");
  const args = ["-y"];
  sceneFiles.forEach((s, i) => {
    /* 🔴 **입력을 전환 길이만큼 늘린다** — 여기가 «전체 길이 불변»의 전부다.
       정지 그림은 `-t` 로 그냥 더 돈다. 영상 조각은 아래 `tpad` 로 **마지막 프레임을 복제해** 늘린다
       (조각이 창보다 딱 맞게 만들어져 있어 더 뽑을 그림이 없다 · 늘리지 않으면 그 컷만큼 전체가 짧아진다). */
    const target = s.durMs + (tr.extendMs[i] ?? 0);
    if (s.isClip) args.push("-i", s.file);
    else args.push("-loop", "1", "-t", sec(target), "-i", s.file);
  });
  const ovBase = sceneFiles.length;
  layers.forEach((l) => {
    /* 🔴 `fade`·`pop` 은 **시간 위의 스트림**이 있어야 한다(단일 프레임에는 «도중»이 없다) — 그 둘만 입력 모양을 바꾼다.
       `none`·`slide_up` 은 **종전 그대로 한 장**이다(`slide_up` 은 overlay 의 y 식만 쓴다). */
    const m = deco ? l.motion : "none";
    if (m === "fade" || m === "pop") args.push("-loop", "1", "-t", sec(l.endMs - l.startMs), "-i", l.file);
    else args.push("-i", l.file);
  });
  const narBase = ovBase + layers.length;
  narration.forEach((nr) => args.push("-i", nr.file));
  const bgmIdx = bgm ? narBase + narration.length : -1;
  if (bgm) args.push("-stream_loop", "-1", "-i", bgm.file);

  const fc = [];
  // 장면 정규화
  sceneFiles.forEach((s, i) => {
    const ext = tr.extendMs[i] ?? 0;
    const target = s.durMs + ext;
    const kb = s.motion === "kenburns" && !s.isClip
      ? `,zoompan=z='min(zoom+0.0012,1.12)':d=${Math.max(1, Math.round((target / 1000) * out.fps))}:s=${out.w}x${out.h}:fps=${out.fps}`
      : "";
    const pad = ext > 0 && s.isClip ? `,tpad=stop_mode=clone:stop_duration=${sec(ext)}` : "";
    fc.push(`[${i}:v]scale=${out.w}:${out.h}:force_original_aspect_ratio=increase,crop=${out.w}:${out.h},setsar=1,fps=${out.fps}${kb}${pad},trim=duration=${sec(target)},setpts=PTS-STARTPTS[v${i}]`);
  });
  /* 이어 붙이기 — 전환이 없으면 **종전 `concat` 한 줄 그대로**. 있으면 «xfade 로 이어지는 덩어리»끼리 잇고 덩어리 사이는 concat. */
  if (!tr.ms) {
    fc.push(`${sceneFiles.map((_, i) => `[v${i}]`).join("")}concat=n=${sceneFiles.length}:v=1:a=0[base]`);
  } else {
    const runLabels = [];
    tr.runs.forEach((run, r) => {
      if (run.length === 1) { runLabels.push(`[v${run[0]}]`); return; }
      /* 🔴 offset 은 «지금까지 쌓인 길이 − 전환 길이»다. 그래야 겹친 뒤 합이 **원래 길이 그대로** 남는다:
         len(a) + (len(b)+ms) − ms = len(a)+len(b). */
      let acc = sceneFiles[run[0]].durMs;
      let cur = `[v${run[0]}]`;
      for (let k = 1; k < run.length; k++) {
        const lab = k === run.length - 1 ? `[r${r}]` : `[x${r}_${k}]`;
        fc.push(`${cur}[v${run[k]}]xfade=transition=${TRANSITION_XFADE[tr.kind]}:duration=${sec(tr.ms)}:offset=${sec(acc - tr.ms)}${lab}`);
        acc += sceneFiles[run[k]].durMs;
        cur = lab;
      }
      runLabels.push(`[r${r}]`);
    });
    if (runLabels.length === 1) fc.push(`${runLabels[0]}null[base]`);
    else fc.push(`${runLabels.join("")}concat=n=${runLabels.length}:v=1:a=0[base]`);
  }
  /* 오버레이 얹기 — 각자 제 시간에만.
   *
   *   🔴🔴 **`eof_action=pass` 였던 것을 `repeat` 으로 고쳤다**(2026-09-17 · C 발견 · B2 실측 확인).
   *      종전 코드의 주석은 «`pass` 로 뒤를 막지 않는다»였는데 **그 주석이 뜻하는 일이 일어나지 않았다** —
   *      오버레이 입력은 `-i ov.png` **단일 프레임**이라 **t=0 에 곧바로 EOF** 고,
   *      `pass` 는 그 순간부터 **본편을 그대로 통과**시킨다 ⇒ `enable` 창이 와도 **영영 안 얹힌다.**
   *
   *      실측(B2 · ffmpeg 8.1.2 · 검은 4초 영상 + 빨간 PNG · `enable='between(t,1.0,2.0)'`):
   *        · `eof_action=pass`   → 1.5초 프레임 픽셀 **(0,0,0)**   = 안 그려짐
   *        · `eof_action=repeat` → 1.5초 프레임 픽셀 **(252,0,0)** = 그려짐 · 3.0초는 (0,0,0)(창 밖이라 맞다)
   *      `repeat` 은 overlay 의 **기본값**이다 — 즉 종전 코드는 기본값을 **일부러 껐고 그게 기능을 껐다.**
   *
   *   🔴 **이건 «무회귀»의 예외다.** 종전 산출물과 **달라지는 것이 맞다** — 종전 산출물이 틀렸기 때문이다.
   *      자막·**제휴 고지**·배지·엔드카드가 첫 프레임 말고는 실리지 않고 있었다(법이 읽는 문장이 영상에 없었다 · CLAUDE §9-④).
   *      🔴 심사(`judge.ts`)는 이걸 원리상 못 잡는다 — 계획값을 보기 때문이다(AC-33).
   *   ⚠️ 판 의존일 수 있다: 실측한 판은 **8.1.2 하나**다. 옛 판에서는 돌았을 수 있다(안 그랬으면 진작 드러났다).
   *      그래도 `repeat` 이 맞다 — **판이 제각각인 고객 PC 에서 «있거나 없거나»가 되면 안 된다.** */
  let vcur = "[base]";
  layers.forEach((l, k) => {
    const nxt = k === layers.length - 1 ? "[vout]" : `[ov${k}]`;
    const m = deco ? l.motion : "none";
    const S = sec(l.startMs), E = sec(l.endMs), D = sec(CAPTION_MOTION_MS);
    const win = `enable='between(t,${S},${E})':eof_action=repeat`;
    let src = `[${ovBase + k}:v]`;
    if (m === "fade") {
      /* 투명도 0→1. 🔴 `fade` 는 **자기 스트림의 시각**으로 재므로 `st=0` 으로 걸고 **그 뒤에** 제자리로 민다. */
      fc.push(`[${ovBase + k}:v]fps=${out.fps},format=rgba,fade=t=in:st=0:d=${D}:alpha=1,setpts=PTS+${S}/TB[ovs${k}]`);
      src = `[ovs${k}]`;
    } else if (m === "pop") {
      /* 크기 0.94→1.0. 끝이 **정확히 1.0** 이라 모션이 끝나면 `none` 과 같은 그림이다. */
      const g = `(${CAPTION_MOTION_POP_FROM}+${(1 - CAPTION_MOTION_POP_FROM).toFixed(2)}*min(1,t/${D}))`;
      fc.push(`[${ovBase + k}:v]fps=${out.fps},format=rgba,scale=w='iw*${g}':h='ih*${g}':eval=frame,setpts=PTS+${S}/TB[ovs${k}]`);
      src = `[ovs${k}]`;
    }
    if (m === "slide_up") {
      /* 아래에서 올라옴 — 캔버스를 통째로 24px 내렸다가 제자리로. 🔴 **배지는 이미 떼어 냈다**(고지는 안 흔든다). */
      fc.push(`${vcur}${src}overlay=x=0:y='if(lt(t-${S},${D}),${CAPTION_MOTION_SLIDE_PX}*(1-(t-${S})/${D}),0)':${win}${nxt}`);
    } else if (m === "pop") {
      fc.push(`${vcur}${src}overlay=x='(W-w)/2':y='(H-h)/2':${win}${nxt}`);
    } else {
      fc.push(`${vcur}${src}overlay=0:0:${win}${nxt}`);
    }
    vcur = nxt;
  });
  if (!layers.length) fc.push(`${vcur}null[vout]`);

  /* 오디오 — 🔴 AM #907: 라벨이 0개면 `amix=inputs=0` 이 되어 ffmpeg 가 죽는다.
     라벨이 없으면 **오디오를 통째로 매핑하지 않는다**(무음 영상). loudnorm 은 반드시 amix **뒤**.
     🔴 [R12-2] 전환은 **그림에만** 건다 — 아래 나레이션 시각은 한 밀리초도 안 움직인다. */
  const alabels = [];
  narration.forEach((nr, k) => { fc.push(`[${narBase + k}:a]adelay=${nr.atMs}|${nr.atMs}[n${k}]`); alabels.push(`[n${k}]`); });
  if (bgmIdx >= 0) { fc.push(`[${bgmIdx}:a]volume=${Math.pow(10, (bgm.gainDb ?? -18) / 20).toFixed(4)}[bg]`); alabels.push("[bg]"); }
  const ln = p.audio?.loudnorm ?? LOUDNORM_DEFAULT;
  if (alabels.length) {
    fc.push(`${alabels.join("")}amix=inputs=${alabels.length}:duration=longest:dropout_transition=0:normalize=0[amixed]`);
    fc.push(`[amixed]loudnorm=I=${ln.I}:TP=${ln.TP}:LRA=${ln.LRA}[aout]`);
  }

  args.push("-filter_complex", fc.join(";"), "-map", "[vout]");
  /* 🔴 [R12 · `overlayVerified`] **날 프레임 한 장만 뽑는 갈래.**
     x264 를 **안 태운다** — 태우면 `-t` 가 다른 두 판이 **율 제어부터 갈려** 오버레이와 상관없이 프레임이 달라진다
     (그러면 «달라졌으니 그려졌다»가 **늘 참**이 되어 검사가 거저 초록이 된다 · AC-78 의 인코더판).
     `-map` 뒤의 `-ss` 는 **출력 쪽 건너뛰기**라 필터 그래프를 그대로 지나온 프레임을 집는다. */
  if (ctx.rawProbe) {
    args.push("-ss", Number(ctx.rawProbe.atSec).toFixed(3), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", outPath);
    return { args, tr };
  }
  if (alabels.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  args.push("-c:v", "libx264", ...X264, "-pix_fmt", "yuv420p", "-r", String(out.fps),
    "-t", bodySec.toFixed(3), "-movflags", "+faststart", outPath);
  return { args, tr };
}

/**
 * verifyOverlayDrawn — 🔴 **오버레이가 «나온 그림»에 정말 있나.** 계획서를 안 본다(AC-33).
 *
 *   ══ 왜 이게 있나 ══
 *     2026-09-17 에 `eof_action=pass` 탓에 **자막·제휴 고지·배지·엔드카드가 첫 프레임에만** 있었다.
 *     그런데 심사(`judge.ts disclosure`)가 보는 것은 `payload.disclosureCaption.text` — **계획서**다.
 *     ⇒ **고지가 통째로 안 실린 영상에 «고지 ✅»가 찍혔다.** 법으로 정해진 대가 표시라 그 도장이 제일 비싸다.
 *
 *   ══ 어떻게 재나 — 🔴 **한 층만 빼고 같은 그래프를 두 번 지나가 본다** ══
 *     ① 그 층이 **있는** 그래프에서 시각 T 의 날 프레임 한 장
 *     ② 그 층만 **뺀** 그래프에서 같은 T 의 날 프레임 한 장
 *     두 판의 차이는 **그 층 하나뿐**이다 ⇒ 바이트가 같으면 **안 그려진 것**이다.
 *   🔴 x264 를 안 태운다 — 태우면 율 제어 때문에 오버레이와 무관하게 달라져 **늘 «그려졌다»**가 된다.
 *   🔴 T 는 창 **한참 안쪽**으로 잡는다 — 모션(`fade`)은 시작 순간 투명도가 0 이라 그 자리에서 재면
 *      «안 그려졌다»가 나온다(맞는 말이지만 우리가 묻는 것이 아니다).
 *   🔴 못 재면 **`undefined`**(«못 쟀다»)다 — `false`(«재 봤고 없다»)로 바꾸지 않는다. 둘은 다른 사실이다(AC-9).
 */
async function verifyOverlayDrawn(bin, dir, ctxArgs, layerIdx) {
  const l = ctxArgs.layers[layerIdx];
  if (!l) return undefined;
  const win = Math.max(0, Number(l.endMs) - Number(l.startMs));
  if (win < 200) return undefined;                       // 너무 짧아 프레임 경계를 못 고른다 — 못 쟀다
  /* 창 안쪽 · 모션이 끝난 뒤 · 창 끝에서 한 프레임 물러선 자리. */
  const atMs = Number(l.startMs) + Math.min(Math.max(CAPTION_MOTION_MS * 2, Math.floor(win / 2)), Math.max(1, win - 80));
  const atSec = atMs / 1000;
  const withF = join(dir, "ovchk-with.raw");
  const withoutF = join(dir, "ovchk-without.raw");
  try {
    const a = buildRenderArgs({ ...ctxArgs, outPath: withF, rawProbe: { atSec } });
    /* 🔴 **층을 빼지 않는다 — 창만 옮긴다.**
       실측(2026-09-17 B2): 층을 통째로 빼면 `overlay` 필터가 **사라지고**, 그러면 색공간 왕복이 한 번 줄어
       **아무것도 안 그려도 픽셀이 달라진다** ⇒ «달라졌으니 그려졌다»가 늘 참이 되어 검사가 **거저 초록**이 된다.
       (실제로 그랬다: 옛 `eof_action=pass` 판을 그 방식으로 재 봤더니 **못 잡았다.**)
       ⇒ 필터 사슬의 **모양은 그대로 두고** 그 층의 창만 출력 밖으로 민다. 그러면 두 판의 차이가
       «그 시각에 그 층이 합성됐나» **하나뿐**이 된다. */
    const far = Math.round((Number(ctxArgs.bodySec) || 0) * 1000) + 10_000;
    const shifted = ctxArgs.layers.map((x, i) => (i === layerIdx ? { ...x, startMs: far, endMs: far + win } : x));
    const b = buildRenderArgs({ ...ctxArgs, layers: shifted, outPath: withoutF, rawProbe: { atSec } });
    await runFfmpeg(bin, a.args, 120_000);
    await runFfmpeg(bin, b.args, 120_000);
    if (!existsSync(withF) || !existsSync(withoutF)) return undefined;
    const x = readFileSync(withF), y = readFileSync(withoutF);
    if (!x.length || x.length !== y.length) return undefined;   // 크기가 다르면 우리가 뭘 잘못 뽑은 것이다 — «없다»가 아니다
    return !x.equals(y);
  } catch {
    return undefined;                                    // 🔴 못 쟀다. «없다»가 아니다
  } finally {
    for (const f of [withF, withoutF]) { try { rmSync(f, { force: true }); } catch { /* 무시 */ } }
  }
}

/**
 * 어느 층으로 확인하나 — 🔴 **법이 읽는 것부터**. 고지 자막 → 배지 → 첫 구절 자막.
 *   🔴 층이 하나도 없으면 `-1` 이고, 그때는 **키를 아예 안 보낸다**(«확인할 것이 없다»와 «못 쟀다»는 다르다).
 */
export function pickVerifyLayer(layers) {
  const L = Array.isArray(layers) ? layers : [];
  const byRole = (r) => L.findIndex((x) => x && x.role === r);
  for (const r of ["disclosure", "badge"]) { const i = byRole(r); if (i >= 0) return i; }
  return L.length ? L.findIndex((x) => x && (x.endMs - x.startMs) >= 200) : -1;
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

    const layers = [];   // { file, role, startMs, endMs, motion } — 🔴 `role` 은 «무엇을 먼저 확인하나»를 고르는 데 쓴다(법이 읽는 것부터)
    const phrases = p.captions?.phrases ?? [];
    const hasBadge = !!p.overlay?.badge?.text;
    /* [R10-6] 한 줄 글자 수 상한 — 🔴 **서버가 줄 때만** 끊는다(안 주면 지금까지와 똑같다 · AC-92). */
    const maxLineChars = p.captions?.type?.maxCharsPerLine ?? null;
    /* [R12-1] 🔴 자막 등장 방식. **안 주면 `none`** 이고, `none` 이면 아래 인자 조립이 **종전 갈래를 그대로** 탄다(무회귀). */
    const wantMotion = String(p.captions?.type?.motion ?? "none");
    const motionOn = CAPTION_MOTIONS.has(wantMotion) && wantMotion !== "none";
    /* [R12-2] 🔴 컷 전환. **안 주면 `none`** 이고, `none` 이면 아래에서 종전 `concat` 갈래를 그대로 탄다(무회귀). */
    let wantTransition = String(p.transition ?? "none");
    let wantTransitionOn = !!TRANSITION_XFADE[wantTransition];
    /* 🔴 **못 낸 꾸밈은 여기 쌓여 보고로 나간다** — 조용히 버리지 않는다(AC-9). 막지도 않는다(CLAUDE §9): 영상은 나간다. */
    const decoNotes = [];
    /* 🔴 **모션을 걸면 배지를 자막 PNG 에서 떼어 낸다.**
       배지는 **제휴 고지**다(§16B). 자막과 한 장에 있으면 `slide_up`·`pop` 이 캔버스를 통째로 움직여 **고지가 같이 흔들린다** —
       법이 읽는 표시를 우리가 꾸미는 꼴이다. 떼면 배지는 **한 장만** 찍어 영상 내내 고정으로 얹는다(상시 배지 · 캡처도 줄어든다).
       ⚠️ `none` 일 때는 **종전대로 한 장에 같이** 찍는다 — 여기서 갈라 두면 안 걸어도 그림이 달라진다. */
    const splitBadge = motionOn && hasBadge;
    for (const ph of phrases) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), [phraseHtml(ph, maxLineChars), { badge: hasBadge && !splitBadge, endcard: false }]);
      const f = join(dir, `ov-${String(ph.idx).padStart(3, "0")}.png`);
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      const startMs = Math.max(0, Number(ph.startMs) || 0);
      const endMs = Math.max(0, Number(ph.endMs) || 0);
      layers.push({ file: f, role: "phrase", startMs, endMs, motion: motionForLayer("phrase", endMs - startMs, wantMotion) });
    }
    // 시작 3초 제휴 고지(§16B) — 자막과 같은 자리에 먼저 얹는다.
    if (p.disclosureCaption?.text) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), [esc(p.disclosureCaption.text), { badge: hasBadge && !splitBadge, endcard: false }]);
      const f = join(dir, "ov-disc.png");
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      /* 🔴 `motionForLayer` 가 여기엔 언제나 `none` 을 준다 — **대조군이 같은 영상 안에 있다**(AC-68). */
      layers.unshift({ file: f, role: "disclosure", startMs: 0, endMs: Math.max(1000, Number(p.disclosureCaption.untilMs) || 3000), motion: motionForLayer("disclosure", 3000, wantMotion) });
    }
    const totalMs = sceneFiles.reduce((a, s) => a + s.durMs, 0);
    /* 떼어 낸 배지 — 영상 내내 고정(모션 0). 자막보다 **먼저** 얹어 자막이 위로 오게 한다. */
    if (splitBadge) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), ["", { badge: true, endcard: false }]);
      const f = join(dir, "ov-badge.png");
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      layers.unshift({ file: f, role: "badge", startMs: 0, endMs: totalMs, motion: "none" });
    }
    if (p.overlay?.endcard?.text) {
      await page.evaluate(([html, opts]) => window.__show(html, opts), ["", { badge: false, endcard: true }]);
      const f = join(dir, "ov-end.png");
      writeFileSync(f, await page.screenshot({ type: "png", omitBackground: true }));
      layers.push({ file: f, role: "endcard", startMs: Math.max(0, totalMs - 2500), endMs: totalMs, motion: motionForLayer("endcard", 2500, wantMotion) });
    }
    await shot(page, shotKey, "01-오버레이");

    /* ③ 드라이런이면 여기까지 — 굽지도 올리지도 않는다(계약: 발행 위험 0). */
    if (dryRun) return { dryRun: true, notes: [`재료 ${sceneFiles.length}장면 · 자막 ${layers.length}장 준비(굽지 않음)`] };

    /* ④ ffmpeg — 입력 순서: 장면들 → 오버레이 PNG 들 → 나레이션 → BGM.
     *
     *   ═══ [R12-1·2] 🔴 **인자를 함수로 뽑은 까닭은 «되돌릴 길»이다** ═══
     *     모션·전환은 **꾸밈**이다. 꾸미다 인코딩이 죽으면 **영상이 아예 안 나간다** — 그건 §9 가 막지 말라던 바로 그 꼴이다.
     *     ⇒ 꾸밈을 켠 채 실패하면 **꾸밈만 끄고 한 번 더 굽고**, «못 냈어요»를 적는다(AC-9). 영상은 나간다.
     *   🔴 **무회귀**: `deco:false` 로 부르면 아래 어느 줄도 종전과 다르지 않다 — 그게 이 갈래의 계약이다.
     */
    const maxSec = Math.max(1, Number(out.maxSeconds) || 60);
    /* 🔴 길이는 **장면 끝**으로 잠근다(2026-09-14 라이브 회귀 · B-1 이 BGM 실측하다 잡음).
       종전엔 `-t maxSeconds` 였다. BGM 은 `-stream_loop -1`(무한)이고 `amix=duration=longest` 라서
       **오디오가 무한**이 되고, 그 무한이 maxSeconds 에서 잘렸다 →
       장면 합계 < maxSeconds 면 차이만큼 **정지 화면 + 음악**이 꼬리로 붙는다(실측: 영상 12s · 컨테이너 15s).
       «60초 쇼츠»인데 본체가 47초면 13초가 정지 화면이다 — 쇼츠에선 이탈로 직결된다.
       BGM 이 없을 땐 longest = 나레이션이라 **드러나지 않았다**(무음 하니스가 영영 못 잡는 결함이었다).
       기준은 `totalMs`(= concat 이 실제로 만들어 내는 길이 = 장면 durMs 합). 이어진 타임라인이면 max(endMs) 와 같다.
       이 값으로 잠가야 아래 `durationMs` 보고도 **참말**이 된다(심사 duration_fit 이 그 값을 믿는다).
       🔴 [R12-2] 전환은 컷 «안»에서 빌리므로 **이 값이 안 바뀐다** — 바뀌면 코인이 틀어진다. */
    const bodySec = Math.min(maxSec, totalMs / 1000);
    const outPath = join(dir, "out.mp4");

    const buildArgs = (deco) => buildRenderArgs({ sceneFiles, layers, narration, bgm, out, outPath, bodySec, deco, wantTransition, payload: p });

    /* 🔴 꾸밈을 켤 수 있나 — **재서** 정한다. 못 내면 «못 냈어요»를 적고 **그냥 굽는다**(막지 않는다 · CLAUDE §9). */
    let deco = motionOn || wantTransitionOn;
    if (wantTransitionOn && !hasXfade()) {
      decoNotes.push("이 컴퓨터의 ffmpeg 가 낮아서 컷 전환 없이 만들었어요.");
      wantTransition = "none"; wantTransitionOn = false;
      deco = motionOn;
    }
    let built = buildArgs(deco);
    if (deco && built.tr.skipped > 0) decoNotes.push(`장면 ${built.tr.skipped}군데는 너무 짧아서 전환을 못 넣었어요.`);
    try {
      await runFfmpeg(bin, built.args);
    } catch (e) {
      /* 🔴 **되돌릴 길** — 꾸미다 죽었으면 꾸밈만 끄고 한 번 더. 영상이 안 나가는 것보다 꾸밈이 없는 게 낫다. */
      if (!deco) throw e;
      decoNotes.push("자막 움직임·컷 전환을 넣다가 이 컴퓨터에서 실패해서, 그것만 빼고 만들었어요.");
      console.warn(`[render-video] 꾸밈 인코딩 실패 → 꾸밈 없이 재시도: ${String(e?.message ?? e).slice(0, 200)}`);
      deco = false;
      built = buildArgs(false);
      await runFfmpeg(bin, built.args);
    }
    const decoApplied = deco;
    /* 🔴 [R12] **오버레이가 나온 그림에 정말 있나** — 심사가 계획서만 보던 자리를 러너가 **재서** 메운다(AC-33).
       못 재면 `undefined` 를 보내고, 서버는 그걸 «아직 못 쟀어요»(pending)로 그린다 — **«괜찮다»가 아니다.**
       🔴 **막지 않는다**(§9): 여기서 `false` 가 나와도 영상은 그대로 올라가고, 서버가 그 사실을 말할 뿐이다. */
    const verifyIdx = pickVerifyLayer(layers);
    const overlayVerified = verifyIdx >= 0
      ? await verifyOverlayDrawn(bin, dir, { sceneFiles, layers, narration, bgm, out, outPath, bodySec, deco: decoApplied, wantTransition, payload: p }, verifyIdx)
      : undefined;
    if (overlayVerified === false) decoNotes.push(`«${layers[verifyIdx]?.role ?? "자막"}»이 영상에 안 실렸어요 — 올리기 전에 확인해 주세요.`);
    if (!existsSync(outPath) || statSync(outPath).size < 1024) throw BLOCK("encode", "영상이 만들어지지 않았어요(빈 파일).");

    /* ⑤ 포스터 — 후보 몇 장을 뽑아 **가장 선명한** 1장. */
    const posterDir = join(dir, "poster-%02d.jpg");
    await runFfmpeg(bin, ["-y", "-i", outPath, "-vf", `fps=1/${Math.max(1, Math.floor(bodySec / 5))},scale=${out.w}:${out.h}`, "-frames:v", "5", "-q:v", "3", posterDir], 120_000);
    const cands = [1, 2, 3, 4, 5].map((i) => join(dir, `poster-0${i}.jpg`)).filter((f) => existsSync(f));
    const poster = pickSharpest(cands);
    if (!poster) throw BLOCK("encode", "포스터를 뽑지 못했어요.");

    /* ⑤-b 대표 프레임 **지문 재료**(B-1 §1.5 · 서버가 «같은 그림을 여러 계정에 올리는 것»을 잡는 데 쓴다).
       포스터를 32×32 회색으로 줄여 raw 로 뽑는다 — 새 의존성 0(ffmpeg 이 이미 있다).
       🔴 **못 만들면 키를 아예 안 보낸다.** 빈 문자열을 보내면 «못 쟀다»와 «닮지 않았다»가 섞이고,
          서버는 그걸 «지문이 다르다 = 통과»로 읽는다(AC-9). 키가 없으면 서버가 **판정 보류**로 정직하게 처리한다. */
    let thumbGray;
    try {
      const rawPath = join(dir, "tg.raw");
      await runFfmpeg(bin, ["-y", "-i", poster, "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", rawPath], 30_000);
      if (existsSync(rawPath)) {
        const buf = readFileSync(rawPath);
        // 32×32 회색 = 정확히 1024바이트. 크기가 다르면 뭔가 잘못 뽑힌 것이라 **보내지 않는다**.
        if (buf.length === 1024) thumbGray = buf.toString("base64");
      }
    } catch { /* 지문은 있으면 좋은 것 — 못 만들었다고 영상을 버리지 않는다(키를 안 보내면 그만이다) */ }

    /* ⑥ 업로드 — presigned PUT(러너에 R2 자격 0). */
    const bytes = await putTo(p.upload.putUrl, outPath, "video/mp4");
    await putTo(p.upload.posterPutUrl, poster, "image/jpeg");

    /* 🔴 **잰 값으로 보고한다**(2026-09-14 C 수리 · AC-31 의 짝).
       종전엔 `-t bodySec` 을 그대로 되돌려 보냈다 — 계획과 산출물이 갈라져도 보고가 «일관»되니 심사가 못 잡았다.
       ffprobe 가 있으면 컨테이너·영상·오디오·실프레임을 싣고, 없으면 **새 필드를 아예 안 보낸다**(계획값을 잰 값인 척 하지 않는다).
       옛 서버·새 서버 어느 쪽에 붙어도 깨지지 않는다(추가 필드는 전부 선택). */
    const m = measureOutput(outPath);
    const planMs = Math.round(bodySec * 1000);
    const durationMs = m?.videoMs || planMs;
    return {
      render: {
        key: p.upload.key, posterKey: p.upload.posterKey,
        durationMs, bytes,
        frameCount: m?.frameCount || Math.round((planMs / 1000) * out.fps),
        ...(m ? { containerMs: m.containerMs, videoMs: m.videoMs, audioMs: m.audioMs, plannedMs: planMs, measured: true } : {}),
        ...(thumbGray ? { thumbGray } : {}),
        /* 🔴 **못 쟀으면 키를 아예 안 보낸다** — `false` 로 메우면 «재 봤고 없다»가 되어 심사가 **떨어뜨린다**.
           «못 쟀다»와 «없다»는 다른 사실이다(AC-9 · `thumbGray` 와 같은 규칙). */
        ...(typeof overlayVerified === "boolean" ? { overlayVerified } : {}),
        ffmpegVersion: _version || undefined,
      },
      notes: [`${sceneFiles.length}장면 · 자막 ${layers.length} · ${(bytes / 1024 / 1024).toFixed(1)}MB`,
        m ? `실측 컨테이너 ${(m.containerMs / 1000).toFixed(2)}s · 영상 ${(m.videoMs / 1000).toFixed(2)}s · 오디오 ${m.audioMs ? `${(m.audioMs / 1000).toFixed(2)}s` : "없음"} · ${m.frameCount}프레임`
          : "ffprobe 없음 — 길이는 계획값(심사는 꼬리 판정을 보류한다)",
        /* [R12-1·2] 🔴 **낸 것과 못 낸 것을 둘 다 적는다** — «걸었다»만 적으면 못 걸었을 때가 안 보이고,
           «못 걸었다»만 적으면 걸렸는지 아무도 모른다(AC-9 · 서버가 이 줄을 화면 문장으로 옮긴다). */
        overlayVerified === true ? `자막·고지가 영상에 실린 것을 확인했어요(«${layers[verifyIdx]?.role ?? "자막"}» 층으로 쟀어요)`
          : overlayVerified === false ? null : "자막이 영상에 실렸는지는 못 쟀어요",
        decoApplied && motionOn ? `자막 움직임: ${wantMotion}` : null,
        decoApplied && wantTransitionOn && built.tr.ms ? `컷 전환: ${wantTransition}(${built.tr.ms}ms · ${built.tr.at.filter(Boolean).length}군데)` : null,
        ...decoNotes,
      ].filter(Boolean),
    };
  } catch (e) {
    try { const pg = ctx.pages()[0]; if (pg) await failShot(pg, shotKey); } catch { /* 무시 */ }
    throw e;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
  }
}

export const channel = "video";
