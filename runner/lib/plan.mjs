/**
 * runner/lib/plan.mjs — 원고(§4B 블록/bodyHtml) → **에디터 조작 시퀀스**(순수 · IO 0).
 *   AM 원본: ../AutoMarketing/scripts/naver-blog-runner.mjs planEditorOps(2026-09-14 구조 이식 · AC 블록 어휘로 개작).
 *
 *   🔴 이 함수의 출력이 발행물의 정본 설계도다. 채널 모듈은 이 «데이터»를 연주만 한다 —
 *      그래야 네이버·티스토리가 같은 원고에서 같은 모양을 낸다(서식이 채널마다 갈리지 않는다).
 *
 *   블록이 있으면 블록을 쓴다(정본). 사람이 검수창에서 본문을 고쳐 블록과 어긋난 경우를 대비해
 *   **bodyHtml 파서**도 둔다(블록이 비었을 때만 · §4B class 계약을 그대로 되읽는다).
 */

/**
 * 🔴 `**굵게**` 표시자를 **평문에서 걷어낸다.**
 *   러너는 `blocks` 를 원문 그대로 받는다 — 걷지 않으면 스마트에디터에 **별표가 그대로 타자된다**(실측 2026-09-16).
 *   ⚠️ 여기는 «평문으로 내려앉는 자리»다(목록·표·FAQ·캡션·태그). 굵게를 **낼 수 있는** 자리(para·quote)는
 *      `partsFromMarks` → `expandBoldMarkers` 가 **마크로** 살린다 — 두 경로가 같은 글자를 서로 다르게 다룬다.
 *   ⚠️ 짝이 안 맞는 별표(`**` 가 홀수)는 **그냥 둔다** — 글에 진짜로 별표를 쓴 경우를 우리가 지우면 안 된다.
 */
export function stripBoldMarkers(s) {
  return String(s ?? "").replace(/\*\*([^*][\s\S]*?)\*\*/g, "$1");
}

/** op 종류: title · para · heading · quote · divider · list · check · image · faq · tags · link · note */
const clean = (s) => stripBoldMarkers(String(s ?? "").replace(/ /g, " ").replace(/\s+\n/g, "\n").trim());

/** HTML 엔티티 되돌리기(에디터에는 사람이 읽는 글자를 넣는다). */
function unescapeHtml(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h2|h3|blockquote)>/gi, "\n")
    /* 🔴 굵게를 «태그와 함께» 버리지 않는다 — 종전에는 여기서 <strong> 이 통째로 사라져
       폴백 경로의 굵게가 **한 건도** 에디터에 닿지 않았다. ** 로 남겨 아래 expandBoldMarkers 가 마크로 바꾼다. */
    .replace(/<\s*(strong|b)\s*>/gi, "**").replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/* ═════════ [R9-2] 인라인 서식 마크 — 🔴 **뜻을 받고, 보이는 모양은 러너가 정한다** ═════════
 *
 *   서버(B)가 `block.marks[]` 로 «여기는 점 강조 · 여기는 면 강조 · 여기는 밑줄»을 **뜻으로** 적어 보낸다.
 *   그래야 채널이 늘어도 서버가 안 바뀐다(네이버는 형광펜, 티스토리는 다른 것 — 고르는 건 러너다).
 *
 *   🔴 **AM 과 다른 점 하나**: AM 은 본문 문자열에 제어문자(`\u0011`·`\u0013`·`\u0015`)를 섞는다.
 *      우리는 **구조로 받는다** — 소스·DB 에 보이지 않는 글자를 넣지 않는다(AC-77 ③: 유니코드 이스케이프가
 *      진짜 NUL 로 저장돼 git 이 파일을 binary 로 판정했다. binary 는 diff 도 3-way 머지도 안 된다).
 *
 *   뜻 다섯:
 *     value     점 강조 — 숫자·결론 낱말(짧다)          → 러너: 굵게 + 색
 *     line      면 강조 — 문장 하나                      → 러너: 형광펜(배경색)
 *     row       나열 — 요금표 같은 행                     → 러너: 굵게 + 고정색(항목마다 색이 돌면 알록달록해진다)
 *     bold      굵게만(색 0)                              → 러너: 굵게
 *     underline 밑줄                                      → 러너: 도구모음 밑줄을 **선택 범위에** (캐럿 토글 아님)
 *     italic    기울임                                    → 🔴 **안 낸다**(못 내는 게 아니다 · 아래)
 *
 *   🔴 **기울임은 «못 낸다»가 아니라 «안 낸다»** (2026-09-16 B2↔B 합의 · 어휘는 B 가 확정).
 *      기울임은 우리 자가검사가 **번짐 증상으로 세는 축**이다(사장님이 보신 «빨강+가운데+기울임»).
 *      일부러 켜면 `measureFormatBleed` 가 **우리 글을 잡는다** — 계약의 두 부분이 서로 싸우는 자리다
 *      (CLAUDE §9 «계약의 최소치도 게이트다 · 싸우면 매번 재작성이 돌아 돈이 두 배»의 서식판).
 *      ⇒ 어휘로는 **받고**(서버가 보낼 수 있다) 러너는 `channel_unsupported` 로 내려앉히고 **그 사실을 적는다**.
 */
