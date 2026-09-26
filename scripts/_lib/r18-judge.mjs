/**
 * scripts/_lib/r18-judge.mjs — R18 «한 번 만들어 여러 곳에»의 **판정 넷**(C · 2026-09-26). 🔴 순수(임포트 0 · DB 0 · 네트워크 0).
 *
 *   ══ 왜 판정만 따로 두나 ══
 *   이 판은 **자가 제품보다 먼저 선다**(트리거 R18 §7 C). 제품이 아직 없으니 «제품을 불러 재는 팔»은 ⊘ 로 선다.
 *   그런데 ⊘ 만 찍는 자는 **살아 있는지 아무도 모른다** — 제품이 들어오는 날 처음 돌아 보고 «초록»이 나오면
 *   그게 «제품이 맞다»인지 «자가 눈이 멀었다»인지 못 가른다. ⇒ 판정을 데이터만 받는 순수 함수로 떼고,
 *   **자기시험(`selfTest`)이 오늘 양팔을 다 잰다**: 좋은 재료는 초록 · 나쁜 재료는 **그 축의 그 코드로** 빨강(AC-121 · AC-161).
 *
 *   ══ 재는 것 / 뜻하는 것 — 두 문장을 나란히(AC-178 ②) ══
 *   ① 코인   재는 것: 파생 piece 의 id 로 시작하는 `consume` 행 수 · 파생 전후 테넌트의 `consume` 행 수 차이
 *            뜻하는 것: 파생 때문에 고객 돈이 한 번이라도 더 나갔나
 *            🔴 갈리는 곳: 파생이 **원본의 ref 에 꼬리를 달아** 받으면(`piece:{원본}:reels`) 첫 문장은 조용하다 → 그래서 둘째 문장(전후 차이)을 같이 잰다.
 *   ② 같은 분 재는 것: 한 영상 가족(원본+파생)의 예약 시각을 **분 단위로 내린 값**이 겹치나
 *            뜻하는 것: N곳이 한꺼번에 나가 «묶여 보이는» 일이 없나
 *            🔴 갈리는 곳: 1분 차이도 «다른 분»이다. 트리거가 «같은 분»이라 적었으니 **계약은 이것**이고, 얼마나 벌렸는지는 `minGapMin` 으로 **따로 찍어 준다**(판정 아님).
 *   ③ 목록   재는 것: 재사용 대상 목록과 «빠진 채널» 목록에 `youtube_long` 글자가 있나
 *            뜻하는 것: 세로 짧은 영상이 유튜브에 **두 번** 올라가는 길이 없나(트리거 §3)
 *   ④ 말투   재는 것: 빠진 채널 문장에 금칙 낱말이 있나 · 채널 상한 길이가 적혔나 · 한 문장 안에 «고를 길이 + 권하는 끝말»이 같이 있나
 *            뜻하는 것: §3 — ①사실 한 줄 ②어떻게 하면 되는지
 *            🔴 **대용물이다**(AC-178 ③ — 이름 붙이고 틀리는 방향을 적는다):
 *              · «어떻게»를 **글자 모양**(길이 + `면`/`주세요`)으로 본다 ⇒ «30초를 고르셔도 안 올라가요» 같은 문장을 **초록으로 놓친다**(거짓 초록 쪽).
 *              · 길이를 말 없이 권하는 문장(«더 짧게 만들어 주세요»)은 **빨강으로 문다**(거짓 빨강 쪽) — 그건 §3 ①«무엇이·왜» 가 흐린 문장이라 **물어도 되는 쪽**으로 뒀다.
 *
 *   ══ 판정 어휘(AC-9) ══  "pass" 됐다 · "fail" 안 됐다 · "unmeasured" **못 쟀다**(재료 0 — 통과 아님).
 */

/** 🔴 트리거 §3 — 세로 짧은 영상의 재사용 대상에 **없어야** 하는 채널. 목록에도 «빠진 채널»에도 안 뜬다(«화면에도 안 띄운다»). */
export const FORBIDDEN_REUSE = Object.freeze(["youtube_long"]);

/** ④ 🔴 금칙 낱말 — 트리거 §1② «실패·오류·불가 금지» + 같은 뜻의 영어(채널 원문이 새면 영어로 온다). */
export const HARD_WORDS = Object.freeze(["실패", "오류", "불가", "에러", "error", "fail", "invalid", "not allowed"]);

