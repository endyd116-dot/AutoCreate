/**
 * lib/ai-stub.ts — **글 쪽 실호출 대체 스위치**(R8 §2.1 첫 작업 · B-1 2026-09-15). 순수(DB 0 · 네트워크 0).
 *
 *   ══ 왜 ══
 *     영상은 `VIDEO_PROVIDER_STUB=1` 로 Veo·TTS 를 고정 응답으로 바꿔 **공짜로** 파이프라인을 되짚을 수 있었다.
 *     그런데 **글은 그런 스위치가 없었다**(grep 0) — «meta 에 값이 박히나» 같은 확인 한 번에 실호출 1편이 들었다.
 *     🔴 C 실측: 3편에 **$0.9819 · 호출 24건**(편당 $0.33 · 한 편이 생성·재작성·게이트로 쪼개진다).
 *     이 스위치 하나면 그 종류의 확인이 전부 0원이 된다(메인 지시 2026-09-15).
 *
 *   ══ 무엇을 바꾸나 ══
 *     🔴 **모델 호출 한 자리만** 바꾼다. 프롬프트 조립·블록 수리(`fixBlocks`)·게이트·유사도·재작성·이미지·저장은 **전부 그대로 돈다.**
 *     그래서 이 스위치로 초록이 나와도 «모델이 시킨 대로 쓰는가»는 **증명되지 않는다**(그건 실호출로만 안다 · AC-9).
 *     여기서 증명되는 것은 «우리 코드가 모델 응답을 제대로 받아 굴리는가»뿐이다.
 *
 *   ══ 🔴 안전핀 — 배포 런타임에서는 절대 안 켜진다 ══
 *     스텁이 켜진 채 라이브가 돌면 **가짜 본문이 고객 계정에 발행된다**($3.63 사고보다 나쁘다 — 돈이 아니라 남의 계정이다).
 *     그래서 `NETLIFY=true` 인데 `NETLIFY_DEV` 가 아니면(=진짜 배포 · 프리뷰 포함) **무시하고 큰 소리로 적는다.**
 *     프리뷰도 막는 이유: 프리뷰는 **같은 Neon DB** 를 본다 — 거기서 만든 가짜 글을 크론이 집어 발행할 수 있다.
 *
 *   ══ 손잡이 ══
 *     `AI_STUB=1`          — 글·사진 다 고정 응답(로컬 전용).
 *     `AI_STUB_IMAGE=1`    — **사진만** 고정 응답(글은 진짜로 부른다). §2.1 실호출은 이 모드로 돈다 — 값의 85%가 사진이다.
 *     `AI_STUB_CHARS=736`  — 본문 글자 수를 **못 박는다**. 안 주면 프롬프트가 요구한 분량을 그대로 따른다(=말 잘 듣는 모델).
 *                            🔴 C 가 실측한 «계약 1,500자인데 실제 736자» 를 **0원으로 재현**하는 자리다(§2.1).
 *   🔎 출처: AC 신규(계약 R8 §2.1 · B-1 · 2026-09-15) — AM 원본 없음.
 */
import type { Block } from "./blocks";

/** 스텁 응답의 모델 이름 — `ai_usage`·감사·로그에서 실호출과 **한눈에** 갈린다. */
export const AI_STUB_MODEL = "stub";

/**
 * 지금 이 런타임에서 글 스텁이 **실제로** 켜져 있나.
 *   🔴 «셸에서 켰다»가 아니라 «이 프로세스에 들어왔나»를 묻는다(AC-54). `/api/health` 의 `aiStub` 가 같은 값을 답한다.
 */
function localOnly(name: string): boolean {
  if (String(process.env[name] ?? "").trim() !== "1") return false;
  const onNetlify = String(process.env.NETLIFY ?? "").trim() === "true";
  const isDev = String(process.env.NETLIFY_DEV ?? "").trim() === "true";
  if (onNetlify && !isDev) {
    console.error(`[ai-stub] 🔴 배포 런타임이라 ${name} 을 무시한다 — 가짜 본문·가짜 사진이 고객 계정에 나갈 수 있다. 실호출로 진행한다.`);
    return false;
  }
  return true;
}

export function aiStubActive(): boolean { return localOnly("AI_STUB"); }

