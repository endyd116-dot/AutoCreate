/**
 * lib/video/tts-typecast.ts — 타입캐스트 TTS 어댑터(기본 provider · 계약 §0.1-2) — 문장별 합성 · 스마트 이모션 문맥 · `/with-timestamps` 어절·음절 시각 · `audio_tempo` 배속 굽기 · 선두/꼬리 무음 트림.
 *   AM 원본: ../AutoMarketing/lib/tts-typecast.ts (복사 2026-09-15 · 원본 33ad1d7da 2026-09-04 · ai-meter 제거 · R2 는 AC r2.ts · 실측 계약 전부 보존)
 *   계약(AM §5·§7): voice_id 기본 필재 `tc_68257f68bc6e3c161ab5078d` · model ssfm-v30 · language kor · prompt {emotion_type:"smart", previous_text, next_text} · output wav ·
 *     `audio_tempo`(≠1)는 파일 안에 구워져 «잰 길이 = 재생 길이» · durationMs 정본 = wav 실측(API audio_duration 과 ±30ms 넘게 다르면 notes).
 *   과금: 1자 = 1크레딧 = $0.000075(Lite $15/20만자) → ai_usage(purpose 'tts'). 키 = TYPECAST_API_KEY — 없으면 정직 실패(폴백 판단은 호출부 · 여기서 조용히 갈아타지 않는다).
 *   선두 무음 = 타임스탬프로(정확·싸다) · 꼬리 무음 = 진폭 주사(타임스탬프가 못 본다 · AM #894 실측 컷 경계마다 0.3초) · 안전벨트 2겹(한 번에 1.2초 넘게 못 자름 · 0.4초는 남긴다).
 */
import { recordAiUsage } from "../ai";
import { r2Configured, r2Put } from "../r2";
import { preprocessForSpeech, wavDurationMs, type SpeakReadingDict, type TtsResult, type TtsWord } from "./tts";
import { videoStub } from "./types";

const TYPECAST_API_URL = process.env.TYPECAST_API_URL || "https://api.typecast.ai/v1/text-to-speech";
export const TYPECAST_TIMESTAMPS_SUFFIX = "/with-timestamps";
export const TYPECAST_VOICE_PILJAE = "tc_68257f68bc6e3c161ab5078d";
export const TYPECAST_MODEL = "ssfm-v30";
export const TYPECAST_LANGUAGE = "kor";
export const TYPECAST_USD_PER_CHAR = Number(process.env.TYPECAST_USD_PER_CHAR || "0.000075");
export const TYPECAST_DURATION_TOLERANCE_MS = 30;
/** 기본 배속(AM SHORTS1 1.1x). */
export const TYPECAST_DEFAULT_TEMPO = 1.1;

export function typecastAvailable(): boolean { return !!(process.env.TYPECAST_API_KEY || "").trim(); }
export function typecastEndpoint(timestamps: boolean): string { return timestamps ? `${TYPECAST_API_URL}${TYPECAST_TIMESTAMPS_SUFFIX}` : TYPECAST_API_URL; }
export function clampTypecastTempo(v: unknown): number { const n = Number(v); if (!(n > 0)) return 1; return Math.min(2, Math.max(0.5, n)); }
export function isTtsThrottleStatus(httpStatus: unknown): boolean { const s = Number(httpStatus); return s === 429 || s === 503; }