export const MARK_KINDS = new Set(["value", "line", "row", "bold", "underline", "italic"]);
/** 🔴 러너가 «일부러 안 내는» 종류 — 어휘에는 있지만 이 채널에서는 세우지 않는다(조용히 버리지 않고 적는다). */
export const MARK_NOT_EMITTED = new Set(["italic"]);

/** 강조 위생 상한 — 🔴 **계획 단계에서 확정한다**(실행부 임기응변 금지 · AM 정본값).
 *  서버가 더 적게 보내면 그게 이긴다(여기 값은 «이보다 많이는 안 낸다»는 천장이다). */
export const MARK_BUDGET = {
  valueMaxChars: 60,     // 점 강조는 짧아야 «강조»다
  lineMaxChars: 140,     // 면 강조는 문장 하나(한국어 한 문장 ~40~120자)
  underlineMaxChars: 80,
  valueMaxPerPost: 12,   // 넘치면 강조가 아니라 도배다(AM 실물 ⓒ)
  lineMaxPerPost: 6,
  rowMaxPerPost: 10,
  boldMaxPerPost: 20,
  underlineMaxPerPost: 8,
};

/**
 * 원문 + 마크 → 조각들. 🔴 **마크를 «자를» 때는 `clean()` 전 원문 기준**이다 —
 *   `clean()` 이 앞뒤를 trim 하면 인덱스가 통째로 밀린다(조용히 어긋나는 종류라 더 나쁘다).
 *   ⇒ 원문에서 먼저 자르고, **조각마다** 공백을 정리한다. 처음·끝 조각만 바깥쪽을 trim 한다.
 * 어긋난 마크는 **그 마크만 버리고 `demoted` 에 적는다**(AC-9 — 조용히 안 버린다).
 */
export function partsFromMarks(raw, marks, demoted) {
  const s = String(raw ?? "");
  const note = (kind, why, sample) => { if (demoted && demoted.length < 40) demoted.push({ kind, why, sample: String(sample ?? "").slice(0, 24) }); };
  const valid = [];
  for (const m of Array.isArray(marks) ? marks : []) {
    const kind = String(m?.kind ?? "");
    const a = Number(m?.s), b = Number(m?.e);
    if (!MARK_KINDS.has(kind)) { note(kind || "(없음)", "range_invalid", ""); continue; }
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > s.length || a >= b) {
      note(kind, "range_invalid", s.slice(Math.max(0, a || 0), (a || 0) + 20));
      continue;
    }
    valid.push({ s: a, e: b, kind });
  }
  valid.sort((x, y) => x.s - y.s || y.e - x.e);
  /* 겹치면 앞엣것이 이긴다 — 뒤엣것은 버리고 적는다(겹친 마크를 «반쯤» 칠하면 그 자리가 갈린다 · AM #736). */
  const kept = [];
  let end = 0;
  for (const m of valid) {
    if (m.s < end) { note(m.kind, "range_invalid", s.slice(m.s, m.s + 20)); continue; }
    kept.push(m); end = m.e;
  }
  if (!kept.length) return expandBoldMarkers([{ t: cleanPart(s, true, true), mark: null }].filter((p) => p.t));

  const parts = [];
  let last = 0;
  for (const m of kept) {
    if (m.s > last) parts.push({ t: s.slice(last, m.s), mark: null });
    parts.push({ t: s.slice(m.s, m.e), mark: m.kind });
    last = m.e;
  }
  if (last < s.length) parts.push({ t: s.slice(last), mark: null });
  return expandBoldMarkers(parts
    .map((p, i) => ({ ...p, t: cleanPart(p.t, i === 0, i === parts.length - 1) }))
    .filter((p) => p.t));
}

