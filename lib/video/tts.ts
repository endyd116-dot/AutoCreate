/**
 * lib/video/tts.ts — 나레이션: 읽기 전처리(결정론) · 발화 예산 · Gemini TTS 합성(폴백) · WAV 소도구.
 *   AM 원본: ../AutoMarketing/lib/creative-tts.ts (순수부 + synthesizeNarration 발췌 복사 2026-09-15 · 원본 342534db8 2026-09-11 · ai-meter 의존 제거 · R2 는 AC r2.ts)
 *   원칙(AM §6-6): 자막이 본체·음성은 보조 → 이 파일의 어떤 실패도 영상 제작을 막지 않는다(전부 graceful).
 *   ① 읽는 글 ≠ 보는 글(대본 별도) ② 길이 동기화(초당 4.6음절 역산 예산) ③ 읽기 전처리(3.3㎡→삼점삼 제곱미터 · ₩250,000→이십오만 원) ④ 목소리=변주 voiceId ⑤ 대본은 광고법·날조 게이트 통과 후 ⑥ 실존 인물 목소리 모방 금지(프리빌트만).
 *   기본 provider 는 타입캐스트(tts-typecast.ts) · 여기의 Gemini 합성은 폴백(어절 시각 없음 → 자막 균등 분할 · 계약 §0.1-2).
 */
import { MODEL_TTS } from "../ai-models";
import { recordAiUsage } from "../ai";
import { r2Configured, r2Put } from "../r2";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* ═══ ① 읽기 전처리(결정론 변환 표) ═══ */
export function readNumberKo(raw: string): string {
  const s = String(raw ?? "").replace(/,/g, "");
  if (s.includes(".")) { const [i, f] = s.split("."); return `${readNumberKo(i)}점${[...f].map((d) => "영일이삼사오육칠팔구"[Number(d)] ?? d).join("")}`; }
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}
export function readMoneyKo(raw: string): string {
  const n = Number(String(raw ?? "").replace(/[^\d]/g, ""));
  if (n === 0) return "0원";
  if (!Number.isFinite(n) || n <= 0) return String(raw);
  if (n >= 100000000 && n % 100000000 === 0) return `${n / 100000000}억 원`;
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000}만 원`;
  if (n >= 10000) return `${Math.floor(n / 10000)}만 ${n % 10000}원`;
  return `${n}원`;
}
const UNIT_READ: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/(\d+(?:\.\d+)?)\s*㎡/g, (m) => `${readNumberKo(m[1])} 제곱미터`],
  [/(\d+(?:\.\d+)?)\s*평/g, (m) => `${readNumberKo(m[1])} 평`],
  [/(\d+)\s*[Hh](?![a-z])/g, (m) => `${readNumberKo(m[1])}시간`],
  [/₩\s*([\d,]+)/g, (m) => `${readMoneyKo(m[1])}`],
  [/([\d,]+)\s*원/g, (m) => `${readMoneyKo(m[1])}`],
  [/(\d+(?:\.\d+)?)\s*%/g, (m) => `${readNumberKo(m[1])} 퍼센트`],
  [/([\d,]+)\s*명/g, (m) => `${readNumberKo(m[1].replace(/,/g, ""))}명`],
  [/(\d+(?:\.\d+)?)\s*(?:km|킬로)/gi, (m) => `${readNumberKo(m[1])} 킬로미터`],
  [/(\d+(?:\.\d+)?)\s*(?:kg)/gi, (m) => `${readNumberKo(m[1])} 킬로그램`],
];
/** 아는 영문만 한국식 발음으로(자동 알파벳 규칙 금지 — «ON»→«오엔» 사고). 모르는 영단어는 그대로. */
const EN_READ_KO: Record<string, string> = {
  AI: "에이아이", IT: "아이티", TV: "티비", PC: "피씨", SNS: "에스엔에스", DM: "디엠", CEO: "씨이오", OK: "오케이", QR: "큐알", VIP: "브이아이피", DIY: "디아이와이",
  YOUTUBE: "유튜브", INSTAGRAM: "인스타그램", NETFLIX: "넷플릭스", FACEBOOK: "페이스북", NAVER: "네이버", KAKAO: "카카오", GOOGLE: "구글", SHORTS: "쇼츠", BLOG: "블로그", COUPANG: "쿠팡",
  EVENT: "이벤트", OPEN: "오픈", SALE: "세일", CLASS: "클래스", CAFE: "카페", TIP: "팁", APP: "앱", KTX: "케이티엑스", SRT: "에스알티", LED: "엘이디", USB: "유에스비",
};
export function readEnglishKo(text: unknown): string { return String(text ?? "").replace(/[A-Za-z]{1,12}/g, (w) => EN_READ_KO[w.toUpperCase()] ?? w); }
/** 테넌트 읽기 사전(페르소나 profile.reading — { 원문: 읽는 법 }) — 전역 사전보다 먼저 이긴다. 없으면 null. */
export type SpeakReadingDict = Record<string, string>;
export function applyReadingDict(text: string, dict: SpeakReadingDict | null | undefined): string {
  if (!dict) return text;
  let s = text;
  for (const [from, to] of Object.entries(dict).sort((a, b) => b[0].length - a[0].length)) { if (from && to && from !== to && from.length <= 60) s = s.split(from).join(to); }
  return s;
}
export function preprocessForSpeech(text: unknown, dict?: SpeakReadingDict | null): string {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  s = applyReadingDict(s, dict);
  for (const [re, fn] of UNIT_READ) s = s.replace(re, (...args) => fn(args as unknown as RegExpMatchArray));
  s = readEnglishKo(s);
  return s.replace(/[·•▶▲★☆♥#*_~`]/g, " ").replace(/\s{2,}/g, " ").trim();
}

