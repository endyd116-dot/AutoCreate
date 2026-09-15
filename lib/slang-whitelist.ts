/**
 * lib/slang-whitelist.ts — **신조어 화이트리스트**(DESIGN §5C.4 「존댓말 등급을 채널 계약이 고정 · **신조어는 페르소나 연령대에 맞게 사전 화이트리스트**」).
 *   🔎 출처: AC 신규(B-1 · R8CLOSE §B3 · 2026-09-16) — AM 원본 없음. 🔴 **순수 리프**(임포트 0 · DB·네트워크·AI 0).
 *
 *   ══ 🔴 표는 **여기 한 곳**이다 ══
 *     두 곳에 두면 갈린다 — 2026-09-15 코인 값이 정확히 그래서 낡았다(AC-78). 프롬프트도 검사도 **이 파일만** 본다.
 *
 *   ══ 왜 필요한가(정직하게) ══
 *     🔴 **오늘 당장 요즘 말을 잡는 검사는 없다.** `BANNED_TONE`(«역대급»·«끝판왕»·«레전드»·«미쳤다» — 넷 다 요즘 말)은
 *        `classifyBanned` 가 3층으로 갈라 두지만 `ai-tell-gate` 가 **tone 층을 세지 않는다**(그 파일 주석 «여기선 안 센다»).
 *        그러니 «지금 과차단이 난다»고 적으면 그건 거짓말이다.
 *     위험은 **다음 사람이 신조어를 목록에 한 줄 넣는 순간**이다. 그때 20대 계정 글이 «역대급»으로 반려되고
 *        재작성이 돌아 **돈이 두 배**가 된다 — 2026-09-15 `visualMin.faq` 사고와 **같은 모양**이다(네이버 글 10편 중 8편 재작성).
 *     ⇒ 그래서 표를 먼저 세우고, **검사와 프롬프트가 둘 다 이 표를 보게** 해 둔다.
 *
 *   ══ 🔴 연령대 칸이 아직 없다(AC-9 — 못 쟀으면 못 쟀다고 적는다) ══
 *     2026-09-16 라이브: `personas.profile` 열쇠 = `family`·`job`·`tone`·`home`·`interests`·`region`·`banned`.
 *     **`age`·`ageBand` 는 0건**이다. 고객이 나이를 적는 자리가 아직 없다.
 *     ⇒ `ageBand` 를 `PersonaProfile` 에 **더해 두고**(추가형 · 옛 페르소나는 그대로 null),
 *       **모르면 넓게 잡는다**(`UNKNOWN_ALLOWS_ALL`). 🔴 모른다고 **잡는 쪽**으로 기울면 그게 바로 돈 두 배다(§9).
 */

/** 페르소나 연령대. 🔴 값이 없으면 `null`(«모름») — `"30s"` 같은 기본값으로 **채우지 않는다**(대용물 금지 · AC-57). */
export type AgeBand = "10s" | "20s" | "30s" | "40s" | "50s";
export const AGE_BANDS: readonly AgeBand[] = ["10s", "20s", "30s", "40s", "50s"];
/** 화면에 쓸 이름 — 🔴 서버가 정본(두 곳이 다른 말을 하지 않게). */
export const AGE_SAY: Readonly<Record<AgeBand, string>> = { "10s": "10대", "20s": "20대", "30s": "30대", "40s": "40대", "50s": "50대" };

/**
 * 🔴 **모르면 넓게 잡는다.** 연령대를 모를 때 화이트리스트를 좁히면, 모르는 계정마다 멀쩡한 말이 잡혀
 *   재작성이 돌고 **돈이 두 배**가 된다. 막지 않는 쪽이 기본이다(CLAUDE §9).
 */
export const UNKNOWN_ALLOWS_ALL = true;

/**
 * 연령대별 **자연스러운 요즘 말**.
 *   🔴 이건 «쓰라는 목록»이 아니라 **«잡지 말라는 목록»**이다 — 이 낱말이 나와도 «AI 티»·«과장»으로 치지 않는다.
 *   🔴 위로 갈수록 좁다: 40·50대 목록의 말은 20·30대에서도 자연스럽다(아래 `slangAllowedFor` 가 **누적**한다).
 *      거꾸로는 아니다 — 50대 페르소나 글에 «억까»가 나오면 그건 말투가 어긋난 것이다.
 */