/**
 * 🔴 **`**굵게**` 를 마크로 바꾼다 — 이 줄이 없으면 별표가 글에 그대로 실린다.**
 *
 *   실측(2026-09-16 B2): 러너는 `blocks` 를 **원문 그대로** 받는다(`lib/publish/index.ts:200`).
 *   `lib/blocks.ts inline()` 이 `**x**` → `<strong>` 로 바꾸는 것은 **HTML 채널 경로뿐**이고,
 *   러너 경로는 그 함수를 지나지 않는다 ⇒ 종전에는 스마트에디터에 **«**중요**» 가 별표째** 타자됐다.
 *   ⚠️ 굵게가 «안 먹었다»가 아니라 **한 번도 시도된 적이 없었다** — AC-69 의 그 모양이다(다들 이름은 봤다).
 *
 *   🔴 이미 마크가 걸린 조각 안은 **건드리지 않는다**(서버가 준 뜻이 이긴다). 별표 짝이 안 맞으면 그냥 둔다.
 */
export function expandBoldMarkers(parts) {
  const out = [];
  for (const p of parts) {
    if (p.mark || !p.t.includes("**")) { out.push(p); continue; }
    const re = /\*\*([^*][\s\S]*?)\*\*/g;
    let last = 0, m, any = false;
    while ((m = re.exec(p.t)) !== null) {
      any = true;
      if (m.index > last) out.push({ t: p.t.slice(last, m.index), mark: null });
      out.push({ t: m[1], mark: "bold" });
      last = re.lastIndex;
    }
    if (!any) { out.push(p); continue; }
    if (last < p.t.length) out.push({ t: p.t.slice(last), mark: null });
  }
  return out.filter((p) => p.t);
}

/** 조각 안의 공백 정리 — 바깥쪽 trim 은 **처음·끝 조각만**(가운데를 trim 하면 낱말이 붙어 버린다). */
function cleanPart(s, isFirst, isLast) {
  let t = String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n");
  if (isFirst) t = t.replace(/^\s+/, "");
  if (isLast) t = t.replace(/\s+$/, "");
  return t;
}

/**
 * 상한을 먹인다 — 넘치는 마크는 **평문으로 내려앉히고** `demoted` 에 적는다.
 *   🔴 **글 전체에 걸쳐 한 번에** 센다(문단마다 따로 세면 글당 상한이 뜻이 없다).
 *   🔴 주소가 든 문단은 강조를 **통째로 걷는다** — 스마트에디터는 **서식 없는** 평문 URL 만 앵커로 바꿔 준다
 *      (AM #799 색 · #800·#801 굵게 — 발행 3건이 전부 클릭 불가로 나갔다). 링크가 사는 것이 색보다 먼저다.
 */
/** 지금 op 들에 걸려 있는 마크 수 — 상한을 먹이기 «전»에 세면 planned, «뒤»에 세면 kept 다. */
export function countMarks(ops) {
  const n = { value: 0, line: 0, row: 0, bold: 0, underline: 0, italic: 0 };
  for (const op of ops) for (const p of Array.isArray(op?.parts) ? op.parts : []) if (p.mark && n[p.mark] !== undefined) n[p.mark]++;
  return n;
}