/**
 * 사진만 고정 응답으로 — **글은 진짜로** 부르고 싶을 때(§2.1 실호출 실험).
 *   🔴 근거(메인이 `ai_usage` 원장에서 뜯은 값): 3편 $0.9819 중 **사진 18장이 $0.8337(85%)**, 글 6호출은 $0.1482(15%).
 *      글만 보는 실험에 사진을 굽는 것은 **값의 85%를 버리는 것**이다.
 *   🔴 분량 측정에는 영향이 없다: `blocksCharCount` 는 image 블록을 애초에 안 센다.
 *      그리고 **이미지 블록은 그대로 둔다**(사진 «생성»만 끈다) — 블록을 빼면 `visual_min` 축이 걸려 실험에 잡음이 낀다.
 *   `AI_STUB=1` 이면 사진도 당연히 스텁이다.
 */
export function aiStubImagesActive(): boolean { return localOnly("AI_STUB_IMAGE") || aiStubActive(); }

/** 스텁 사진 — 회색 1칸 SVG(데이터 URI). R2 에 아무것도 쓰지 않는다. */
export function aiStubImage(): { url: string; key: string; mime: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d9d9d9"/><text x="320" y="240" font-size="28" text-anchor="middle" fill="#666">AI_STUB</text></svg>`;
  return { url: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, key: `stub/${Date.now()}.svg`, mime: "image/svg+xml" };
}

/** 스텁 본문임을 **본문 안에서** 알아보게 하는 표식 — 실수로 발행돼도 첫 줄에서 들킨다. */
const MARK = "【AI_STUB】이 글은 실호출 없이 만든 가짜 본문입니다 — 발행용이 아닙니다.";

/* ── 채움 문장 풀 — 같은 문장을 반복하면 `para_repeat`·`similarity` 가 즉시 걸려 파이프라인의 나머지를 못 본다. ── */
const SENT = [
  "이 문단은 모델 호출을 대신한 채움글이라 내용에는 뜻이 없습니다",
  "글자 수와 블록 배열만 실제와 같게 맞춰 두었습니다",
  "게이트와 블록 수리가 도는지 보려고 넣은 자리입니다",
  "여기에는 수치나 최상급 표현을 일부러 넣지 않았습니다",
  "문장 길이를 조금씩 달리해 두었기 때문에 편차 검사도 지나갑니다",
  "실제 원고라면 이 자리에 사람의 경험과 장면이 들어갑니다",
  "표현이 겹치지 않도록 문장을 돌려 가며 채우고 있습니다",
  "마지막까지 같은 말을 되풀이하지 않도록 순서를 바꿉니다",
];
const sentence = (i: number, n: number) => `${SENT[i % SENT.length]}(${n}).`;

/** 프롬프트가 요구한 글자 수 — «1,500~3,000자» 같은 표기를 찾아 가운뎃값. 못 찾으면 null(지어내지 않는다). */
function askedChars(prompt: string): number | null {
  const m = /([0-9][0-9,]{2,})\s*[~-]\s*([0-9][0-9,]{2,})\s*자/.exec(prompt);
  if (m) {
    const a = Number(m[1].replace(/,/g, "")), b = Number(m[2].replace(/,/g, ""));
    if (a > 0 && b >= a) return Math.round((a + b) / 2);
  }
  const one = /([0-9][0-9,]{2,})\s*자/.exec(prompt);
  if (one) { const v = Number(one[1].replace(/,/g, "")); if (v > 0) return v; }
  return null;
}

/** 본문 목표 글자 수 — 못 박은 값 > 프롬프트가 요구한 값 > 1,800(계약 중앙값 근처). */
export function stubTargetChars(prompt: string): number {
  const forced = Number(String(process.env.AI_STUB_CHARS ?? "").trim());
  if (Number.isFinite(forced) && forced > 0) return Math.min(20_000, Math.round(forced));
  return askedChars(prompt) ?? 1800;
}

/** 목표 글자 수를 채우는 블록 배열 — `fixBlocks` 가 계약 골격으로 다시 빚으므로 **재료**만 준다. */
function stubBlocks(target: number): Block[] {
  /* 🔴 세는 자는 **하나**다 — 계약(`length` 주석 «공백 포함 평문»)·게이트(`blocksCharCount`)와 같은 규칙으로 센다.
     처음엔 공백을 뺐다가 스모크에서 어긋났다. 분량을 다루는 자리에서 **세는 규칙이 다르면 그 자체가 오차**다. */
  const lenOf = (t: string) => t.replace(/\s+/g, " ").length;
  const out: Block[] = [{ type: "hook", text: `${MARK} 아래는 파이프라인 점검용 채움글입니다.` }];
  let chars = lenOf(out[0].text!);
  let i = 0, sec = 0;
  while (chars < target && out.length < 120) {
    sec += 1;
    const h2 = `${sec}. 점검용 소제목 ${sec}`;
    out.push({ type: "h2", text: h2 }); chars += lenOf(h2);
    for (let k = 0; k < 2 && chars < target; k++) {
      /* 한 문단은 2~4문장 — 문단 길이를 고르게 하지 않는다(문장 편차 축이 도는지 보려고). */
      const cnt = 2 + ((i + k) % 3);
      const text = Array.from({ length: cnt }, () => sentence(i++, i)).join(" ");
      out.push({ type: "para", text }); chars += lenOf(text);
    }
    if (chars < target && sec % 2 === 0) {
      const items = [sentence(i++, i), sentence(i++, i), sentence(i++, i)];
      out.push({ type: "list", items }); chars += lenOf(items.join(""));
    }
    if (chars < target && sec % 3 === 0) out.push({ type: "image", prompt: "plain desk scene, no text, no logo, soft daylight" });
  }
  return out;
}