/**
 * ④ 겁주는 말 — CLAUDE §3(사장님 2026-09-15). `scripts/verify-server-words.mjs SCARY` 와 **같은 줄기**다.
 *   🔴 그 자는 내보내지 않아서(`export` 0) 여기 옮겨 적었다 — 두 벌이다. 그쪽을 고치면 여기도 본다(이 줄이 그 약속이다).
 */
export const SCARY = Object.freeze([
  [/정지(됩니다|될 수|돼요|될지)/, "위협"],
  [/차단(됩니다|될 수|돼요)/, "위협"],
  [/삭제(됩니다|될 수)/, "위협"],
  [/불이익/, "위협"],
  [/알려만/, "책임 전가"],
  [/책임(입니다|이에요|집니다|지지 않)/, "책임 전가"],
  [/될 수 있(습니다|어요)[.!]?\s*$/, "겁주는 조건절로 끝남"],
]);

/** ④ 고객 문장에 새면 안 되는 기계 낱말 — 채널 키(`naver_clip`)·시스템 낱말(§3 금지). */
const MACHINE = [/[a-z]+_[a-z_]+/, /\bpiece\b/i, /슬롯/, /러너/, /테넌트/];

/* ───────── 길이 읽기 ───────── */

/** 초 → 사람이 적을 만한 모양들(«30초» · «3분» · «1분 30초» · «90초»). */
export function secondsForms(sec) {
  const s = Math.floor(Number(sec) || 0);
  const out = [`${s}초`];
  if (s >= 60) { const m = Math.floor(s / 60), r = s % 60; out.push(r ? `${m}분 ${r}초` : `${m}분`); }
  return out;
}

/** 문장 안의 길이들을 초로 읽는다(«3분» · «1분 30초» · «30초»). */
export function lengthsIn(text) {
  const t = String(text ?? "");
  const out = [];
  const re = /(\d+)\s*분(?:\s*(\d+)\s*초)?|(\d+)\s*초/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1] ? Number(m[1]) * 60 + Number(m[2] || 0) : Number(m[3]));
  return out;
}

/** 문장 나누기 — 마침표·가운뎃점·물음표·줄바꿈. */
const sentences = (t) => String(t ?? "").split(/[.!?·\n]+/).map((s) => s.trim()).filter(Boolean);

/* ───────── ④ 말투 ───────── */

/** 문장 한 벌 — B 의 `reuseFit().skip[]` 은 «사실»(`line`)과 «어떻게»(`how`)를 두 칸으로 준다. 화면엔 둘이 이어서 뜬다. */
export function skipText(it) {
  if (it && (it.line != null || it.how != null)) return [it.line, it.how].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
  return String(it?.text ?? "").trim();
}

/**
 * judgeWords(items) — 빠진 채널 문장 하나하나.
 *   items: [{ channel, seconds(영상 길이), max(그 채널 상한 · 모르면 null), why?, text | line+how }]
 *   `why` — `"too_long"`(기본) 이면 사실·어떻게를 **길이로** 잰다. 🔴 그 밖(`"no_account"` 등)은 길이 사유가 아니라
 *   길이로 재면 **거짓 빨강**이다 ⇒ 금칙·겁·기계 낱말 + «어떻게» 칸이 비지 않았나만 본다.
 */