/* ═══ ② 길이 동기화 ═══ */
/** 한국어 나레이션 속도(초당 음절) — 자막 읽기(5.5자/초)보다 느리다. */
export const SPEECH_SYLLABLES_PER_SEC = 4.6;
/** 컷 경계 꼬리 여백(ms). */
export const ONETAKE_TAIL_PAD_MS = 300;
export function speechCharBudget(durationMs: number): number { const sec = Math.max(0.5, (Number(durationMs) || 0) / 1000); return Math.max(4, Math.floor(sec * SPEECH_SYLLABLES_PER_SEC)); }
export function syllablesOf(text: unknown): number { return [...String(text ?? "").replace(/\s/g, "")].length; }
/** 음절 수 → 발화 초(순수). */
export function speechSecondsOf(syllables: number): number { return Math.round((Math.max(0, syllables) / SPEECH_SYLLABLES_PER_SEC) * 10) / 10; }
export function checkScriptFit(script: string, durationMs: number): { ok: boolean; chars: number; budget: number; note: string } {
  const chars = syllablesOf(script); const budget = speechCharBudget(durationMs);
  return { ok: chars <= budget, chars, budget, note: chars <= budget ? `나레이션 ${chars}자 / 예산 ${budget}자` : `나레이션 ${chars}자가 ${budget}자 예산을 넘습니다 — 말이 잘리거나 영상보다 길어집니다.` };
}

/* ═══ WAV 소도구 ═══ */
export function wrapPcmAsWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  // Buffer.concat 의 제네릭이 ArrayBufferLike 라 명시 캐스트(런타임 무영향)
  const byteRate = (sampleRate * channels * bitsPerSample) / 8; const blockAlign = (channels * bitsPerSample) / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]) as Buffer;
}
export function pcmRateFromMime(mime: string): number { const m = String(mime ?? "").match(/rate=(\d{4,6})/); return m ? Number(m[1]) : 24000; }
export function wavDurationMs(buf: Buffer): number {
  try {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return 0;
    let off = 12, byteRate = 0, dataSize = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString("ascii", off, off + 4); const size = buf.readUInt32LE(off + 4);
      if (id === "fmt " && off + 16 <= buf.length) byteRate = buf.readUInt32LE(off + 16);
      if (id === "data") { dataSize = size; break; }
      off += 8 + size + (size % 2);
    }
    if (!byteRate || !dataSize) return 0;
    return Math.round((dataSize / byteRate) * 1000);
  } catch { return 0; }
}