/** API words/characters(초·소수) → ms 정수(순수·방어). */
export function parseTypecastWords(raw: unknown): TtsWord[] {
  if (!Array.isArray(raw)) return [];
  const out: TtsWord[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    const text = String(w?.text ?? "").trim(); const s = Number(w?.start), e = Number(w?.end);
    if (!text || !Number.isFinite(s) || !Number.isFinite(e) || e < s) continue;
    out.push({ text, startMs: Math.max(0, Math.round(s * 1000)), endMs: Math.max(0, Math.round(e * 1000)) });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/* ═══ 무음 트림(순수) ═══ */
export const SILENCE_AMP_THRESHOLD = 0.0316;
export const LEAD_SILENCE_KEEP_MS = 60;
export const LEAD_SILENCE_MIN_TRIM_MS = 120;
export const TAIL_SILENCE_KEEP_MS = 90;
export const TAIL_SILENCE_MIN_TRIM_MS = 120;
export const TAIL_SILENCE_MAX_TRIM_MS = 1200;
export const TAIL_MIN_REMAIN_MS = 400;

function wavChunks(buf: Buffer): { byteRate: number; blockAlign: number; bits: number; dataOff: number; dataSize: number } | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let off = 12, byteRate = 0, blockAlign = 0, bits = 0, dataOff = -1, dataSize = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4); const size = buf.readUInt32LE(off + 4);
    if (id === "fmt " && off + 24 <= buf.length) { byteRate = buf.readUInt32LE(off + 16); blockAlign = buf.readUInt16LE(off + 20); bits = buf.readUInt16LE(off + 22); }
    if (id === "data") { dataOff = off + 8; dataSize = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!byteRate || !blockAlign || dataOff < 0 || !dataSize) return null;
  if (dataOff + dataSize > buf.length) dataSize = buf.length - dataOff;
  return { byteRate, blockAlign, bits, dataOff, dataSize };
}
export function wavTailSilenceMs(buf: Buffer): number {
  try {
    const c = wavChunks(buf); if (!c || c.bits !== 16) return 0;
    const limit = Math.round(SILENCE_AMP_THRESHOLD * 32768);
    let end = c.dataOff + c.dataSize - (c.dataSize % 2);
    while (end - 2 >= c.dataOff) { if (Math.abs(buf.readInt16LE(end - 2)) > limit) break; end -= 2; }
    const quietBytes = (c.dataOff + c.dataSize) - end;
    return quietBytes <= 0 ? 0 : Math.round((quietBytes / c.byteRate) * 1000);
  } catch { return 0; }
}
export function trimWavTail(buf: Buffer, cutMs: number): { buf: Buffer; cutMs: number } {
  const want = Math.max(0, Math.round(Number(cutMs) || 0)); if (want <= 0) return { buf, cutMs: 0 };
  try {
    const c = wavChunks(buf); if (!c) return { buf, cutMs: 0 };
    let cutBytes = Math.round((want / 1000) * c.byteRate); cutBytes -= cutBytes % c.blockAlign;
    if (cutBytes <= 0 || cutBytes >= c.dataSize) return { buf, cutMs: 0 };
    const keep = c.dataSize - cutBytes;
    const out = Buffer.concat([Buffer.from(buf.subarray(0, c.dataOff)), buf.subarray(c.dataOff, c.dataOff + keep)]);
    out.writeUInt32LE(keep, c.dataOff - 4); out.writeUInt32LE(out.length - 8, 4);
    return { buf: out, cutMs: Math.round((cutBytes / c.byteRate) * 1000) };
  } catch { return { buf, cutMs: 0 }; }
}
export function trimWavLead(buf: Buffer, cutMs: number): { buf: Buffer; cutMs: number } {
  const want = Math.max(0, Math.round(Number(cutMs) || 0)); if (want <= 0) return { buf, cutMs: 0 };
  try {
    const c = wavChunks(buf); if (!c) return { buf, cutMs: 0 };
    let cutBytes = Math.round((want / 1000) * c.byteRate); cutBytes -= cutBytes % c.blockAlign;
    if (cutBytes <= 0 || cutBytes >= c.dataSize) return { buf, cutMs: 0 };
    const body = buf.subarray(c.dataOff + cutBytes, c.dataOff + c.dataSize);
    const out = Buffer.concat([Buffer.from(buf.subarray(0, c.dataOff)), body]);
    out.writeUInt32LE(body.length, c.dataOff - 4); out.writeUInt32LE(out.length - 8, 4);
    return { buf: out, cutMs: Math.round((cutBytes / c.byteRate) * 1000) };
  } catch { return { buf, cutMs: 0 }; }
}

export interface TypecastLineOpts { voiceId?: string | null; previousText?: string | null; nextText?: string | null; tempo?: number; timestamps?: boolean; dict?: SpeakReadingDict | null }