export function judgeWords(items) {
  const list = Array.isArray(items) ? items : [];
  const findings = [];
  const bad = (it, code, why) => findings.push({ axis: "④", code, channel: it.channel, seconds: it.seconds, why: why, reason: it.why ?? "too_long", text: skipText(it) });
  for (const it of list) {
    const text = skipText(it);
    if (!text) { bad(it, "empty", "빠졌는데 왜 빠졌는지 한 줄도 없다 — 조용한 제외(§9 ① «또렷하게»)"); continue; }
    const low = text.toLowerCase();
    for (const w of HARD_WORDS) if (low.includes(w)) bad(it, "hard_word", `금칙 낱말 «${w}»`);
    for (const [re, kind] of SCARY) if (re.test(text)) bad(it, "scary", `${kind} — ${String(re)}`);
    for (const re of MACHINE) { const m = text.match(re); if (m) bad(it, "machine_word", `기계 낱말 «${m[0]}»`); }
    if (it.line != null && !String(it.line).trim()) bad(it, "empty", "«사실» 칸(`line`)이 비었다");
    if (it.how != null && !String(it.how).trim()) bad(it, "no_way", "«어떻게» 칸(`how`)이 비었다");
    if ((it.why ?? "too_long") !== "too_long") continue;
    const max = Number(it.max);
    if (!(max > 0)) { bad(it, "no_max", "이 채널의 상한을 몰라 «사실 한 줄»을 잴 수 없다 — 상한 표에 채널이 없다(트리거 §2)"); continue; }
    /* 🔴 두 칸으로 오면 **칸마다** 잰다 — 사실은 `line` 에서, 어떻게는 `how` 에서. 합쳐 보면 `how` 의 «30초를 골라 주세요»가
       `line` 에서 빠진 «최대 30초»를 **대신 채워 준다**(클립 상한 30 = 권하는 길이 30 이라 늘 겹친다 · 2026-09-26 B 코드를 읽다 잡음). */
    const factText = it.line != null ? String(it.line) : text;
    const wayText = it.how != null ? String(it.how) : text;
    if (!secondsForms(max).some((f) => factText.includes(f))) bad(it, "no_fact", `채널 상한(${secondsForms(max).join(" 또는 ")})이 ${it.line != null ? "«사실» 칸(`line`)에" : "문장에"} 없다 — «무엇이·왜»가 흐리다`);
    const way = sentences(wayText).some((s) => lengthsIn(s).some((n) => n > 0 && n <= max) && /(면|주세요|보세요|하세요|세요)/.test(s));
    if (!way) bad(it, "no_way", `«어떻게 하면 되는지»가 없다 — 한 문장 안에 «${max}초 이하의 길이 + 권하는 끝말»이 같이 없다`);
  }
  return { axis: "④", verdict: list.length === 0 ? "unmeasured" : findings.length ? "fail" : "pass", measured: list.length, findings };
}

/* ───────── ③ 목록 ───────── */

/**
 * judgeReuse(rows, { maxOf }) — 재사용 대상 목록이 결정 ②대로인가 + `youtube_long` 이 어디에도 없나.
 *   rows: [{ source, seconds, targets: [channel|{channel}], skipped: [{ channel, text }] }]
 *   maxOf(channel) → 상한 초 | null
 */
export function judgeReuse(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const maxOf = typeof opts.maxOf === "function" ? opts.maxOf : () => null;
  const forbidden = new Set(opts.forbidden ?? FORBIDDEN_REUSE);
  const findings = [];
  const ch = (x) => String(typeof x === "string" ? x : x?.channel ?? "");
  const bad = (r, code, channel, why) => findings.push({ axis: "③", code, source: r.source, seconds: r.seconds, channel, why });
  for (const r of list) {
    const secs = Number(r.seconds);
    /* ③-b 🔴 원본 채널이 다시 뜨면 **같은 채널에 같은 영상이 두 번** — youtube_long 과 같은 병(트리거 §3)의 다른 얼굴. */
    for (const t of [...(r.targets ?? []), ...(r.skipped ?? [])].map(ch)) if (r.source && t === r.source) bad(r, "source_again", t, "원본 채널이 대상/«빠진 채널»에 다시 떴다 — 같은 채널에 같은 영상이 두 번");
    for (const t of (r.targets ?? []).map(ch)) {
      if (forbidden.has(t)) bad(r, "forbidden_target", t, "🔴 세로 짧은 영상을 유튜브 긴 영상으로 보낸다 — 쇼츠가 하나 더 생기고 쿼터를 두 배로 먹는다(트리거 §3)");
      const max = Number(maxOf(t));
      if (!(max > 0)) bad(r, "no_spec", t, "상한을 모르는 채널이 대상에 들었다 — 판정 없이 들어갔다(트리거 §2 «판정 자체가 안 된다»)");
      else if (secs > max) bad(r, "too_long_target", t, `${secs}초 영상이 상한 ${max}초 채널로 간다`);
    }
    for (const s of r.skipped ?? []) {
      const t = ch(s);
      if (forbidden.has(t)) bad(r, "forbidden_shown", t, "🔴 «빠진 채널»에 띄웠다 — 트리거 §3 «화면에도 안 띄운다»(없는 길이지 못 맞춘 길이가 아니다)");
      const max = Number(maxOf(t));
      /* 🔴 길이 사유(`too_long` · 없으면 그걸로 본다)일 때만 잰다 — `no_account` 는 «없는 길»(사실)이라 길이가 맞아도 빠지는 게 맞다. */
      if ((s?.why ?? "too_long") === "too_long" && max > 0 && secs <= max) bad(r, "fit_but_skipped", t, `${secs}초 영상이 상한 ${max}초 채널에서 «길이 때문에» 빠졌다 — 결정 ② «길이가 안 맞는 채널만 뺀다»`);
    }
  }
  return { axis: "③", verdict: list.length === 0 ? "unmeasured" : findings.length ? "fail" : "pass", measured: list.length, findings };
}

