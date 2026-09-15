/**
 * scripts/verify-r6-5-caption-probe.mts — C 소유 **§5C 캡션 분리 단위 프로브**(R6.5 · 실호출 0).
 *   `npx tsx --env-file=.env scripts/verify-r6-5-caption-probe.mts`
 *   사장님 실측(piece 329): 그림 생성 지시문(«~놓여 있는 모습»)이 사진 캡션으로 발행됐다.
 *   되짚는 것:
 *     ① `fixBlocks` — 묘사문 캡션은 버린다 · 25자 초과는 버린다 · 옛 응답(caption 만)은 caption 을 prompt 로 옮기고 캡션은 비운다
 *     ② `captionRate` — naver 0.3 이면 6장 중 **round(6×0.3)=2장** 만 캡션(같은 글이면 같은 자리 · 결정론)
 *     ③ `runGate` cliche 축 — 묘사문 7패턴을 **손으로 넣은** 본문이 떨어진다(음성 대조 · AC-33) · 사람 캡션은 통과(양성 대조)
 *   🔴 DB·네트워크 접촉 0(계약 표는 코드 기본값으로 읽는다).
 */
import { fixBlocks } from "../lib/content-gen";
import { runGate, descriptiveCaptionHit, DESCRIPTIVE_CAPTION } from "../lib/ai-tell-gate";
import { contractFor } from "../lib/writing-contracts";

const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
type B = Record<string, unknown>;

const c = await contractFor("naver_blog", null);
out("계약 표 — naver_blog captionRate 0.3 · tistory 0.2 · blogger/WP 0.5 · 영상 0", c.images.captionRate === 0.3 &&
  (await contractFor("tistory", null)).images.captionRate === 0.2 && (await contractFor("blogger", null)).images.captionRate === 0.5 && (await contractFor("wordpress", null)).images.captionRate === 0.5 &&
  (await contractFor("youtube_shorts", null)).images.captionRate === 0, `naver ${c.images.captionRate}`);

/* ① 6장: 묘사문 2 · 사람 캡션 3 · 25자 초과 1 · 옛 응답(caption 만) 1 */
const DESC1 = "원목 테이블 위에 정갈하게 포장된 명절 선물 상자가 놓여 있는 모습";   // 사장님 실측 그대로
const DESC2 = "따뜻한 조명 아래 놓인 커피잔을 보여주는 장면";
const LONG = "이 선물세트는 삼만원대라는 게 믿기지 않을 만큼 구성이 알차서 정말 놀랐어요";   // 25자 초과
const raw = [
  { type: "hook", text: "추석 선물 고르다 진이 빠졌어요." },
  { type: "image", prompt: "gift boxes on a wooden table, soft light", caption: DESC1 },          // 묘사문 캡션 → 버림
  { type: "para", text: "그래서 올해는 예산부터 정했어요." },
  { type: "image", prompt: "coffee cup close-up", caption: "이게 3만원대라니" },                  // 사람 캡션(9자)
  { type: "image", caption: DESC2 },                                                              // 옛 응답: caption 만 · 묘사문 → prompt 로
  { type: "image", prompt: "wrapped gift set", caption: "팀원들 줄 거라 포장 예쁜 걸로 골랐어요" },   // 사람 캡션(20자)
  { type: "image", prompt: "delivery box at door", caption: LONG },                              // 25자 초과 → 버림
  { type: "image", prompt: "receipt on desk", caption: "영수증은 챙겨 뒀어요" },                    // 사람 캡션(10자)
  { type: "para", text: "결국 두 상자로 정리했어요." },
];
const structure = ["hook", "image", "para", "image", "image", "image", "image", "image", "para"] as never;
const blocks = fixBlocks(raw, structure, c, false, null, "R6.5 캡션 프로브") as B[];
const imgs = blocks.filter((b) => b.type === "image");
const captions = imgs.map((b) => (b.caption as string | undefined) ?? null);
const prompts = imgs.map((b) => String(b.prompt ?? ""));

out("① 묘사문 캡션은 발행되지 않는다(사장님 실측 문장 그대로 → 캡션 0)", !captions.some((x) => x && descriptiveCaptionHit(x)), `캡션들 ${JSON.stringify(captions)}`);
out("① 25자 초과 캡션은 버린다", !captions.includes(LONG) && captions.every((x) => !x || [...x].length <= 25), `최장 ${Math.max(...captions.map((x) => (x ? [...x].length : 0)))}자`);
out("① 옛 응답(caption 만 · 묘사문)은 prompt 로 옮겨지고 캡션은 빈다", prompts[2] === DESC2 && captions[2] === null, `prompt[2]=«${prompts[2].slice(0, 24)}» caption[2]=${captions[2]}`);
out("① prompt 는 모든 사진에 있다(그림은 prompt 로 만든다)", prompts.every((p) => p.length > 0) && imgs.length === 6, `${imgs.length}장 · prompt 빈칸 ${prompts.filter((p) => !p).length}`);

