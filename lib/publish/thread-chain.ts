/**
 * lib/publish/thread-chain.ts — 쓰레드 **연결글**(스레드 2~3개)로 나누는 순수 함수(DESIGN §5C.1 「500자 이하 · 스레드 2~3개 연결」).
 *   AC 신규 2026-09-16(B2 · R8CLOSE §B5).
 *
 *   ══ 왜 지금까지 없었나 ══
 *     계약에는 **«스레드 2~3개 연결»이 적혀 있었다.** 그런데 발행은 `buildCaption(piece, 500)` 으로
 *     **500자에서 그냥 자르고 한 덩이로** 올렸다 — 넘친 글은 **조용히 사라졌고**, 잘린 자리는 문장 한가운데였다.
 *     🔴 AC-73 과 **같은 모양**이다: 계약 문장은 고쳐졌는데 **발행 경로가 안 따라왔다.**
 *     그래서 이번엔 **순수 함수(여기) + 커넥터(threads.ts) + 하니스** 셋을 같이 만든다.
 *
 *   ══ 🔴 이 파일이 지키는 것 ══
 *     1. **문장 한가운데서 끊지 않는다.** 문단 → 문장 → 줄 순서로 자리를 찾고, **마지막에야** 글자로 자른다.
 *     2. **고지는 첫 글에 남는다**(§16B · 공정위는 «댓글·본문 중간»을 부적절한 위치로 본다).
 *     3. **태그도 첫 글에.** 쓰레드 토픽 태그는 게시물당 1개이고, 사람들이 보는 건 **첫 글**이다.
 *     4. **글자를 잃지 않는다** — 넘치면 조각을 늘린다. 조각 상한에 부딪히면 **그 사실을 돌려준다**(조용히 안 버린다).
 *
 *   🔴 순수 함수다(네트워크·DB 0). `scripts/verify-thread-chain.mjs` 가 이걸 그대로 돌린다.
 */

/** 쓰레드 글 한 개의 글자 상한(플랫폼 규격). */
export const THREADS_MAX = 500;
/**
 * 조각 상한. 계약은 «2~3개»인데 **막지 않는다**(CLAUDE §9 — 하드 게이트 0).
 *   대신 **넘치면 넘쳤다고 말한다**. 5는 «그래도 이 이상은 읽는 사람이 없다»는 실무 한계이고,
 *   여기에 걸리면 마지막 조각에서 글자를 잃으므로 **반환값에 `dropped` 로 적는다**(AC-9 — 조용히 0으로 만들지 않는다).
 */
export const MAX_PARTS = 5;

export interface ThreadChain {
  /** 올릴 순서대로. 길이 1이면 종전과 똑같은 한 덩이 발행이다. */
  parts: string[];
  /** 🔴 조각 상한에 걸려 **버린 글자 수**. 0이 아니면 호출부가 그 사실을 남긴다. */
  dropped: number;
  /**
   * 🔴 **문장 한가운데서 끊었나.** 문단·문장·줄 자리를 못 찾아 **낱말이나 글자**에서 잘랐다는 뜻이다.
   *   이 파일의 존재 이유가 «문장 한가운데서 안 끊는다» 인데, 한 문장이 상한보다 긴 원고에서는 **끊을 수밖에 없다.**
   *   그때 **조용히 끊지 않는다** — `dropped`(버린 글자)를 말하는 것과 **같은 규율의 남은 반쪽**이다(AC-9).
   */
  cutMidSentence: boolean;
  /** 조각 경계마다 **어디서 끊었는지**(감사 한 줄에 그대로 실린다). 조각이 1개면 빈 배열이다. */
  cutKinds: CutKind[];
  /** 계약(2~3개)을 넘었나 — 막지 않고 **말한다**. */
  overContract: boolean;
}

/** 어디서 끊었나 — 앞엣것일수록 «좋은» 자리다. `word`·`char` 는 **문장 한가운데**다. */
export type CutKind = "end" | "paragraph" | "sentence" | "line" | "word" | "char";

/* ─────────────────────────── 끊을 자리 찾기 ─────────────────────────── */

/**
 * 🔴 **문장 끝**으로 볼 자리들. 한국어는 마침표를 자주 생략하므로 **종결어미**도 같이 본다
 *   («~했어요» «~임» «~함» «~네요» 뒤에서 끊어도 사람이 읽기에 자연스럽다).
 *   ⚠️ 영어 약어(Mr. 등)는 우리 글에 거의 없어 안 다룬다 — 없는 정확도를 있는 척하지 않는다.
 */