/* ───────── ① 코인 ───────── */

/**
 * judgeCoin({ derivedIds, ledger, consumeBefore, consumeAfter })
 *   derivedIds: 파생 piece id 들 · ledger: [{ kind, ref, delta }](그 테넌트 원장)
 *   consumeBefore/After: 파생 **전후** 그 테넌트의 `consume` 행 수(리허설 팔만 안다 · 없으면 그 문장은 안 잰다)
 */
export function judgeCoin(input = {}) {
  const ids = (input.derivedIds ?? []).map((x) => Math.floor(Number(x))).filter((x) => x > 0);
  const ledger = Array.isArray(input.ledger) ? input.ledger : [];
  const findings = [];
  if (!ids.length) return { axis: "①", verdict: "unmeasured", measured: 0, findings, note: "파생 piece 0개 — 잴 표본이 없다" };
  for (const d of ids) {
    const mine = ledger.filter((r) => String(r.kind) === "consume" && (String(r.ref) === `piece:${d}` || String(r.ref ?? "").startsWith(`piece:${d}:`)));
    if (mine.length) findings.push({ axis: "①", code: "derived_charged", pieceId: d, rows: mine.length, coins: mine.reduce((a, r) => a - Number(r.delta || 0), 0), why: `파생 piece ${d} 가 원장에 ${mine.length}행 — 코인은 한 번(§4.7 «승계 무료»)` });
  }
  const b = input.consumeBefore, a = input.consumeAfter;
  let both = false;
  if (Number.isFinite(b) && Number.isFinite(a)) {
    both = true;
    if (a !== b) findings.push({ axis: "①", code: "tenant_charged_on_derive", delta: a - b, why: `파생을 만드는 사이 이 집의 차감 행이 ${b} → ${a} — 파생 id 밖(원본 ref 꼬리 등)에서 받았다` });
  }
  return { axis: "①", verdict: findings.length ? "fail" : "pass", measured: ids.length, findings, note: both ? "파생 id 행 + 전후 차이 둘 다 쟀다" : "🔴 파생 id 행만 쟀다 — 전후 차이는 리허설 팔만 안다(원본 ref 꼬리로 받는 병은 여기선 안 보인다)" };
}

/* ───────── ② 같은 분 ───────── */

/**
 * judgeMinutes(families) — 한 영상 가족(원본 + 파생)이 **같은 분**에 둘 이상 잡혔나.
 *   families: [{ originId, members: [{ pieceId, channel, at(ISO|Date|null) }] }]
 */
export function judgeMinutes(families) {
  const list = Array.isArray(families) ? families : [];
  const findings = [];
  let timedFamilies = 0, untimed = 0, minGap = Infinity;
  for (const f of list) {
    const timed = [];
    for (const m of f.members ?? []) {
      const t = m.at == null ? NaN : new Date(m.at).getTime();
      if (Number.isFinite(t)) timed.push({ ...m, t, minute: Math.floor(t / 60000) }); else untimed++;
    }
    if (timed.length < 2) continue;
    timedFamilies++;
    const byMin = new Map();
    for (const m of timed) byMin.set(m.minute, [...(byMin.get(m.minute) ?? []), m]);
    for (const [minute, ms] of byMin) {
      if (ms.length > 1) findings.push({ axis: "②", code: "same_minute", originId: f.originId, at: new Date(minute * 60000).toISOString(), channels: ms.map((m) => m.channel), why: `한 영상이 같은 분에 ${ms.length}곳(${ms.map((m) => m.channel).join("·")}) — 편성표에 시차를 두고 얹는다(트리거 §5)` });
    }
    const ts = timed.map((m) => m.t).sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) minGap = Math.min(minGap, (ts[i] - ts[i - 1]) / 60000);
  }
  const verdict = timedFamilies === 0 ? "unmeasured" : findings.length ? "fail" : "pass";
  return { axis: "②", verdict, measured: timedFamilies, untimed, minGapMin: Number.isFinite(minGap) ? Math.round(minGap * 10) / 10 : null, findings };
}

