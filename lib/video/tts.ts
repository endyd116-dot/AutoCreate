/**
 * lib/video/tts.ts — 나레이션: 읽기 전처리(결정론) · 발화 예산 · Gemini TTS 합성(폴백) · WAV 소도구.
 *   AM 원본: ../AutoMarketing/lib/creative-tts.ts (순수부 + synthesizeNarration 발췌 복사 2026-09-15 · 원본 342534db8 2026-09-11 · ai-meter 의존 제거 · R2 는 AC r2.ts)
 *   원칙(AM §6-6): 자막이 본체·음성은 보조 → 이 파일의 어떤 실패도 영상 제작을 막지 않는다(전부 graceful).
 *   ① 읽는 글 ≠ 보는 글(대본 별도) ② 길이 동기화(초당 4.6음절 역산 예산) ③ 읽기 전처리(3.3㎡→삼점삼 제곱미터 · ₩250,000→이십오만 원) ④ 목소리=변주 voiceId ⑤ 대본은 광고법·날조 게이트 통과 후 ⑥ 실존 인물 목소리 모방 금지(프리빌트만).
 *   기본 provider 는 타입캐스트(tts-typecast.ts) · 여기의 Gemini 합성은 폴백(어절 시각 없음 → 자막 균등 분할 · 계약 §0.1-2).
 */
import { MODEL_TTS } from "../ai-models";
import { recordAiUsage } from "../ai";
import { leaseAiKey, reportAiKeyOutcome, redactKeys } from "../ai-key";   // [R8 · §3.3] 키를 고르는 자리 한 곳 — 🔴 `GEMINI_API_KEYS` 만 꽂은 집에서 여기가 env 를 직접 읽으면 «키 없음»으로 죽는다
import { r2Configured, r2Put } from "../r2";
import { videoStub } from "./types";

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
/** 사전 열쇠 공백 지운 형태의 최소 길이 — 이 아래는 안 문다(«A B»→«AB» 같은 두 글자가 아무 데나 걸리는 것을 막는다). */
export const READING_DICT_SQUASHED_MIN = 4;
/**
 * applyReadingDict — 테넌트 읽기 사전으로 치환.
 *
 *   🔴 [2026-09-19 · AM 3e425f2d4 가려내기에서 «급함»으로 잡힘] **열쇠에 공백이 있으면 그 열쇠는 영영 못 무는 자리가 있었다.**
 *      열쇠가 「쓸GO 닦GO」(2어절)인데 대본기가 「쓸GO닦GO가」(1어절)로 쓰면 부분문자열 치환이 안 걸려
 *      원문 그대로 합성기로 가고, 그 뒤 `readEnglishKo` 도 «GO» 를 모르니 타입캐스트가 «쥐오» 로 읽는다
 *      (AM 사장님 실사고 «쓸쥐오닦쥐오» · 우리 코드에서도 실행으로 재현했다).
 *   ⇒ **두 번 문다**: ① 열쇠 그대로(종전과 한 글자도 같다) ② 그다음 열쇠의 **공백을 지운 형태**.
 *      ②는 열쇠에 공백이 있을 때만 만들고, 지운 형태가 `READING_DICT_SQUASHED_MIN` 자 미만이면 안 만든다.
 *      ①이 먼저라 정본 표기가 이미 쓰인 문장은 **종전과 결과가 같다**(무회귀).
 *   ⚠️ 이건 **소리 쪽**만 고친 것이다. 화면 자막·원장에 남는 **글자**는 여전히 「쓸GO닦GO가」다 —
 *      그 짝(대본 프롬프트 + 결정론 교정)은 AM cee28b0d6 이 한 일이고, 가려내기 문서의 «받을 것» 에 있다.
 */