export function applyMarkBudget(opsWithParts, demoted, caps) {
  const used = { value: 0, line: 0, row: 0, bold: 0, underline: 0, italic: 0 };
  const note = (kind, why, sample) => { if (demoted && demoted.length < 40) demoted.push({ kind, why, sample: String(sample ?? "").slice(0, 24) }); };
  let prevParaHadLine = false;
  for (const op of opsWithParts) {
    const parts = op.parts;
    if (!Array.isArray(parts) || !parts.some((p) => p.mark)) { prevParaHadLine = false; continue; }
    const joined = parts.map((p) => p.t).join("");
    if (joined.includes("http://") || joined.includes("https://")) {
      for (const p of parts) if (p.mark) { note(p.mark, "url_para", p.t); p.mark = null; }
      op.parts = [{ t: joined, mark: null }];
      prevParaHadLine = false;
      continue;
    }
    let hasLineHere = false;
    for (const p of parts) {
      if (!p.mark) continue;
      const demote = (why) => { note(p.mark, why, p.t); p.mark = null; };
      /* 🔴 «일부러 안 내는 것»과 «채널이 못 내는 것»을 **같은 why 로** 적는다 — 둘 다 고객에겐 «이 채널에선 안 나와요»다.
         다른 점은 우리 쪽 할 일이고, 그건 코드 주석(MARK_NOT_EMITTED)이 말한다. */
      if (MARK_NOT_EMITTED.has(p.mark)) { demote("channel_unsupported"); continue; }
      /* 🔴 채널 표가 **명시적으로 false** 일 때만 안 낸다. `null`(모른다)이면 **해 본다** —
         «아직 모른다»로 막지 않는다(CLAUDE §9) 그리고 «모른다»를 «못 한다»로 바꾸지 않는다(AC-92).
         해 보고 안 되면 실행부가 `channel_unsupported` 로 적는다(그게 다음 판의 표를 채우는 재료다). */
      if (caps && caps[p.mark] === false) { demote("channel_unsupported"); continue; }
      if (p.mark === "value") {
        if (p.t.length > MARK_BUDGET.valueMaxChars) { demote("too_long"); continue; }
        if (used.value >= MARK_BUDGET.valueMaxPerPost) { demote("budget"); continue; }
        used.value++;
      } else if (p.mark === "line") {
        if (p.t.length > MARK_BUDGET.lineMaxChars) { demote("too_long"); continue; }
        /* 연속 문단 줄강조 금지 — 색 없는 문장이 도배보다 낫다(AM ⓒ 실물). */
        if (used.line >= MARK_BUDGET.lineMaxPerPost || prevParaHadLine) { demote("budget"); continue; }
        used.line++; hasLineHere = true;
      } else if (p.mark === "row") {
        if (used.row >= MARK_BUDGET.rowMaxPerPost) { demote("budget"); continue; }
        used.row++;
      } else if (p.mark === "bold") {
        if (used.bold >= MARK_BUDGET.boldMaxPerPost) { demote("budget"); continue; }
        used.bold++;
      } else if (p.mark === "underline") {
        if (p.t.length > MARK_BUDGET.underlineMaxChars) { demote("too_long"); continue; }
        if (used.underline >= MARK_BUDGET.underlineMaxPerPost) { demote("budget"); continue; }
        used.underline++;
      }
    }
    prevParaHadLine = hasLineHere;
    /* 다 내려앉았으면 조각을 도로 하나로 — 실행부가 «마크 있는 문단» 경로로 새지 않게. */
    if (!parts.some((p) => p.mark)) op.parts = [{ t: parts.map((p) => p.t).join(""), mark: null }];
  }
  return used;
}

/* ─────────────── 블록 → ops(정본 경로) ─────────────── */