/* ═══════════ 자기시험 — 양팔(대조군 초록 · 변이 빨강 + «그 코드»로) ═══════════ */

/** 트리거 §1② 의 예문 + 그럴듯한 좋은 말투들 — **전부 초록이어야 한다**(거짓 빨강 쪽 대조군). */
export const GOOD_WORDS = Object.freeze([
  { channel: "naver_clip", seconds: 60, max: 30, text: "이 영상은 60초라 클립(최대 30초)엔 안 올라가요. 클립에도 올리시려면 만들 때 30초를 골라 주세요." },
  { channel: "naver_clip", seconds: 60, max: 30, text: "네이버 클립은 30초까지만 올라가요. 30초로 만들면 클립에도 같이 올라가요." },
  { channel: "naver_clip", seconds: 90, max: 30, text: "90초 영상은 클립(30초까지)에 안 들어가요. 클립에도 올리려면 30초로 만들어 주세요." },
  { channel: "youtube_shorts", seconds: 90, max: 60, text: "이 영상은 90초라 쇼츠(최대 60초)엔 안 올라가요. 쇼츠에도 올리시려면 60초 이하로 골라 주세요." },
  { channel: "tiktok", seconds: 240, max: 180, text: "틱톡은 3분까지 올라가요 · 3분 이하로 만들면 틱톡에도 올라가요" },
  { channel: "naver_clip", seconds: 60, max: 30, text: "클립은 30초까지예요. 다음부터 30초를 고르시면 네 곳 모두 올라가요." },
  /* B 계약 v1(2026-09-26)의 **그 문장 그대로** — 두 칸(`line`·`how`)으로 온다 */
  { channel: "naver_clip", seconds: 60, max: 30, why: "too_long", line: "이 영상은 60초라 네이버 클립(최대 30초)엔 안 올라가요.", how: "네이버 클립에도 올리시려면 만들 때 30초를 골라 주세요." },
  { channel: "tiktok", seconds: 60, max: 180, why: "no_account", line: "틱톡 계정이 아직 연결되지 않았어요.", how: "계정을 연결하시면 같이 올라가요." },
]);

/** 나쁜 말투 — 각자 **그 코드**가 나와야 운 것이다(AC-121). */
export const BAD_WORDS = Object.freeze([
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "네이버 클립 업로드 불가 (60초 초과)" }, "hard_word"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "클립은 30초까지라 업로드에 실패했어요. 30초로 만들어 주세요." }, "hard_word"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "길이 오류: 클립은 30초까지예요. 30초로 만들어 주세요." }, "hard_word"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "이 영상은 클립에 안 올라가요." }, "no_fact"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "이 영상은 60초라 클립(최대 30초)엔 안 올라가요." }, "no_way"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "이 영상은 60초라 클립(최대 30초)엔 안 올라가요. 올리시려면 문의해 주세요." }, "no_way"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "naver_clip 은 30초까지예요. 30초로 만들어 주세요." }, "machine_word"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "클립은 30초까지예요. 30초로 만들어 주세요. 계속 올리시면 계정이 정지될 수 있어요." }, "scary"],
  [{ channel: "naver_clip", seconds: 60, max: 30, text: "" }, "empty"],
  [{ channel: "tiktok", seconds: 240, max: null, text: "틱톡엔 안 올라가요. 짧게 골라 주세요." }, "no_max"],
  [{ channel: "naver_clip", seconds: 60, max: 30, why: "too_long", line: "이 영상은 60초라 네이버 클립(최대 30초)엔 안 올라가요.", how: "" }, "no_way"],
  /* 🔴 상한이 `how` 에만 있고 `line` 에는 없다 — 합쳐 보면 초록으로 새던 모양(칸마다 재야 운다) */
  [{ channel: "naver_clip", seconds: 60, max: 30, why: "too_long", line: "이 영상은 60초라 네이버 클립엔 안 올라가요.", how: "네이버 클립에도 올리시려면 만들 때 30초를 골라 주세요." }, "no_fact"],
  /* 권하는 길이가 `line` 에만 있고 `how` 는 길이 없이 권한다 — 같은 병의 반대쪽 */
  [{ channel: "naver_clip", seconds: 60, max: 30, why: "too_long", line: "이 영상은 60초라 네이버 클립(최대 30초)엔 안 올라가요.", how: "네이버 클립에도 올리시려면 더 짧게 만들어 주세요." }, "no_way"],
  [{ channel: "tiktok", seconds: 60, max: 180, why: "no_account", line: "틱톡 계정 연결 실패", how: "계정을 연결하시면 같이 올라가요." }, "hard_word"],
  [{ channel: "tiktok", seconds: 60, max: 180, why: "no_account", line: "틱톡 계정이 아직 연결되지 않았어요.", how: "" }, "no_way"],
]);