export function applyReadingDict(text: string, dict: SpeakReadingDict | null | undefined): string {
  if (!dict) return text;
  const pairs = Object.entries(dict).filter(([from, to]) => from && to && from !== to && from.length <= 60);
  let s = text;
  for (const [from, to] of [...pairs].sort((a, b) => b[0].length - a[0].length)) s = s.split(from).join(to);
  const squashed = pairs
    .filter(([from]) => /\s/.test(from))
    .map(([from, to]) => [from.replace(/\s+/g, ""), to] as const)
    .filter(([from]) => from.length >= READING_DICT_SQUASHED_MIN);
  for (const [from, to] of [...squashed].sort((a, b) => b[0].length - a[0].length)) s = s.split(from).join(to);
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

/* ═══════════ [AC-39] 세대 표식이 붙은 나레이션 키 ═══════════
 *   🔴 종전 키는 `…/tts/narration-l{i}.wav` — **줄 번호가 곧 키**였다. 문제는 «덮인다»가 아니라 **경합**이다:
 *      같은 piece 를 **다른 대본으로** 다시 만들면 `l0`·`l1` 이 옛 음성을 덮는데, 그 순간 이미 굽고 있던 렌더가
 *      그 wav 를 받아 가면 **대본과 음성이 어긋난 영상**이 나간다. Typecast↔Gemini 폴백도 서로를 덮었다.
 *   🔴 **R2 는 버전 관리가 없다**(Cloudflare 미제공 · B2 실측) — 덮으면 이전 판은 영영 없다.
 *   ⇒ 키에 **대본 세대**(`gen`)와 **provider** 를 넣는다. 같은 대본으로 이어달리기하면 gen 이 같아 **재사용이 그대로 산다**
 *      (재과금 0 규율 유지) · 대본이 바뀌면 **새 폴더**라 옛 음성은 남고 렌더가 그걸 집을 일이 없다.
 */
import { createHash } from "node:crypto";

/** 대본 세대 — 줄 텍스트만 해시한다(팩트체크 메타 같은 곁가지가 바뀌었다고 음성을 다시 굽지 않게). */
export function scriptGen(lines: { text?: unknown }[] | null | undefined): string {
  const body = (lines ?? []).map((l) => String(l?.text ?? "")).join("\n");
  return createHash("sha1").update(body, "utf8").digest("hex").slice(0, 8);
}
/** 나레이션 R2 키 — 🔴 **이 함수 하나가 만든다**(세 곳에서 손으로 조립하다 서로 덮었다). */
export function narrationKey(a: { tenantId: number; pieceId: number; gen?: string | null; keySuffix: string; provider: "typecast" | "gemini" }): string {
  const gen = String(a.gen ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 16) || "g0";
  return `autocreate/${a.tenantId}/${a.pieceId}/tts/${gen}/narration-${a.keySuffix}-${a.provider}.wav`;
}

export interface TtsWord { text: string; startMs: number; endMs: number }
export type TtsResult =
  | { ok: true; key: string; mime: "audio/wav"; bytes: number; durationMs: number; words: TtsWord[]; provider: "gemini" | "typecast"; costUsd: number; notes?: string[] }
  | { ok: false; reason: string; costUsd: 0; httpStatus?: number };

/** synthesizeGemini — 한 문장(또는 짧은 문단) → wav(R2). 어절 시각 없음(words=[]). */
export async function synthesizeGemini(a: { tenantId: number; pieceId: number; text: string; voice?: string | null; keySuffix: string; gen?: string | null; dict?: SpeakReadingDict | null }): Promise<TtsResult> {
  const base = preprocessForSpeech(a.text, a.dict);
  if (!base) return { ok: false, reason: "읽을 대본이 없습니다.", costUsd: 0 };
  if (!r2Configured()) return { ok: false, reason: "R2 미설정", costUsd: 0 };
  if (videoStub()) {
    /* 🔴 로컬 하니스(계약 §1.4b) — 여기 분기가 없어서 스텁 모드인데도 실호출이 나갔다(C 스모크 실측: gemini-tts ×4).
       `tts-typecast.ts` 와 같은 모양: 음절 수 ÷ 4.6초 길이의 무음 wav + 어절 시각 균등 분할 + ai_usage model "stub" 원가 0. */
    const durationMs = Math.max(600, Math.round(([...base].filter((ch) => /\S/.test(ch)).length / 4.6) * 1000));
    const buf = wrapPcmAsWav(Buffer.alloc(Math.round(24000 * 2 * durationMs / 1000)), 24000);
    const key = narrationKey({ tenantId: a.tenantId, pieceId: a.pieceId, gen: a.gen, keySuffix: a.keySuffix, provider: "gemini" });
    await r2Put(key, buf, "audio/wav");
    const toks = base.split(/\s+/).filter(Boolean); const per = durationMs / Math.max(1, toks.length);
    const words: TtsWord[] = toks.map((t, i) => ({ text: t, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) }));
    void recordAiUsage({ tenantId: a.tenantId, purpose: "tts", model: "stub", inTokens: 0, outTokens: 0, costUsd: 0, ref: `piece:${a.pieceId}:tts:${a.keySuffix}` });
    return { ok: true, key, mime: "audio/wav", bytes: buf.length, durationMs, words, provider: "gemini", costUsd: 0, notes: ["stub"] };
  }
  /* [R8 · §3.3] 🔴 키는 `lib/ai-key.ts` 가 고른다(글·사진·영상과 같은 풀). */
  const lease = leaseAiKey();
  const apiKey = lease?.key ?? "";
  if (!apiKey) return { ok: false, reason: "Gemini 키가 없어 음성을 만들 수 없습니다.", costUsd: 0 };
  const voice = isGeminiVoice(a.voice) ? String(a.voice) : "Charon";
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(`${GEMINI_API_BASE}/${MODEL_TTS}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: base }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    if (!resp.ok) {
      reportAiKeyOutcome(lease, resp.status === 429 ? "rate_limited" : "error");
      /* 🔴 오류 본문이 우리 주소(`?key=…`)를 되비칠 수 있다 — 사유로 나가기 전에 걷어 낸다. */
      return { ok: false, reason: redactKeys(`Gemini TTS HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 120)}`), costUsd: 0, httpStatus: resp.status };
    }
    reportAiKeyOutcome(lease, "ok");
    const data = (await resp.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    let b64: string | undefined, mime = "audio/wav";
    for (const p of data.candidates?.[0]?.content?.parts ?? []) { const d = p.inlineData?.data ?? p.inline_data?.data; if (d) { b64 = d; mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? mime; break; } }
    if (!b64) return { ok: false, reason: "음성 데이터가 비어 있습니다.", costUsd: 0 };
    let buf: Buffer = Buffer.from(b64, "base64");
    const isRiff = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF";
    if (!isRiff) buf = wrapPcmAsWav(buf, pcmRateFromMime(mime));
    const durationMs = wavDurationMs(buf);
    const key = narrationKey({ tenantId: a.tenantId, pieceId: a.pieceId, gen: a.gen, keySuffix: a.keySuffix, provider: "gemini" });
    await r2Put(key, buf, "audio/wav");
    const outTok = data.usageMetadata?.candidatesTokenCount ?? Math.round(durationMs / 40);
    const costUsd = Math.round(outTok / 1_000_000 * 10 * 1e6) / 1e6;   // TTS 출력 단가 $10/M 보수 추정
    void recordAiUsage({ tenantId: a.tenantId, purpose: "tts", model: MODEL_TTS, inTokens: data.usageMetadata?.promptTokenCount ?? 0, outTokens: outTok, costUsd, ref: `piece:${a.pieceId}:tts:${a.keySuffix}` });
    return { ok: true, key, mime: "audio/wav", bytes: buf.length, durationMs, words: [], provider: "gemini", costUsd };
  } catch (e) { return { ok: false, reason: `Gemini TTS 예외: ${String((e as Error)?.message || e).slice(0, 120)}`, costUsd: 0 }; }
  finally { clearTimeout(timer); }
}