function opsFromBlocks(blocks, images, demoted) {
  /* 마크가 붙을 수 있는 블록은 «글이 흐르는» 둘뿐이다(para 계열·quote).
     소제목은 이미 «굵게 + 크기»를 선택 범위로 먹이는 중이라(sizeLastTyped) 그 위에 또 선택을 겹치면 자리가 갈린다 —
     🔴 이번 라운드는 **소제목에 마크를 안 낸다**. 조용히 버리지 않고 block_unsupported 로 적는다(AC-9). */
  const marksOf = (b) => partsFromMarks(b?.text, b?.marks, demoted);
  /* 🔴 **두 가지 «못 냈어요»를 섞지 않는다**(2026-09-16 B 와 어휘 확정):
       · `block_unsupported` — 마크는 왔는데 **그 블록이 조각을 실을 수 없다**(목록·표·FAQ 는 op 가 줄 하나씩이다)
       · `no_editor_op`      — **블록 자체**를 에디터 요소로 못 세운다(표 → 줄글 · 장소 → 링크 한 줄)
     한 칸으로 뭉치면 「우리가 할 일」이 달라지는데 그게 안 보인다 — 앞은 «조각을 실을 칸을 만들자», 뒤는 «에디터 요소를 배우자». */
  const note = (kind, sample, why = "block_unsupported") => { if (demoted && demoted.length < 40) demoted.push({ kind, why, sample: String(sample ?? "").slice(0, 20) }); };
  const noteNoOp = (blockType, sample) => note(blockType, sample, "no_editor_op");
  const dropMarks = (b) => { for (const m of Array.isArray(b?.marks) ? b.marks : []) note(String(m?.kind ?? ""), b?.text); };
  /* 🔴 목록·표·FAQ 는 op 가 줄 하나씩이라 **조각(parts)을 실을 칸이 없다** — 거기 있던 굵게는 진짜로 사라진다.
     사라지는 것을 «없던 일»로 두지 않는다(AC-9). 소제목은 이미 굵게+크기라 잃는 게 없으니 안 센다. */
  const noteLostBold = (raw) => { if (String(raw ?? "").includes("**") && stripBoldMarkers(raw) !== String(raw)) note("bold", raw); };
  const ops = [];
  const imgs = Array.isArray(images) ? images : [];
  let imgCursor = 0;
  for (const b of blocks) {
    const type = String(b?.type ?? "");
    const text = clean(b?.text);
    switch (type) {
      case "disclosure":
        // 🔴 고지는 «본문과 구분되는 블록»이어야 한다(§16B.1) — 인용구로 세운다. 첫 자리는 호출자가 보장한다.
        // 🔴 고지 문장에는 마크를 안 먹인다 — 법이 읽는 문장을 우리가 꾸미지 않는다(§16B).
        if (text) { dropMarks(b); ops.push({ op: "quote", text, role: "disclosure" }); }
        break;
      case "hook":
      case "para":
      case "summary":
      case "tip":
        if (text) ops.push({ op: "para", text, parts: marksOf(b) });
        break;
      case "h2": if (text) { dropMarks(b); ops.push({ op: "heading", text, level: 2 }); } break;
      case "h3": if (text) { dropMarks(b); ops.push({ op: "heading", text, level: 3 }); } break;
      case "quote": if (text) ops.push({ op: "quote", text, parts: marksOf(b) }); break;
      case "divider": ops.push({ op: "divider" }); break;
      case "toc":
      case "list":
        dropMarks(b);
        for (const it of (b?.items ?? [])) { noteLostBold(it); const t = clean(it); if (t) ops.push({ op: "list", text: t }); }
        break;
      case "checklist":
        dropMarks(b);
        for (const it of (b?.items ?? [])) { noteLostBold(it); const t = clean(it); if (t) ops.push({ op: "check", text: t }); }
        break;
      case "table":
        /* 스마트에디터 ONE 에 표를 «데이터로» 넣을 안정적 길이 없다 — 줄로 정직하게 내려앉힌다.
           조용히 빠뜨리지 않고 note 를 남겨 보고에 실린다(축소를 숨기지 않는다). */
        dropMarks(b);
        for (const row of (b?.rows ?? [])) {
          for (const c of row ?? []) noteLostBold(c);
          const line = (row ?? []).map((c) => clean(c)).filter(Boolean).join(" · ");
          if (line) ops.push({ op: "para", text: line });
        }
        if ((b?.rows ?? []).length) { noteNoOp("table", (b.rows[0] ?? []).join(" · ")); ops.push({ op: "note", text: "표는 줄글로 넣었습니다(에디터 표 미지원)" }); }
        break;
      case "faq":
        dropMarks(b);
        for (const it of (b?.items ?? [])) {
          noteLostBold(it);
          const t = clean(it);
          if (!t) continue;
          ops.push({ op: "faq", text: t });
        }
        break;
      case "image": {
        const idx = Number.isFinite(Number(b?.imageIndex)) ? Number(b.imageIndex) : imgCursor;
        const img = imgs[idx] ?? imgs[imgCursor];
        if (img?.url) { ops.push({ op: "image", url: img.url, caption: clean(b?.caption ?? img.caption) }); imgCursor = idx + 1; }
        break;
      }
      case "affiliate": {
        const af = b?.affiliate ?? {};
        const name = clean(af.productName) || "상품 보러가기";
        const url = String(af.url ?? "").trim();
        if (url) ops.push({ op: "link", text: name, url });
        break;
      }
      /* [R8CLOSE-B1 §B4] 장소/링크 카드 — 🔴 **에디터의 «장소» 카드는 아직 못 넣는다.**
         스마트에디터에서 장소를 검색해 꽂는 것은 B7 «에디터 실제 요소»(R10)와 같은 일이라 여기 없다.
         🔴 «있는 척»을 하지 않는다: 우리가 할 수 있는 길(링크 한 줄)로 **내려앉히고**, 못 한 것을 `note` 로 남긴다
         (`note` 는 본문에 안 들어가고 보고에만 실린다 — 위 `case "note"` 참조). */
      case "place": {
        const pl = b?.place ?? {};
        const name = clean(pl.name);
        if (!name) break;
        const url = String(pl.url ?? "").trim();
        const line = [name, clean(pl.address), clean(pl.note)].filter(Boolean).join(" · ");
        if (url) ops.push({ op: "link", text: line, url });
        else ops.push({ op: "para", text: line });
        noteNoOp("place", name);
        ops.push({ op: "note", text: "장소 카드는 아직 못 넣어서 링크로 넣었습니다" });
        break;
      }
      case "adsense":
        /* 애드센스 코드는 스크립트라 네이버·티스토리 에디터 본문에 그대로 넣을 수 없다.
           서버 게이트가 채널별로 이미 정리했다(네이버는 제거) — 러너는 아무것도 하지 않는다.
           🔴 그래도 **«안 냈다»고는 적는다** — 조용한 0건 금지(PITFALLS #7). 화면은 «이 채널엔 광고를 못 넣어요»를 말할 수 있어야 한다. */
        noteNoOp("adsense", "");
        break;
      case "hashtags":
        if (text) ops.push({ op: "tags", text });
        break;
      default:
        if (text) ops.push({ op: "para", text });
    }
  }
  return ops;
}