/** 프롬프트에서 `- key xxx ·` 줄을 거둔다(디렉터 앵글 배분 — 모델이 받는 것과 같은 재료). */
function keysIn(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(/^-\s*key\s+(\S+)\s*·/gm)) out.push(m[1]);
  return out;
}

/** 프롬프트의 `[대상 채널] a, b` — 소재 후보의 channelHint 재료. */
function channelsIn(prompt: string): string[] {
  const m = /\[대상 채널\]\s*(.+)/.exec(prompt);
  return m ? m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * purpose 별 고정 응답. **모르는 purpose 는 null** — 그때는 실호출로 간다(모르는 것을 아는 척하지 않는다).
 *   🔴 `ops_verify` 는 **일부러 스텁하지 않는다**: «이 모델이 우리 키로 실제로 불리는가»를 묻는 호출이라(§4.9)
 *      스텁이 «ok» 라고 답하면 없는 모델이 등록된다. 그 호출은 한 단어짜리라 값도 사실상 0 이다.
 */
export function aiStubAnswer(a: { purpose: string; user: string; system?: string }): { text: string; json: unknown } | null {
  const prompt = `${a.system ?? ""}\n${a.user ?? ""}`;
  const pack = (json: unknown) => ({ text: JSON.stringify(json), json });
  switch (a.purpose) {
    case "content": {
      const blocks = stubBlocks(stubTargetChars(prompt));
      return pack({ title: "[스텁] 점검용 제목", blocks, tags: ["스텁", "점검"], affiliateChoice: 0 });
    }
    case "director": {
      const keys = keysIn(prompt);
      return pack({
        pieces: keys.map((k, i) => ({ key: k, angle: `[스텁] 점검용 관점 ${i + 1} — 실호출이 아니라 고정 응답입니다` })),
        reasons: ["[스텁] 이 이유 줄은 고정 응답입니다.", "[스텁] 실호출을 켜면 진짜 이유가 들어옵니다.", "[스텁] 화면 배치를 보려고 세 줄을 채웁니다."],
      });
    }
    case "topics": {
      const chs = channelsIn(prompt);
      return pack({
        candidates: Array.from({ length: 15 }, (_, i) => ({
          title: `[스텁] 점검용 소재 ${i + 1}`,
          angle: `[스텁] 점검용 관점 ${i + 1} — 고정 응답입니다`,
          seedKeywords: [`스텁${i + 1}`, "점검"],
          channelHint: chs.length ? chs[i % chs.length] : "",
          intent: (["info", "commercial", "mixed"] as const)[i % 3],
          pain: 0.5,
        })),
      });
    }
    case "video_script": {
      const lines = Array.from({ length: 6 }, (_, i) => ({ text: `[스텁] 점검용 대사 ${i + 1}`, role: i === 0 ? "hook" : i === 5 ? "closing" : "body", cutIdx: i }));
      return pack({
        hook: "[스텁] 점검용 훅", lines, closing: "[스텁] 점검용 마무리",
        cuts: Array.from({ length: 6 }, (_, i) => ({ key: `cut:${i}`, subject: "stylized 3D scene, no text, no logo", palette: "warm grey" })),
        youtube: { title: "[스텁] 점검용 제목", description: "\n[스텁] 점검용 설명입니다.", tags: ["스텁", "점검", "테스트"] },
      });
    }
    /* 팩트체크는 «검색해서 확인했다»는 뜻이라, 스텁은 **확인했다고 말하지 않는다** — 전부 unknown 으로 둔다(AC-9). */
    case "video_factcheck": return pack({ claims: [] });
    case "video_factfix": return pack({ lines: [] });
    case "video_reference": return pack({ sections: [], note: "[스텁] 점검용 템플릿" });
    default: return null;
  }
}