const SENTENCE_END = /([.!?…]["'」』)\]]?|(?:다|요|임|함|죠|네|까|군|겠)[.!?]?["'」』)\]]?)(\s|$)/g;

/** 자를 수 있는 자리 목록(끝 offset) — 앞엣것일수록 «더 좋은» 자리다. */
function breakPoints(s: string): { paragraph: number[]; sentence: number[]; line: number[] } {
  const paragraph: number[] = []; const sentence: number[] = []; const line: number[] = [];
  /* 문단 = 빈 줄. 제일 좋은 자리다(글쓴이가 스스로 나눈 곳). */
  const paraRe = /\n[ \t]*\n/g;
  for (let m = paraRe.exec(s); m; m = paraRe.exec(s)) paragraph.push(m.index + m[0].length);
  /* 줄바꿈 — 쓰레드는 «줄바꿈 리듬»이 문법이라(계약 visual) 문단 다음으로 좋은 자리다. */
  const lineRe = /\n/g;
  for (let m = lineRe.exec(s); m; m = lineRe.exec(s)) line.push(m.index + m[0].length);
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(s); m; m = SENTENCE_END.exec(s)) sentence.push(m.index + m[1].length + m[2].length);
  return { paragraph, sentence, line };
}

/**
 * `s` 앞머리에서 `limit` 안에 들어가는 **가장 좋은 끊을 자리**를 고른다.
 *   문단 → 문장 → 줄 → (없으면) 공백 → (그래도 없으면) 글자.
 *   🔴 **너무 짧게 끊지 않는다**: 자리를 찾았는데 `limit` 의 40% 도 안 되면 한 급 낮은 자리를 본다
 *      (첫 문단이 한 줄이라고 «한 줄 + 나머지 전부»로 쪼개면 그게 더 이상하다).
 */
export function cutAt(s: string, limit: number): number { return cutAtDetail(s, limit).at; }

/**
 * `cutAt` 과 같은 일을 하되 **어디서 끊었는지**까지 돌려준다.
 *   🔴 이게 따로 있는 이유: «문장 한가운데서 끊었다»를 **밖에서 알 수 있어야** 감사에 남길 수 있다.
 *      종전엔 글자로 자른 사실이 이 함수 안에서 **소리 없이 사라졌다**(AC-9 의 그 모양).
 */
export function cutAtDetail(s: string, limit: number): { at: number; kind: CutKind } {
  if (s.length <= limit) return { at: s.length, kind: "end" };
  const head = s.slice(0, limit + 1);
  const { paragraph, sentence, line } = breakPoints(head);
  const floor = Math.floor(limit * 0.4);
  const best = (arr: number[]): number => {
    let b = 0;
    for (const p of arr) if (p <= limit && p > b) b = p;
    return b;
  };
  const kinds: CutKind[] = ["paragraph", "sentence", "line"];
  for (const [i, arr] of [paragraph, sentence, line].entries()) {
    const p = best(arr);
    if (p >= floor) return { at: p, kind: kinds[i] };
  }
  /* 자연스러운 자리가 없다 — 낱말 경계라도 지킨다. */
  const sp = head.lastIndexOf(" ", limit);
  if (sp >= floor) return { at: sp + 1, kind: "word" };
  /* 🔴 여기까지 오면 «한 낱말이 limit 보다 길다»는 뜻이다(주소 같은 것). 그때만 글자로 자른다. */
  return { at: limit, kind: "char" };
}

/* ─────────────────────────── 나누기 ─────────────────────────── */

/**
 * 🔴 **정본** — 본문을 연결글 조각으로 나눈다.
 * @param head 첫 조각 **맨 앞**에 반드시 붙을 것(대가 고지). 없으면 "".
 * @param body 나눌 본문.
 * @param tail 첫 조각 **맨 뒤**에 붙을 것(토픽 태그). 없으면 "".
 *
 * 🔴 `head` 와 `tail` 이 **둘 다 첫 조각**인 이유: 고지는 §16B(법)이고, 태그는 쓰레드가 게시물당 1개만 받으며
 *    사람들이 타고 들어오는 것이 **첫 글**이기 때문이다. 마지막 조각에 태그를 두면 아무도 안 본다.
 */
export function splitThreadChain(head: string, body: string, tail: string, limit = THREADS_MAX, maxParts = MAX_PARTS): ThreadChain {
  const H = String(head ?? "").trim();
  const T = String(tail ?? "").trim();
  let rest = String(body ?? "").trim();

  /* 첫 조각은 고지·태그가 자리를 먼저 가져간다 — 남는 만큼만 본문이 들어간다. */
  const firstRoom = limit - (H ? H.length + 2 : 0) - (T ? T.length + 2 : 0);
  /* 🔴 고지·태그만으로 이미 꽉 찼다 — 본문 0자라도 **고지는 반드시 나간다**(법이 먼저 쓴다 · AC-73). */
  if (firstRoom <= 0) {
    const only = [H, T].filter(Boolean).join("\n\n").slice(0, limit);
    return { parts: [only], dropped: rest.length, overContract: false, cutMidSentence: false, cutKinds: [] };
  }

  const parts: string[] = [];
  const cutKinds: CutKind[] = [];
  let dropped = 0;
  for (let i = 0; i < maxParts && rest.length; i++) {
    const room = i === 0 ? firstRoom : limit;
    const { at, kind } = cutAtDetail(rest, room);
    /* 마지막 조각(원문 끝)은 «우리가 끊은 자리»가 아니라 원래 끝이다 — 세지 않는다. */
    if (kind !== "end") cutKinds.push(kind);
    const chunk = rest.slice(0, at).trim();
    rest = rest.slice(at).trim();
    parts.push(i === 0 ? [H, chunk, T].filter(Boolean).join("\n\n") : chunk);
    /* 🔴 상한에 걸렸는데 남은 글이 있다 — **버린다고 말한다**(조용히 사라지게 두지 않는다). */
    if (i === maxParts - 1 && rest.length) { dropped = rest.length; break; }
  }
  if (!parts.length) parts.push([H, T].filter(Boolean).join("\n\n"));

  /* 🔴 낱말·글자에서 끊었다 = **문장 한가운데**다. 막지 않는다 — **말한다**(§9 · AC-9). */
  const cutMidSentence = cutKinds.some((k) => k === "word" || k === "char");
  return { parts, dropped, overContract: parts.length > 3, cutMidSentence, cutKinds };
}

/* ─────────────────────────── 이어 올리기(순수 루프) ─────────────────────────── */

/** 한 조각을 올리는 일. 커넥터가 진짜 API 를, 하니스가 가짜를 끼운다. */
export type ThreadPostFn = (text: string, replyToId: string | null) => Promise<{ ok: true; id: string } | { ok: false; detail: string }>;

export interface ChainRunResult {
  /** 게시된 id 를 순서대로(이어 올린 것 포함). */
  done: string[];
  /** 끝까지 갔나. false 면 `detail` 에 사유가 있다(`progress:` 로 시작하면 **올리다 멈춘 게 아니라 못 남겨서 멈춘 것**이다). */
  ok: boolean;
  failedAt?: number;
  detail?: string;
}

/**
 * 🔴 **이어 올리기 — 이 라운드에서 제일 조용히 틀릴 자리다.**
 *
 *   AC-73 이 난 모양이 정확히 이것이다: 계약은 고쳐졌는데 **발행 경로가 안 따라왔고**, 올라가긴 하니
 *   «성공»으로 보였다. 여기서도 `replyToId` 를 안 넘기면 조각들이 **서로 모르는 낱개 글 3개**가 되는데
 *   **어느 검사도 그걸 안 본다**(세 개 다 200 이니까).
 *   ⇒ 그래서 루프를 **순수 함수로 뽑아** 하니스가 «2번째가 1번째의 답글인가»를 직접 묻게 한다.
 *
 *   🔴 **이미 올린 것은 다시 안 올린다** — `done` 을 받아 그 다음부터 간다. 중간에 죽은 뒤 다음 틱이
 *      1번부터 다시 올리면 **같은 글이 두 번 나가고 되돌릴 수 없다**(이 채널에서 제일 무서운 사고).
 *   🔴 **한 조각 올릴 때마다 `onProgress`** — 마지막에 몰아서 저장하면 위 사고가 그대로 난다.
 */
export async function runThreadChain(
  parts: string[],
  done: string[],
  post: ThreadPostFn,
  onProgress?: (done: string[]) => Promise<void>,
): Promise<ChainRunResult> {
  const out = [...done];
  for (let i = out.length; i < parts.length; i++) {
    /* 첫 조각은 새 글, 나머지는 **바로 앞 글의 답글**. 이 한 줄이 «연결»이다. */
    const r = await post(parts[i], i > 0 ? out[i - 1] : null);
    if (!r.ok) return { done: out, ok: false, failedAt: i, detail: r.detail };
    out.push(r.id);
    /* 🔴 **남기지 못하면 더 올리지 않는다.** «어디까지 올렸나»를 못 적은 채 계속 올리면,
       다음 틱이 **1조각부터 다시** 올려 같은 글이 두 번 나간다(되돌릴 수 없다).
       더 올리는 것보다 **여기서 그치는 쪽**이 되돌릴 수 있다 — 호출부가 `progress:` 로 그 사실을 안다. */
    if (onProgress) {
      try { await onProgress([...out]); }
      catch (e) { return { done: out, ok: false, failedAt: i, detail: `progress:${String((e as Error)?.message ?? e).slice(0, 80)}` }; }
    }
  }
  return { done: out, ok: true };
}