/* ─────────────── bodyHtml → ops(폴백 경로 · §4B class 계약 되읽기) ─────────────── */

function opsFromHtml(html) {
  const ops = [];
  const src = String(html ?? "");
  // 최상위 요소를 순서대로 훑는다(중첩은 얕다 — §4B 계약이 단순한 모양을 보장한다).
  const re = /<(div|p|h2|h3|blockquote|hr|ul|ol|figure|dl|nav|a|table)\b([^>]*)>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1]) { ops.push({ op: "divider" }); continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    const cls = (/class="([^"]*)"/i.exec(attrs)?.[1] ?? "").split(/\s+/);
    const text = clean(unescapeHtml(inner));
    if (tag === "div" && cls.includes("disclosure")) { if (text) ops.push({ op: "quote", text, role: "disclosure" }); continue; }
    if (tag === "div" && cls.includes("adsense")) continue;
    if (tag === "h2") { if (text) ops.push({ op: "heading", text, level: 2 }); continue; }
    if (tag === "h3") { if (text) ops.push({ op: "heading", text, level: 3 }); continue; }
    if (tag === "blockquote") { if (text) ops.push({ op: "quote", text }); continue; }
    if (tag === "ul" || tag === "ol" || tag === "nav") {
      const isCheck = cls.includes("check");
      for (const li of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const t = clean(unescapeHtml(li[1]));
        if (t) ops.push({ op: isCheck ? "check" : "list", text: t });
      }
      continue;
    }
    if (tag === "figure") {
      const url = /<img[^>]*src="([^"]+)"/i.exec(inner)?.[1] ?? "";
      const cap = clean(unescapeHtml(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner)?.[1] ?? ""));
      if (url) ops.push({ op: "image", url, caption: cap });
      continue;
    }
    if (tag === "dl") {
      for (const d of inner.matchAll(/<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        const t = clean(unescapeHtml(d[2]));
        if (t) ops.push({ op: "faq", text: (d[1].toLowerCase() === "dt" ? "Q. " : "A. ") + t });
      }
      continue;
    }
    if (tag === "a" && cls.includes("affiliate")) {
      const url = /href="([^"]+)"/i.exec(attrs)?.[1] ?? "";
      const name = clean(unescapeHtml(/<b[^>]*class="name"[^>]*>([\s\S]*?)<\/b>/i.exec(inner)?.[1] ?? "")) || "상품 보러가기";
      if (url) ops.push({ op: "link", text: name, url });
      continue;
    }
    if (tag === "table") {
      for (const tr of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...tr[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => clean(unescapeHtml(c[2]))).filter(Boolean);
        if (cells.length) ops.push({ op: "para", text: cells.join(" · ") });
      }
      ops.push({ op: "note", text: "표는 줄글로 넣었습니다(에디터 표 미지원)" });
      continue;
    }
    if (tag === "p") {
      if (cls.includes("tags")) { if (text) ops.push({ op: "tags", text }); continue; }
      if (text) ops.push({ op: "para", text });
      continue;
    }
    if (tag === "div" && text) ops.push({ op: "para", text });
  }
  return ops;
}