export const SLANG_BY_AGE: Readonly<Record<AgeBand, readonly string[]>> = {
  /** 누구 글에나 자연스러운 말 — 이미 일상어가 된 것들. */
  "50s": ["가성비", "갓성비", "핫하다", "대박", "찐", "꿀팁", "강추", "비추"],
  "40s": ["가심비", "워라밸", "소확행", "플렉스", "인싸", "짠테크", "무지출"],
  "30s": ["역대급", "끝판왕", "레전드", "미쳤다", "국룰", "넘사벽", "가즈아", "취향저격"],
  "20s": ["개꿀", "존맛", "JMT", "갓생", "억까", "혜자", "창렬", "싹쓸이각", "인정각"],
  "10s": ["킹받다", "어쩔티비", "폼 미쳤다", "완전 럭키비키", "찐텐"],
};

/**
 * 위 표를 뒤집은 것 — «이 낱말은 **몇 대까지** 자연스러운가»(그 칸의 `AGE_BANDS` 자리 번호).
 *   `AGE_BANDS` 는 어린 쪽부터다(10s=0 … 50s=4). 낱말이 `k` 번 칸에 적혀 있으면 **`k` 이하 세대**가 쓴다 —
 *   «가성비»(50s=4)는 누구나 쓰고, «킹받다»(10s=0)는 10대만 쓴다.
 *   🔴 표를 두 벌 적지 않으려고 **여기서 만든다**(AC-78). 한 낱말이 여러 칸에 있으면 **가장 넓은 쪽**(max)을 쓴다.
 *   🔴 이 방향을 한 번 뒤집어 적었다가 하니스 ②가 잡았다(20대 14개 · 50대 37개로 **거꾸로** 나왔다).
 */
const CEILING: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  AGE_BANDS.forEach((band, i) => { for (const w of SLANG_BY_AGE[band]) m.set(w, Math.max(m.get(w) ?? 0, i)); });
  return m;
})();

/** 값이 연령대인가 — 고객·옛 데이터가 아무거나 넣어도 안 터지게. */
export function toAgeBand(v: unknown): AgeBand | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (AGE_BANDS as readonly string[]).includes(s) ? (s as AgeBand) : null;
}

/**
 * 이 연령대에서 **잡지 않을** 낱말들.
 *   🔴 **누적**이다 — 20대 페르소나는 20대 말 + 30·40·50대 말을 다 쓴다(위 표 주석).
 *   🔴 모르면(`null`) **전부 허용**한다(`UNKNOWN_ALLOWS_ALL`) — 모른다고 잡으면 그게 돈 두 배다.
 */
export function slangAllowedFor(band: AgeBand | null): readonly string[] {
  if (!band) return UNKNOWN_ALLOWS_ALL ? [...CEILING.keys()] : [];
  const mine = AGE_BANDS.indexOf(band);
  return [...CEILING].filter(([, ceiling]) => ceiling >= mine).map(([w]) => w);
}

/** 이 낱말을 이 연령대에서 잡을 것인가. */
export function isAllowedSlang(word: unknown, band: AgeBand | null): boolean {
  const w = String(word ?? "").trim();
  if (!w) return false;
  return slangAllowedFor(band).includes(w);
}

/**
 * 프롬프트 ①칸(말투)에 넣을 한 줄 — 🔴 **화이트리스트의 반쪽은 «쓰지 마라»가 아니라 «써도 된다»** 이다.
 *   모델은 기본적으로 존댓말·무난한 말로 쓴다. 20대 계정인데 그러면 «그 나이 사람이 쓴 글»이 안 된다.
 *   🔴 호출 수가 늘지 않는다 — 같은 프롬프트에 한 줄 더하는 것이라 **값이 0원**이다.
 */
export function slangPromptLine(band: AgeBand | null): string {
  if (!band) return "";
  const mine = SLANG_BY_AGE[band];
  const older = AGE_BANDS.slice(AGE_BANDS.indexOf(band) + 1).flatMap((b) => SLANG_BY_AGE[b]);
  const younger = AGE_BANDS.slice(0, AGE_BANDS.indexOf(band)).flatMap((b) => SLANG_BY_AGE[b]);
  /* 🔴 조사를 붙이지 않는 어순으로 적는다 — «50대 이상가» 같은 한 글자가 «사람이 쓴 글»을 깬다(CLAUDE §3). */
  return [
    `이 사람은 ${AGE_SAY[band]}. 요즘 말은 ${AGE_SAY[band]}에서 실제로 쓰는 것만 쓴다(억지로 넣지 말고, 어울릴 때만 한두 번).`,
    mine.length ? `자연스러운 말: ${[...mine, ...older].slice(0, 12).join(" / ")}` : "",
    younger.length ? `🔴 쓰지 않는 말(더 어린 세대 말이라 어색하다): ${younger.slice(0, 8).join(" / ")}` : "",
  ].filter(Boolean).join(" ");
}