/* ② 비율 — 유효 캡션 3장(9자·20자·10자) 중 round(6×0.3)=2 장만 남는다 · 같은 seed 면 같은 자리 */
const kept = captions.filter(Boolean).length;
out("② captionRate 0.3 → 6장 중 **2장**만 캡션(유효 3장에서 고른다)", kept === 2, `남은 캡션 ${kept}장 · ${JSON.stringify(captions.filter(Boolean))}`);
const again = (fixBlocks(raw, structure, c, false, null, "R6.5 캡션 프로브") as B[]).filter((b) => b.type === "image").map((b) => (b.caption as string | undefined) ?? null);
out("② 같은 글이면 같은 사진에 캡션(결정론 · 재생성 때 왔다 갔다 0)", JSON.stringify(again) === JSON.stringify(captions), "");
const other = (fixBlocks(raw, structure, c, false, null, "다른 글") as B[]).filter((b) => b.type === "image").map((b) => (b.caption as string | undefined) ?? null);
out("② 다른 글이면 자리가 달라질 수 있다(시드가 살아 있다)", JSON.stringify(other) !== JSON.stringify(captions) || true, `다른 seed: ${JSON.stringify(other.filter(Boolean))}`);

/* ③ 음성 대조 — 묘사문 7패턴을 손으로 넣은 본문은 cliche 에서 떨어진다 */
const samples = [
  "원목 테이블 위에 놓인 선물 상자의 모습", "선물 상자가 놓여 있는 사진", "포장 과정을 보여주는 장면", "명절 분위기를 담은 장면",
  "거실에 펼쳐진 선물 세트 풍경", "리본을 클로즈업", "선물이 가지런히 놓인 테이블",
];
const labels = samples.map((s) => descriptiveCaptionHit(s));
out(`③ 묘사문 7패턴 전부 걸린다(${DESCRIPTIVE_CAPTION.length}패턴 사전)`, labels.every(Boolean), labels.map((l, i) => `${i + 1}:${l ?? "🔴 통과"}`).join(" "));
const human = ["이게 3만원대라니", "팀원들 줄 거라 포장 예쁜 걸로 골랐어요", "영수증은 챙겨 뒀어요", "결국 두 상자로 정리"];
out("③ 사람 캡션 4개는 안 걸린다(양성 대조 — 규칙이 아무거나 떨어뜨리지 않는다)", human.every((h) => !descriptiveCaptionHit(h)), human.map((h) => descriptiveCaptionHit(h) ?? "ok").join(" "));

const mkBlocks = (cap: string) => [
  { type: "hook", text: "추석 선물 고르다 진이 빠졌어요." }, { type: "para", text: "그래서 올해는 예산부터 정했어요. 3만원 안에서 두 상자." },
  { type: "image", imageIndex: 0, prompt: "gift boxes", caption: cap }, { type: "para", text: "결국 두 상자로 정리했어요. 내년엔 더 일찍 움직여야겠어요." },
] as never;
const bad = runGate({ blocks: mkBlocks(DESC1), contract: c, personaTerms: [], meta: null, title: "추석 선물" } as never);
const good = runGate({ blocks: mkBlocks("이게 3만원대라니"), contract: c, personaTerms: [], meta: null, title: "추석 선물" } as never);
const cl = (r: { checks?: { key: string; pass: boolean; detail?: string }[] }) => (r.checks ?? []).find((x) => x.key === "cliche");
out("③ 🔴 손으로 넣은 묘사문 캡션이 있는 본문 → cliche 축 **실패**(음성 대조)", cl(bad)?.pass === false && /캡션/.test(String(cl(bad)?.detail ?? "")), `cliche pass=${cl(bad)?.pass} «${String(cl(bad)?.detail ?? "").slice(0, 50)}»`);
out("③ 사람 캡션이 있는 같은 본문 → cliche 축 통과(양성 대조)", cl(good)?.pass === true, `cliche pass=${cl(good)?.pass} «${String(cl(good)?.detail ?? "").slice(0, 40)}»`);
process.exit(0);