/**
 * planEditorOps — payload → { ops, tags, stats }.
 *   · 고지(role:"disclosure")는 **무조건 맨 앞**으로 끌어올린다(§16B.1 본문 첫머리 · 순서가 바뀌면 위반이다).
 *   · 해시태그 줄은 **무조건 맨 뒤**로(글 중간에 태그가 박히면 모양이 망가진다).
 */
export function planEditorOps(payload) {
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const images = Array.isArray(payload?.images) ? payload.images : [];
  /* 🔴 «못 낸 서식»을 담는 그릇 — 조용히 버리지 않는다(AC-9 · AM 은 이 자리를 `marksDemoted` 라 부른다).
     발행 보고에 실려 서버 meta 로 간다(R9-5 는 B 몫 · 우리는 재료를 정확히 준다). */
  const demoted = [];
  let ops = blocks.length ? opsFromBlocks(blocks, images, demoted) : opsFromHtml(payload?.bodyHtml);
  if (!ops.length && payload?.bodyHtml) ops = opsFromHtml(payload.bodyHtml);

  const disclosure = ops.filter((o) => o.role === "disclosure");
  const tagOps = ops.filter((o) => o.op === "tags");
  const body = ops.filter((o) => o.role !== "disclosure" && o.op !== "tags");

  // 태그: payload.tags(정본) 우선 · 본문 해시태그 줄은 보조.
  const tags = (Array.isArray(payload?.tags) ? payload.tags : [])
    .map((t) => String(t).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
  if (!tags.length && tagOps.length) {
    for (const t of String(tagOps[0].text).split(/\s+/)) {
      const v = t.replace(/^#+/, "").trim();
      if (v && tags.length < 10) tags.push(v);
    }
  }

  const finalOps = [...disclosure, ...body, ...tagOps];

  /* 🔴 상한은 **여기서 한 번**에 먹인다 — 문단마다 따로 세면 «글당 상한»이 뜻이 없다.
     순서가 중요하다: 고지·태그를 제자리에 놓은 **뒤**에 세야 «연속 문단 줄강조 금지»가 실제 순서로 판정된다. */
  /* [R9-4] 🔴 채널 표는 **서버가 믿는 표**다(`lib/channel-registry.ts formatCaps` · B). 러너 payload 에 실려 온다.
     없으면 «모른다»고 보고 해 본다 — 표가 없다고 안 내면 그게 «아직 모른다로 막기»다(CLAUDE §9). */
  const caps = (payload?.formatCaps && typeof payload.formatCaps === "object") ? payload.formatCaps : null;
  const marksPlanned = countMarks(finalOps);
  const marksKept = applyMarkBudget(finalOps, demoted, caps);

  const stats = {
    total: finalOps.length,
    headings: finalOps.filter((o) => o.op === "heading").length,
    images: finalOps.filter((o) => o.op === "image").length,
    quotes: finalOps.filter((o) => o.op === "quote").length,
    dividers: finalOps.filter((o) => o.op === "divider").length,
    lists: finalOps.filter((o) => o.op === "list" || o.op === "check").length,
    notes: finalOps.filter((o) => o.op === "note").map((o) => o.text),
    fromBlocks: blocks.length > 0,
    /* [R9-2/5] 서식 — 계획이 **내려고 한 것**과 **상한에 걸린 것**. 실제로 «눌렀나»는 실행부가 채운다(applied). */
    marks: { planned: marksPlanned, kept: marksKept },
    demoted,
  };
  return { ops: finalOps, tags, stats };
}

/** 고지가 실제로 첫 op 인가 — 러너도 마지막으로 한 번 본다(서버 게이트의 이중 확인 · §16B.4). */
export function disclosureIsFirst(plan, payload) {
  const need = !!payload?.disclosure;
  if (!need) return true;
  const first = plan.ops[0];
  return !!first && first.role === "disclosure";
}
