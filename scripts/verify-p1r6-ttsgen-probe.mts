/**
 * scripts/verify-p1r6-ttsgen-probe.mts — C 소유 **AC-39 세대 키 프로브**(계약 P1R6 · 메인 지시 2).
 *   `npx tsx --env-file=.env scripts/verify-p1r6-ttsgen-probe.mts`
 *   `scripts/verify-p1r6.mjs` 의 `ttsgen` 절이 자식으로 실행하고 `RESULT {json}` 줄을 읽는다.
 *
 *   되짚는 것(AC-39): R2 는 버전 관리가 없다 — 키가 겹치면 **이전 판은 영영 없다**.
 *     ① 같은 대본으로 이어달리기 = **같은 세대**(재사용이 살아 재과금 0)
 *     ② 대본이 바뀌면 **다른 폴더**(굽는 중인 렌더가 옛 음성을 집어 «대본과 어긋난 영상»이 나가는 경합 차단)
 *     ③ Typecast ↔ Gemini 폴백이 **서로 덮지 않는다**
 *     ④ 곁가지 메타(팩트체크 등)가 바뀌었다고 세대가 흔들리지 않는다(쓸데없는 재과금 0)
 *     ⑤ 자막(srt)도 같은 세대 아래에 있다
 *   🔴 네트워크·DB 접촉 0 — 순수 함수만 본다(그래서 빠르고, 초록이 곧 «키 규칙» 의 증거다).
 */
import { scriptGen, narrationKey } from "../lib/video/tts";

const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);

const A = [{ text: "겨울 이불 집에서 빨까?" }, { text: "코인워시가 싸게 먹혔어요" }];
const A2 = [{ text: "겨울 이불 집에서 빨까?" }, { text: "코인워시가 싸게 먹혔어요" }];          // 같은 대본(다른 객체)
const B = [{ text: "겨울 이불 집에서 빨까?" }, { text: "세탁소가 더 쌌어요" }];                  // 한 줄만 바뀐 대본
const withMeta = [{ text: "겨울 이불 집에서 빨까?", role: "hook", seconds: 3, cutIdx: 0 },
                  { text: "코인워시가 싸게 먹혔어요", role: "body", seconds: 4, cutIdx: 1 }];    // 곁가지만 붙은 같은 대본

const gA = scriptGen(A), gA2 = scriptGen(A2), gB = scriptGen(B), gMeta = scriptGen(withMeta as never);
out("① 같은 대본 → 같은 세대(이어달리기 재사용이 살아 재과금 0)", gA === gA2 && !!gA, `gen ${gA} = ${gA2}`);
out("② 대본이 바뀌면 다른 세대 = 다른 폴더(옛 음성을 덮지 않는다)", gA !== gB, `${gA} ≠ ${gB}`);
out("④ 곁가지 메타(role·seconds)가 붙어도 세대 불변(쓸데없는 재과금 0)", gA === gMeta, `${gA} = ${gMeta}`);

const kT = narrationKey({ tenantId: 7, pieceId: 42, gen: gA, keySuffix: "l0", provider: "typecast" });
const kG = narrationKey({ tenantId: 7, pieceId: 42, gen: gA, keySuffix: "l0", provider: "gemini" });
const kB = narrationKey({ tenantId: 7, pieceId: 42, gen: gB, keySuffix: "l0", provider: "typecast" });
out("③ Typecast ↔ Gemini 폴백이 서로 덮지 않는다(키에 provider)", kT !== kG && kT.includes("typecast") && kG.includes("gemini"), `${kT.split("/").pop()} ≠ ${kG.split("/").pop()}`);
out("② 대본이 다르면 **폴더**가 다르다(같은 줄 번호라도)", kT.split("/").slice(0, -1).join("/") !== kB.split("/").slice(0, -1).join("/"),
  `${kT.split("/").slice(-2).join("/")} vs ${kB.split("/").slice(-2).join("/")}`);

/* 🔴 덮어쓸 수 있는 «결정론 키» 가 하나도 없어야 한다 — 줄 번호만으로 만든 키는 다음 대본에 그대로 덮인다. */
const legacy = /narration-l\d+\.wav$/.test(kT);
out("⑤ 옛 모양(`narration-l{i}.wav` — 줄 번호가 곧 키)이 남아 있지 않다", !legacy, kT);

/* 세대가 비어도(옛 piece·세대 계산 실패) 키가 «폴더 없이» 나오면 안 된다 — 최소한 g0 로 격리된다. */
const kNone = narrationKey({ tenantId: 7, pieceId: 42, gen: null, keySuffix: "l0", provider: "typecast" });
out("세대를 모를 때도 폴더로 격리된다(g0 · 루트에 흩뿌리지 않는다)", /\/tts\/g0\//.test(kNone), kNone);
/* ───────── 곁다리: 채널 상한 자르기(계약 §2.3) — 순수 함수라 여기서 같이 잰다 ───────── */
const { clampSecondsForChannel } = await import("../lib/writing-contracts");
const clipped = clampSecondsForChannel("naver_clip", 60);
const kept = clampSecondsForChannel("youtube_shorts", 60);
out("naver_clip 60초 요청 → 30초로 잘린다(서버 규칙 · 화면 상수 아님)", clipped === 30, `naver_clip 60 → ${clipped}`);
out("youtube_shorts 60초는 그대로", kept === 60, `youtube_shorts 60 → ${kept}`);
process.exit(0);