const MAX = { youtube_shorts: 60, naver_clip: 30, reels: 90, facebook_reels: 90, tiktok: 180 };
const maxOf = (c) => MAX[c] ?? null;
const GOOD_LIST = [
  { source: "youtube_shorts", seconds: 60, targets: ["reels", "tiktok", "facebook_reels"], skipped: [{ channel: "naver_clip", why: "too_long", text: GOOD_WORDS[0].text }] },
  { source: "youtube_shorts", seconds: 30, targets: ["reels", "facebook_reels", "naver_clip"], skipped: [{ channel: "tiktok", why: "no_account", text: "틱톡 계정이 아직 연결되지 않았어요. 계정을 연결하시면 같이 올라가요." }] },
];

/**
 * selfTest() — 오늘(제품 0줄) 이 자가 **살아 있나**를 잰다. 반환: { ok, lines:[{ ok, name, got }] }
 *   🔴 «빨강이면 됐다»가 아니라 **기대한 코드가 나왔나**로 센다 — 엉뚱한 축이 울면 그건 운 게 아니다(AC-121).
 */
export function selfTest() {
  const lines = [];
  const add = (name, ok, got) => lines.push({ name, ok: !!ok, got });
  const codes = (r) => r.findings.map((f) => f.code);

  /* ④ 대조군 — 좋은 말투 여섯이 **전부** 초록(거짓 빨강 0) */
  const g = judgeWords(GOOD_WORDS);
  add(`④ 대조군 — 좋은 말투 ${GOOD_WORDS.length}개가 전부 초록`, g.verdict === "pass", g.findings.map((f) => `${f.code}: ${f.text}`).join(" | ") || "pass");
  /* ④ 변이 — 나쁜 말투 하나하나가 **그 코드**로 운다 */
  for (const [it, want] of BAD_WORDS) {
    const r = judgeWords([it]);
    add(`④ 나쁜 말투가 «${want}» 로 운다 — «${skipText(it) || "(빈 문장)"}»${it.how === "" ? " (how 빈 칸)" : ""}`, r.verdict === "fail" && codes(r).includes(want), codes(r).join(",") || r.verdict);
  }
  /* ④ 재료 0 은 ⊘ 다(통과 아님) */
  add("④ 재료 0 이면 «못 쟀다»(통과 아님)", judgeWords([]).verdict === "unmeasured", judgeWords([]).verdict);

  /* ③ 대조군 · 변이 */
  const l0 = judgeReuse(GOOD_LIST, { maxOf });
  add("③ 대조군 — 60초·30초 목록이 결정 ②대로면 초록(🔴 길이는 맞는데 «계정 없음»으로 빠진 틱톡은 물지 않는다)", l0.verdict === "pass", codes(l0).join(",") || "pass");
  const mut = (fn) => { const c = JSON.parse(JSON.stringify(GOOD_LIST)); fn(c); return judgeReuse(c, { maxOf }); };
  const lcase = [
    ["youtube_long 을 대상에 넣으면", (c) => c[0].targets.push("youtube_long"), "forbidden_target"],
    ["youtube_long 을 «빠진 채널»에 띄우면", (c) => c[0].skipped.push({ channel: "youtube_long", text: "긴 영상은 가로여야 해요." }), "forbidden_shown"],
    ["상한 모르는 채널을 대상에 넣으면", (c) => c[1].targets.push("threads_video_zz"), "no_spec"],
    ["60초 영상을 클립(30)에 보내면", (c) => c[0].targets.push("naver_clip"), "too_long_target"],
    ["30초 영상인데 클립을 «길이 때문에» 빼면", (c) => { c[1].targets = c[1].targets.filter((t) => t !== "naver_clip"); c[1].skipped.push({ channel: "naver_clip", why: "too_long", text: "x" }); }, "fit_but_skipped"],
    ["원본 채널(쇼츠)을 대상에 다시 넣으면", (c) => c[0].targets.push("youtube_shorts"), "source_again"],
  ];
  for (const [name, fn, want] of lcase) { const r = mut(fn); add(`③ ${name} «${want}» 로 운다`, r.verdict === "fail" && codes(r).includes(want), codes(r).join(",") || r.verdict); }
  add("③ 재료 0 이면 «못 쟀다»", judgeReuse([], { maxOf }).verdict === "unmeasured", judgeReuse([], { maxOf }).verdict);

  /* ① 대조군 · 변이 */
  const ledger0 = [{ kind: "consume", ref: "piece:10", delta: -28 }, { kind: "consume", ref: "piece:100", delta: -28 }, { kind: "grant", ref: "refund:piece:11:c28", delta: 28 }];
  const c0 = judgeCoin({ derivedIds: [11, 12], ledger: ledger0, consumeBefore: 2, consumeAfter: 2 });
  add("① 대조군 — 원본만 차감 · 파생 0행 · 전후 같음이면 초록(`piece:100` 을 `piece:10` 가족으로 오인하지 않는다)", c0.verdict === "pass", codes(c0).join(",") || "pass");
  const c1 = judgeCoin({ derivedIds: [11, 12], ledger: [...ledger0, { kind: "consume", ref: "piece:12", delta: -28 }], consumeBefore: 2, consumeAfter: 3 });
  add("① 파생 id 로 차감하면 «derived_charged» 로 운다", c1.verdict === "fail" && codes(c1).includes("derived_charged"), codes(c1).join(","));
  const c1b = judgeCoin({ derivedIds: [11], ledger: [...ledger0, { kind: "consume", ref: "piece:11:regen1", delta: -28 }] });
  add("① 파생의 «다시 만들기» 꼬리(`piece:{파생}:regen1`)도 «derived_charged» 로 운다", c1b.verdict === "fail" && codes(c1b).includes("derived_charged"), codes(c1b).join(","));
  const c2 = judgeCoin({ derivedIds: [11, 12], ledger: [...ledger0, { kind: "consume", ref: "piece:10:reels", delta: -28 }], consumeBefore: 2, consumeAfter: 3 });
  add("① 🔴 원본 ref 에 꼬리를 달아 받으면(파생 id 는 깨끗) «tenant_charged_on_derive» 로 운다", c2.verdict === "fail" && codes(c2).includes("tenant_charged_on_derive") && !codes(c2).includes("derived_charged"), codes(c2).join(","));
  add("① 파생 0개면 «못 쟀다»", judgeCoin({ derivedIds: [], ledger: ledger0 }).verdict === "unmeasured", judgeCoin({ derivedIds: [] }).verdict);

  /* ② 대조군 · 변이 */
  const fam = (times) => [{ originId: 10, members: times.map((at, i) => ({ pieceId: 10 + i, channel: ["youtube_shorts", "reels", "tiktok", "naver_clip"][i], at })) }];
  const m0 = judgeMinutes(fam(["2026-09-26T10:00:00Z", "2026-09-26T10:30:00Z", "2026-09-26T11:00:00Z"]));
  add("② 대조군 — 30분씩 벌어졌으면 초록", m0.verdict === "pass" && m0.minGapMin === 30, `${m0.verdict} · minGap ${m0.minGapMin}`);
  const m1 = judgeMinutes(fam(["2026-09-26T10:00:00Z", "2026-09-26T10:00:00Z", "2026-09-26T11:00:00Z"]));
  add("② 같은 시각이면 «same_minute» 로 운다", m1.verdict === "fail" && codes(m1).includes("same_minute"), codes(m1).join(","));
  const m2 = judgeMinutes(fam(["2026-09-26T10:00:05Z", "2026-09-26T10:00:55Z", "2026-09-26T11:00:00Z"]));
  add("② 초만 다르고 같은 분이어도 «same_minute» 로 운다", m2.verdict === "fail" && codes(m2).includes("same_minute"), codes(m2).join(","));
  const m3 = judgeMinutes(fam(["2026-09-26T10:00:00Z", null, null]));
  add("② 시각이 하나뿐이면 «못 쟀다»(통과 아님)", m3.verdict === "unmeasured" && m3.untimed === 2, `${m3.verdict} · untimed ${m3.untimed}`);

  return { ok: lines.every((l) => l.ok), lines };
}