/* ═══ ③ Gemini TTS(폴백 provider) ═══ */
/** Gemini 프리빌트 보이스(실존 인물 모방 0). 변주 voiceId 가 이 목록이면 Gemini, 아니면 타입캐스트 id. */
export const GEMINI_VOICES = ["Charon", "Aoede", "Puck", "Fenrir", "Kore"] as const;
export function isGeminiVoice(v: unknown): boolean { return (GEMINI_VOICES as readonly string[]).includes(String(v)); }

export interface TtsWord { text: string; startMs: number; endMs: number }
export type TtsResult =
  | { ok: true; key: string; mime: "audio/wav"; bytes: number; durationMs: number; words: TtsWord[]; provider: "gemini" | "typecast"; costUsd: number; notes?: string[] }
  | { ok: false; reason: string; costUsd: 0; httpStatus?: number };

/** synthesizeGemini — 한 문장(또는 짧은 문단) → wav(R2). 어절 시각 없음(words=[]). */
export async function synthesizeGemini(a: { tenantId: number; pieceId: number; text: string; voice?: string | null; keySuffix: string; dict?: SpeakReadingDict | null }): Promise<TtsResult> {
  const base = preprocessForSpeech(a.text, a.dict);
  if (!base) return { ok: false, reason: "읽을 대본이 없습니다.", costUsd: 0 };
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, reason: "Gemini 키가 없어 음성을 만들 수 없습니다.", costUsd: 0 };
  if (!r2Configured()) return { ok: false, reason: "R2 미설정", costUsd: 0 };
  const voice = isGeminiVoice(a.voice) ? String(a.voice) : "Charon";
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(`${GEMINI_API_BASE}/${MODEL_TTS}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: base }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    if (!resp.ok) return { ok: false, reason: `Gemini TTS HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 120)}`, costUsd: 0, httpStatus: resp.status };
    const data = (await resp.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    let b64: string | undefined, mime = "audio/wav";
    for (const p of data.candidates?.[0]?.content?.parts ?? []) { const d = p.inlineData?.data ?? p.inline_data?.data; if (d) { b64 = d; mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? mime; break; } }
    if (!b64) return { ok: false, reason: "음성 데이터가 비어 있습니다.", costUsd: 0 };
    let buf: Buffer = Buffer.from(b64, "base64");
    const isRiff = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF";
    if (!isRiff) buf = wrapPcmAsWav(buf, pcmRateFromMime(mime));
    const durationMs = wavDurationMs(buf);
    const key = `autocreate/${a.tenantId}/${a.pieceId}/tts/narration-${a.keySuffix}.wav`;
    await r2Put(key, buf, "audio/wav");
    const outTok = data.usageMetadata?.candidatesTokenCount ?? Math.round(durationMs / 40);
    const costUsd = Math.round(outTok / 1_000_000 * 10 * 1e6) / 1e6;   // TTS 출력 단가 $10/M 보수 추정
    void recordAiUsage({ tenantId: a.tenantId, purpose: "tts", model: MODEL_TTS, inTokens: data.usageMetadata?.promptTokenCount ?? 0, outTokens: outTok, costUsd, ref: `piece:${a.pieceId}:tts:${a.keySuffix}` });
    return { ok: true, key, mime: "audio/wav", bytes: buf.length, durationMs, words: [], provider: "gemini", costUsd };
  } catch (e) { return { ok: false, reason: `Gemini TTS 예외: ${String((e as Error)?.message || e).slice(0, 120)}`, costUsd: 0 }; }
  finally { clearTimeout(timer); }
}