/** synthesizeTypecast — 한 문장 → wav(R2 `autocreate/{tid}/{pieceId}/tts/narration-{suffix}.wav`) + 어절 시각. */
export async function synthesizeTypecast(a: { tenantId: number; pieceId: number; text: string; keySuffix: string }, opts: TypecastLineOpts = {}): Promise<TtsResult> {
  const base = preprocessForSpeech(a.text, opts.dict);
  if (!base) return { ok: false, reason: "읽을 대본이 없습니다.", costUsd: 0 };
  if (!r2Configured()) return { ok: false, reason: "R2 미설정", costUsd: 0 };
  const apiKey = (process.env.TYPECAST_API_KEY || "").trim();
  if (!apiKey && !videoStub()) return { ok: false, reason: "TYPECAST_API_KEY가 없어 타입캐스트 음성을 만들 수 없습니다.", costUsd: 0 };
  const chars = [...base].length;
  const costUsd = Math.round(chars * TYPECAST_USD_PER_CHAR * 1e6) / 1e6;
  const key = `autocreate/${a.tenantId}/${a.pieceId}/tts/narration-${a.keySuffix}.wav`;
  if (videoStub()) {
    // 로컬 하니스 — 고정 응답: 음절 수 × 1/4.6초 길이의 무음 wav + 균등 어절 시각
    const durationMs = Math.max(600, Math.round((chars / 4.6) * 1000));
    const pcm = Buffer.alloc(Math.round(24000 * 2 * durationMs / 1000));
    const { wrapPcmAsWav } = await import("./tts");
    const buf = wrapPcmAsWav(pcm, 24000);
    await r2Put(key, buf, "audio/wav");
    const toks = base.split(/\s+/).filter(Boolean); const per = durationMs / Math.max(1, toks.length);
    const words: TtsWord[] = toks.map((t, i) => ({ text: t, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) }));
    void recordAiUsage({ tenantId: a.tenantId, purpose: "tts", model: "stub", inTokens: chars, outTokens: 0, costUsd: 0, ref: `piece:${a.pieceId}:tts:${a.keySuffix}` });
    return { ok: true, key, mime: "audio/wav", bytes: buf.length, durationMs, words, provider: "typecast", costUsd: 0, notes: ["stub"] };
  }
  const prompt: Record<string, string> = { emotion_type: "smart" };
  const prevT = preprocessForSpeech(opts.previousText ?? "", opts.dict); const nextT = preprocessForSpeech(opts.nextText ?? "", opts.dict);
  if (prevT) prompt.previous_text = prevT.slice(0, 300);
  if (nextT) prompt.next_text = nextT.slice(0, 300);
  const tempo = clampTypecastTempo(opts.tempo ?? TYPECAST_DEFAULT_TEMPO);
  const wantTs = opts.timestamps !== false;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(typecastEndpoint(wantTs), {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": apiKey }, signal: ctrl.signal,
      body: JSON.stringify({ voice_id: String(opts.voiceId ?? "").trim() || TYPECAST_VOICE_PILJAE, text: base, model: TYPECAST_MODEL, language: TYPECAST_LANGUAGE, prompt, output: { audio_format: "wav", ...(tempo !== 1 ? { audio_tempo: tempo } : {}) } }),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ""); return { ok: false, reason: `타입캐스트 합성 실패(HTTP ${resp.status}) ${t.slice(0, 140)}`, costUsd: 0, httpStatus: resp.status }; }
    let buf: Buffer; let words: TtsWord[] = []; let charTimes: TtsWord[] = []; let apiDurationMs = 0; const notes: string[] = [];
    const ctype = String(resp.headers.get("content-type") ?? "");
    if (/json/i.test(ctype)) {
      const j = (await resp.json()) as Record<string, unknown>;
      if (typeof j.audio === "string" && j.audio.length > 64) buf = Buffer.from(j.audio, "base64");
      else {
        const dlUrl = ["audio_download_url", "audio_url", "url"].map((k) => (typeof j[k] === "string" ? (j[k] as string) : "")).find((v) => /^https?:\/\//.test(v)) || "";
        if (!dlUrl) return { ok: false, reason: `타입캐스트 응답에 오디오가 없습니다(키: ${Object.keys(j).join(",")})`, costUsd: 0 };
        const dl = await fetch(dlUrl, { signal: AbortSignal.timeout(20_000) });
        if (!dl.ok) return { ok: false, reason: `타입캐스트 오디오 다운로드 실패(HTTP ${dl.status})`, costUsd: 0, httpStatus: dl.status };
        buf = Buffer.from(await dl.arrayBuffer());
      }
      words = parseTypecastWords(j.words); charTimes = parseTypecastWords(j.characters);
      if (Number(j.audio_duration) > 0) apiDurationMs = Math.round(Number(j.audio_duration) * 1000);
      if (wantTs && !words.length) notes.push("타임스탬프를 요청했는데 words 가 비어 있습니다(구절 자막은 균등 분할로 폴백).");
    } else buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 256) return { ok: false, reason: "타입캐스트 오디오가 비어 있습니다.", costUsd: 0 };
    // 선두 무음(타임스탬프) — 자른 만큼 words 도 당긴다
    const firstSpeechMs = [...words, ...charTimes].reduce((acc, w) => (acc < 0 ? w.startMs : Math.min(acc, w.startMs)), -1);
    if (firstSpeechMs > 0) {
      const want = firstSpeechMs - LEAD_SILENCE_KEEP_MS; const whole = wavDurationMs(buf);
      if (want >= LEAD_SILENCE_MIN_TRIM_MS && want <= TAIL_SILENCE_MAX_TRIM_MS && (whole <= 0 || whole - want >= TAIL_MIN_REMAIN_MS)) {
        const t = trimWavLead(buf, want);
        if (t.cutMs > 0) { buf = t.buf; const shift = (arr: TtsWord[]) => arr.map((w) => ({ text: w.text, startMs: Math.max(0, w.startMs - t.cutMs), endMs: Math.max(0, w.endMs - t.cutMs) })); words = shift(words); charTimes = shift(charTimes); notes.push(`선두 정적 ${t.cutMs}ms 제거(자막 시각 동기 이동)`); }
      }
    }
    // 꼬리 무음(진폭)
    { const whole = wavDurationMs(buf); const quiet = wavTailSilenceMs(buf); const want = quiet - TAIL_SILENCE_KEEP_MS;
      if (want >= TAIL_SILENCE_MIN_TRIM_MS && want <= TAIL_SILENCE_MAX_TRIM_MS && !(whole > 0 && whole - want < TAIL_MIN_REMAIN_MS)) { const t2 = trimWavTail(buf, want); if (t2.cutMs > 0) { buf = t2.buf; notes.push(`꼬리 정적 ${t2.cutMs}ms 제거`); } }
      else if (want >= TAIL_SILENCE_MIN_TRIM_MS) notes.push(`꼬리 무음 ${quiet}ms 가 조각(${whole}ms)에 비해 커서 자르지 않음`); }
    const durationMs = wavDurationMs(buf) || apiDurationMs;
    if (apiDurationMs && durationMs && Math.abs(apiDurationMs - durationMs) > TYPECAST_DURATION_TOLERANCE_MS) notes.push(`API audio_duration ${apiDurationMs}ms ≠ wav 실측 ${durationMs}ms(실측 채택)`);
    await r2Put(key, buf, "audio/wav");
    void recordAiUsage({ tenantId: a.tenantId, purpose: "tts", model: `typecast:${TYPECAST_MODEL}`, inTokens: chars, outTokens: 0, costUsd, ref: `piece:${a.pieceId}:tts:${a.keySuffix}` });
    return { ok: true, key, mime: "audio/wav", bytes: buf.length, durationMs, words, provider: "typecast", costUsd, ...(notes.length ? { notes } : {}) };
  } catch (e) { return { ok: false, reason: `타입캐스트 예외: ${String((e as Error)?.message || e).slice(0, 140)}`, costUsd: 0 }; }
  finally { clearTimeout(timer); }
}
