/**
 * scripts/verify-r8a-text-probe.mts — **R8-A §1 글 · §2 정책 프로브**(C · 순수 함수 · AI 실호출 0 · DB 는 읽기 전용).
 *   `npx tsx --env-file=.env scripts/verify-r8a-text-probe.mts [--sections 1,2]`
 *
 *   🔴 이 라운드의 검사 기본형(트리거 §0): **«한 줄 바꾸고 → 산출물이 바뀌는지 바꾸기 전/후 음성 대조»**.
 *      «프롬프트에 들어갔다» 는 증거가 아니다 — 그래서 여기서 재는 것은 전부 **함수가 내놓는 산출물**이다
 *      (골격 배열 · 지문 · 게이트 판정). 실제 글 3편 대조(§1.1)는 돈이 드는 자리라 따로 판다.
 *
 *   🔴 내 catch 가 내 눈을 가리지 않게(AC-58): 여기엔 삼키는 catch 가 없다. 예외는 그 절을 **빨강으로** 만든다.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import {
  WRITING_CONTRACTS, structureFor, applyTiers, lengthFor, imagesFor, topicGroupOf, resolveGoalDetail,
  type WritingContract, type FormatKey,
} from "../lib/writing-contracts";
import { structurePrint, structureHash, structureOverlap, compareToRecent, STRUCTURE_OVERLAP_MAX } from "../lib/structure-print";
import { maxSimilarity } from "../lib/similarity";
import { classifyBanned, findAdPointing, hasEvidenceNear } from "../lib/banned-words";
import { isHealthTopic } from "../lib/banned-categories";
import { disclosureTextFor, checkDisclosure, compensationOfMeta } from "../lib/disclosure";
import type { Block, BlockType } from "../lib/blocks";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const argOf = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ""; };
const SECTIONS = new Set((argOf("--sections") || "1,2").split(",").map((s) => s.trim()).filter(Boolean));
const blocksOf = (types: BlockType[]): Block[] => types.map((t) => ({ type: t, text: "x" } as Block));

/* ═══════════════════ §1 글 — 계약이 실제 생성에 닿는가 ═══════════════════ */

/** 1.2 `briefs.goal` 사슬 — 적재(director)부터 프롬프트(content-gen)까지 한 마디도 안 끊기나. */
async function s12() {
  /* 사슬 네 마디를 **파일에서** 확인한다(AC-56 «적재하는 곳과 읽는 곳이 다르면 조용히 끊긴다»). */
  const fs = await import("node:fs/promises");
  const gen = await fs.readFile("lib/content-gen.ts", "utf8");
  const dir = await fs.readFile("lib/director.ts", "utf8");
  const auto = await fs.readFile("lib/cron/director-auto.ts", "utf8");
  const links = [
    ["①적재(사람 경로) director.ts → briefs.goal", /INSERT INTO briefs[\s\S]{0,200}goal/.test(dir)],
    ["①적재(자동 경로) director-auto.ts → briefs.goal", /INSERT INTO briefs[\s\S]{0,200}goal/.test(auto)],
    ["②읽기 content-gen.ts ← SELECT goal FROM briefs", /SELECT goal FROM briefs/.test(gen)],
    ["③전달 buildPrompt(… goal …)", /buildPrompt\(\{[\s\S]{0,400}goal[,\s}]/.test(gen)],
    ["④프롬프트 적재 [①-b … 수익 목적]", /①-b[^\n]*수익 목적/.test(gen) && /goalRules\.map/.test(gen)],
  ] as const;
  const broken = links.filter(([, ok]) => !ok).map(([n]) => n);
  out("§1.2 `briefs.goal` 사슬 네 마디가 안 끊겼다(적재→읽기→전달→프롬프트)", broken.length === 0,
    broken.length ? `끊긴 자리: ${broken.join(" · ")}` : links.map(([n]) => n.slice(0, 2)).join("") + " 전 구간 연결");

  /* 🔴 «사슬이 이어졌다» 와 «값이 닿는다» 는 다르다.
     묻는 것: **라이브에 실제로 들어 있는 `briefs.goal` 값으로 돌렸을 때, 그 채널 글이 규칙을 몇 줄 받나.**
     («goalRules 에 mixed 열쇠가 있나» 로 물으면 안 된다 — 답은 열쇠를 더하는 게 아니라 채널 기본으로 떨어뜨리는 것이었다.) */
  const rows = await q(sql`SELECT goal, COUNT(*)::int AS n FROM briefs GROUP BY goal`);
  const total = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  const live = await q(sql`SELECT b.goal, p.channel, COUNT(*)::int AS n FROM pieces p JOIN briefs b ON b.id = p.brief_id
    WHERE p.channel IS NOT NULL GROUP BY b.goal, p.channel`);
  const starved: string[] = [];
  let covered = 0, pieces = 0;
  for (const r of live) {
    const ch = String(r.channel); const c = WRITING_CONTRACTS[ch];
    if (!c?.text) continue;
    const n = Number(r.n ?? 0); pieces += n;
    const res = resolveGoalDetail({ affiliate: false, briefGoal: String(r.goal ?? "") || null, channel: ch });
    const rules = c.goalRules?.[res.goal]?.length ?? 0;
    if (rules > 0) covered += n; else starved.push(`${ch}/brief=${r.goal}→${res.goal} ${n}편`);
  }
  const mixedN = Number(rows.find((r) => String(r.goal) === "mixed")?.n ?? 0);
  out("🔴 §1.2 …그리고 실제로 **닿나** — 라이브 brief 값으로 돌렸을 때 글이 수익 목적 규칙을 받나",
    starved.length === 0 && pieces > 0,
    `brief ${total}건 중 goal='mixed' ${mixedN}건(${total ? Math.round((mixedN / total) * 100) : 0}%) · 글 ${pieces}편 중 **규칙을 받는 글 ${covered}편**`
    + (starved.length ? ` · 🔴 굶는 조합: ${starved.join(" · ")}` : " · 굶는 조합 0"));

  /* 🔴 음성 대조 — 고치기 전 규칙(«brief 값을 그대로 쓴다»)이었다면 몇 편이 굶었을까. 수리의 크기를 숫자로 남긴다. */
  let oldStarved = 0;
  for (const r of live) {
    const ch = String(r.channel); const c = WRITING_CONTRACTS[ch];
    if (!c?.text) continue;
    const raw = String(r.goal ?? "").trim();
    const oldGoal = raw || (ch === "naver_blog" ? "adpost" : "adsense");      // 옛 규칙: 값이 있으면 그대로(= mixed 도 통과)
    if (!(c.goalRules?.[oldGoal as keyof typeof c.goalRules]?.length)) oldStarved += Number(r.n ?? 0);
  }
  out("§1.2 음성 대조 — **고치기 전 규칙**으로 같은 데이터를 돌리면 굶는 글이 나온다(수리가 실제로 뭔가를 바꿨다)",
    oldStarved > 0 && starved.length === 0, `옛 규칙 ${oldStarved}편 굶음 → 지금 ${starved.length ? "여전히 굶음" : "0편"}`);

  /* 출처를 남기는가(메인 지시 — 안 남기면 다음 사람이 또 추적한다). */
  const d = resolveGoalDetail({ affiliate: false, briefGoal: "mixed", channel: "naver_blog" });
  out("🔴 §1.2 «채널 기본으로 떨어졌다» 를 남긴다(goalSource·briefGoalIgnored 가 meta 에 실린다)",
    d.source === "channel_default" && d.briefGoalIgnored === "mixed" && /goalSource:\s*goalRes\.source/.test(gen) && /briefGoalIgnored/.test(gen),
    `resolveGoalDetail → goal=${d.goal} source=${d.source} 무시한 값=${d.briefGoalIgnored} · content-gen 이 meta 에 적는다`);
}

/** 1.3 골격 가짓수 — seed 20개로 골격만 뽑아 센다(실호출 0 · 순수). */
function s13() {
  for (const [ch, c] of Object.entries(WRITING_CONTRACTS)) {
    if (!c.text) continue;
    const seen = new Map<string, number>();
    let firstDup = 0;
    for (let i = 1; i <= 20; i++) {
      const format = c.formats[i % c.formats.length] as FormatKey;
      const group = topicGroupOf({ format, intent: null, title: "가을 이불 세탁 후기" });
      const seq = structureFor(c, format, c.images.default, false, i, group);
      const h = structureHash(structurePrint(blocksOf(seq)));
      if (seen.has(h) && !firstDup) firstDup = i;
      seen.set(h, (seen.get(h) ?? 0) + 1);
    }
    const kinds = seen.size;
    const tiered = !!c.tiers;
    out(`§1.3 골격 가짓수 — ${ch} 20편에 ${kinds}가지${tiered ? "" : "(tiers 없음 · 무회귀 대상)"}`,
      tiered ? kinds >= 11 && (firstDup === 0 || firstDup > 4) : true,
      `가짓수 ${kinds}/20 · 첫 중복 ${firstDup || "없음"}편째${tiered ? " · 기준 11~32 & 4편째 전 중복 없음" : " · tiers 없는 채널은 종전 그대로가 정상"}`);
  }
}

/** 1.4 `structure_repeat` 음성 대조 — 일부러 같은 골격 두 편을 넣어 **빨강이 뜨는지** 본다. */
function s14() {
  const c = WRITING_CONTRACTS.tistory;
  const same = structureFor(c, "info" as FormatKey, c.images.default, false, 7, "info");
  const mine = structurePrint(blocksOf(same));
  const twin = { id: 101, print: structurePrint(blocksOf(same)) };
  const cmpSame = compareToRecent(mine, [twin]);
  out("🔴 §1.4 음성 대조 — **일부러 같은 골격**을 넣으면 빨강이 뜬다(아무 일 없음으로 통과를 증명하지 않는다)",
    cmpSame.overlap > STRUCTURE_OVERLAP_MAX && cmpSame.compared === 1,
    `겹침 ${cmpSame.overlap}(임계 ${STRUCTURE_OVERLAP_MAX}) · 견준 글 ${cmpSame.compared}편 · against ${cmpSame.againstId}`);

  const other = structureFor(c, "compare" as FormatKey, c.images.default, false, 19, "review");
  const cmpDiff = compareToRecent(mine, [{ id: 102, print: structurePrint(blocksOf(other)) }]);
  out("§1.4 …그러나 다른 골격이면 안 뜬다(양성 대조 — 축이 아무 글이나 빨갛게 하지 않는다)",
    cmpDiff.overlap <= STRUCTURE_OVERLAP_MAX, `겹침 ${cmpDiff.overlap}`);

  const none = compareToRecent(mine, []);
  out("🔴 §1.4 견줄 글이 0편이면 «잴 수 없었다»(compared=0) — 0 을 «통과» 로 접지 않는다(AC-9)",
    none.compared === 0 && none.overlap === 0, `compared=${none.compared} overlap=${none.overlap} · 화면은 이 둘을 갈라 읽어야 한다`);
}

/** 1.5 `similarity` 와 `structure_repeat` 는 **서로 다른 것**을 본다(네 조합). */
function s15() {
  const c = WRITING_CONTRACTS.tistory;
  const seqA = structureFor(c, "info" as FormatKey, c.images.default, false, 7, "info");
  const seqB = structureFor(c, "compare" as FormatKey, c.images.default, false, 19, "review");
  const textA = "가을 이불을 빨래방에서 처음 돌려 봤어요. 건조까지 40분이 걸렸고 생각보다 보송했습니다.";
  const textB = "겨울 담요를 세탁소에서 처음 맡겨 봤어요. 건조까지 50분이 걸렸고 예상보다 포근했습니다.";

  /* ① 단어만 다르고 골격은 같다 → similarity 는 **못 잡고** structure_repeat 가 잡아야 한다. */
  const simWords = maxSimilarity(textA, [textB]);
  const stSame = structureOverlap(structurePrint(blocksOf(seqA)), structurePrint(blocksOf(seqA)));
  out("🔴 §1.5 «단어만 바꾼 두 편» — 글자 축(similarity)은 놓치고 **골격 축이 잡는다**",
    stSame > STRUCTURE_OVERLAP_MAX, `similarity ${simWords.score.toFixed(3)} · structure ${stSame} ⇒ 골격 축이 없으면 이 글은 그냥 통과한다`);

  /* ② 골격만 다르고 본문은 거의 같다 → structure 는 놓치고 similarity 가 잡아야 한다. */
  const simSame = maxSimilarity(textA, [textA]);
  const stDiff = structureOverlap(structurePrint(blocksOf(seqA)), structurePrint(blocksOf(seqB)));
  out("🔴 §1.5 «골격만 바꾼 두 편» — 골격 축은 놓치고 **글자 축이 잡는다**(서로 대신하지 못한다)",
    simSame.score >= 0.9 && stDiff <= STRUCTURE_OVERLAP_MAX, `similarity ${simSame.score.toFixed(3)} · structure ${stDiff}`);
}

/** 1.6 `lengthByGroup`·`imagesByGroup` — 주제군마다 다르고, group 이 null 이면 채널 고정값(무회귀). */
function s16() {
  const c = WRITING_CONTRACTS.naver_blog;
  const groups = ["review", "info", "life"] as const;
  const lens = groups.map((g) => `${g} ${lengthFor(c, g).min}~${lengthFor(c, g).max}`);
  const distinct = new Set(groups.map((g) => `${lengthFor(c, g).min}/${lengthFor(c, g).max}`)).size;
  out("§1.6 주제군별 분량이 실제로 갈린다(naver_blog)", distinct === 3, `${lens.join(" · ")} · 서로 다른 값 ${distinct}/3`);

  const fb = lengthFor(c, null);
  out("🔴 §1.6 group 이 null 이면 **채널 고정값**으로 떨어진다(무회귀)",
    fb.min === c.length.min && fb.max === c.length.max, `null → ${fb.min}~${fb.max} · 채널 고정값 ${c.length.min}~${c.length.max}`);

  const g3 = [
    topicGroupOf({ format: "compare", intent: null, title: "제습제 비교" }),
    topicGroupOf({ format: "info", intent: null, title: "전기요금 계산법" }),
    topicGroupOf({ format: "story", intent: null, title: "주말 일기" }),
  ];
  out("§1.6 `topicGroupOf` 가 소재 셋을 실제로 셋으로 가른다", new Set(g3).size === 3, `${g3.join(" · ")}`);

  const imgNull = imagesFor(c, null);
  out("§1.6 `imagesFor` 도 group 없으면 채널 고정값", imgNull.min === c.images.min && imgNull.default === c.images.default,
    `null → ${imgNull.min}~${imgNull.max}(기본 ${imgNull.default}) · 채널값 ${c.images.min}~${c.images.max}(${c.images.default})`);
}

/** 1.8 끝맺음이 «행동 유도 한 줄»(tip)로 나오나 — 구조를 고쳐야 바뀐다던 그 자리. */
function s18() {
  for (const ch of ["naver_blog", "tistory", "blogger", "wordpress"]) {
    const c = WRITING_CONTRACTS[ch];
    if (!c?.text) continue;
    const ends = new Set<string>();
    let faqEnd = 0;
    for (let i = 1; i <= 12; i++) {
      const format = c.formats[i % c.formats.length] as FormatKey;
      const seq = structureFor(c, format, c.images.default, false, i, topicGroupOf({ format, intent: null, title: "가을 이불" }));
      const last = seq[seq.length - 1];
      const tail = last === "hashtags" ? seq[seq.length - 2] : last;
      ends.add(String(tail));
      if (tail === "faq") faqEnd++;
    }
    out(`§1.8 끝맺음 — ${ch} 12편이 faq 로 끝나지 않는다(행동 유도 tip)`, faqEnd === 0,
      `faq 끝맺음 ${faqEnd}편 · 실제 끝맺음 ${[...ends].join(",")}`);
  }

  /* 🔴 음성 대조 — seed 를 안 주면(옛 경로) 끝맺음 교정이 **안 걸린다**는 것까지 확인한다(무회귀의 반대편). */
  const c = WRITING_CONTRACTS.tistory;
  const old = structureFor(c, "qna" as FormatKey, c.images.default, false);
  const neo = structureFor(c, "qna" as FormatKey, c.images.default, false, 5, "info");
  out("🔴 §1.8 음성 대조 — seed 없이 부르면 종전 골격 그대로다(끝맺음 교정이 **적용 전**)",
    JSON.stringify(old) !== JSON.stringify(neo), `seed 없음 끝=${old[old.length - 1]} · seed 있음 끝=${neo[neo.length - 1]} · 길이 ${old.length}→${neo.length}`);
}

/* ═══════════════════ §2 정책 — 대가 3종 · 금칙 3층 · 유도 3층 ═══════════════════ */

/** 2.1·2.2 대가 3종(affiliate·sponsored·gift) — 각각 부르고, `false` 는 안 내려간다. */
async function s21() {
  const kinds = ["affiliate", "sponsored", "gift"] as const;
  const one = (k: (typeof kinds)[number]) => disclosureTextFor({ [k]: true, provider: k === "affiliate" ? "coupang" : null } as never);
  const texts = kinds.map((k) => ({ k, t: one(k) }));
  out("§2.1 대가 3종이 **각각 다른** 고지 문장을 부른다", new Set(texts.map((x) => x.t)).size === 3,
    texts.map((x) => `${x.k}=«${x.t.slice(0, 18)}…»`).join(" · "));

  for (const k of kinds) {
    const meta = { [k]: k === "affiliate" ? { provider: "coupang" } : true } as Record<string, unknown>;
    const comp = compensationOfMeta(meta);
    out(`§2.1 meta.${k} → 대가 «${k}» 로 읽힌다(need=true)`, comp.need === true && comp.kinds.includes(k),
      `kinds=[${comp.kinds.join(",")}] need=${comp.need}`);
  }

  const both = compensationOfMeta({ affiliate: { provider: "coupang" }, sponsored: true, gift: true });
  const bothText = disclosureTextFor({ affiliate: true, sponsored: true, gift: true, provider: "coupang" });
  const all3 = kinds.every((k) => bothText.includes(one(k).slice(0, 12)));
  out("🔴 §2.1 둘 이상 켜면 문장이 **전부** 나온다(«대가를 받았습니다» 로 뭉뚱그리면 종류를 감춘 셈)",
    both.kinds.length === 3 && all3, `kinds=[${both.kinds.join(",")}] · 문장 ${bothText.split(". ").length}개 · 길이 ${bothText.length}자`);

  /* 🔴 2.2 켜기만 받는다 — false 로는 내려가지 않는다(값에서 한 번, 받는 입구에서 한 번). */
  const offAll = compensationOfMeta({ affiliate: false, sponsored: false, gift: false });
  const offOne = compensationOfMeta({ affiliate: { provider: "coupang" }, sponsored: false });
  out("🔴 §2.2 값 — `false` 면 고지가 안 켜지고, 켜진 것은 안 꺼진다",
    offAll.need === false && offAll.kinds.length === 0 && offOne.kinds.length === 1 && offOne.kinds[0] === "affiliate",
    `전부 false → kinds [] need=${offAll.need} · affiliate 켜고 sponsored=false → [${offOne.kinds.join(",")}]`);

  const fs = await import("node:fs/promises");
  const pieces = await fs.readFile("netlify/functions/pieces.ts", "utf8");
  const onlyTrue = /sponsored:\s*mz\.sponsored\s*===\s*true/.test(pieces) && /gift:\s*mz\.gift\s*===\s*true/.test(pieces);
  const guarded = /if\s*\(turnOn\.sponsored\s*\|\|\s*turnOn\.gift\)/.test(pieces);
  const noFalseWrite = !/sponsored:\s*false/.test(pieces.split("monetize")[1] ?? "");
  out("🔴 §2.2 입구 — `pieces-update` 의 `monetize` 는 **켜기만** 쓴다(false 를 meta 에 안 적는다)",
    onlyTrue && guarded && noFalseWrite,
    `=== true 로만 읽음 ${onlyTrue} · 켜질 때만 UPDATE ${guarded} · false 를 쓰는 자리 ${noFalseWrite ? "없음" : "있음"}`);

  /* 옛 글 소급 0 — `adDisclosure:true` 만 있던 글은 여전히 «제휴» 로 읽혀야 한다. */
  const legacy = compensationOfMeta({ adDisclosure: true });
  out("§2.2 소급 0 — 종류 칸이 없던 옛 글(`adDisclosure:true`)은 그대로 «제휴» 로 읽힌다",
    legacy.kinds.length === 1 && legacy.kinds[0] === "affiliate", `kinds=[${legacy.kinds.join(",")}]`);

  /* 고지가 첫 블록이 아니면 막는다 + 종류가 빠져도 막는다(글 경로). */
  const bad = checkDisclosure([{ type: "para", text: "본문" } as Block, { type: "disclosure", text: one("affiliate") } as Block], { affiliate: { provider: "coupang" } });
  const missKind = checkDisclosure([{ type: "disclosure", text: one("affiliate") } as Block], { affiliate: { provider: "coupang" }, sponsored: true });
  const good = checkDisclosure([{ type: "disclosure", text: disclosureTextFor({ affiliate: true, sponsored: true, provider: "coupang" }) } as Block], { affiliate: { provider: "coupang" }, sponsored: true });
  out("🔴 §2.1 고지가 첫머리가 아니거나 **종류가 빠지면** 막는다 · 다 있으면 통과",
    bad.ok === false && missKind.ok === false && good.ok === true,
    `첫머리 아님 ${bad.ok} · 종류 빠짐 ${missKind.ok}(«${String(missKind.detail ?? "").slice(0, 28)}») · 전부 있음 ${good.ok}`);
}

/** 2.3 금칙 3층 — HARD 는 막고 · NEEDS_PROOF 는 근거가 붙으면 통과 · TONE 은 경고만. */
function s23() {
  const hard = classifyBanned("이 제품은 부작용 없음 이라 안심하고 쓰세요");
  out("§2.3 HARD 는 막는다", hard.hard.length > 0, `hard=[${hard.hard.map((h) => h.word).join(",")}] needsProof=${hard.needsProof.length} tone=${hard.tone.length}`);

  const noProof = classifyBanned("이 제품은 판매량 1위입니다");
  const withProof = classifyBanned("이 제품은 판매량 1위(2026년 9월 네이버 쇼핑 기준)입니다");
  out("🔴 §2.3 NEEDS_PROOF — 근거가 없으면 막고, **근거가 붙으면 통과한다**(이번에 고친 과차단)",
    noProof.needsProof.length > 0 && withProof.needsProof.length === 0,
    `근거 없음 → needsProof ${noProof.needsProof.length}건 · 근거 있음 → ${withProof.needsProof.length}건 · «판매량 1위(2026년 9월 네이버 쇼핑 기준)» 는 통과해야 한다`);
  out("§2.3 `hasEvidenceNear` 가 그 판정의 근거다", hasEvidenceNear("판매량 1위(2026년 9월 네이버 쇼핑 기준)", "판매량 1위") === true
    && hasEvidenceNear("판매량 1위입니다", "판매량 1위") === false, "근거 있음 true · 없음 false");

  const tone = classifyBanned("이건 진짜 역대급 끝판왕이에요");
  out("§2.3 TONE 은 경고만(막지 않는다 — hard·needsProof 0)", tone.tone.length > 0 && tone.hard.length === 0 && tone.needsProof.length === 0,
    `tone=[${tone.tone.map((h) => h.word).join(",")}] hard=${tone.hard.length} needsProof=${tone.needsProof.length}`);

  const clean = classifyBanned("가을 이불을 빨래방에서 돌려 봤어요. 건조까지 40분 걸렸습니다.");
  out("🔴 §2.3 음성 대조 — 멀쩡한 글은 세 층 다 0건(사전이 아무 글이나 물지 않는다)",
    clean.hard.length === 0 && clean.needsProof.length === 0 && clean.tone.length === 0, "hard 0 · needsProof 0 · tone 0");
}

/** 2.4 의료 경험담 — 건강 소재 판정이 두 경로 모두의 입구에 있나. */
async function s24() {
  const fs = await import("node:fs/promises");
  out("§2.4 건강 소재 판정이 동작한다", isHealthTopic("무릎 통증에 좋은 영양제 효능 후기") === true && isHealthTopic("가을 이불 세탁법") === false,
    `건강 소재 true · 일반 소재 false`);
  const callers: string[] = [];
  for (const f of ["lib/ai-tell-gate.ts", "lib/content-approve.ts", "lib/cron/produce.ts", "lib/cron/director-auto.ts", "lib/director.ts", "netlify/functions/pieces.ts"]) {
    const src = await fs.readFile(f, "utf8").catch(() => "");
    if (/isHealthTopic|BANNED_HEALTH_CLAIM|banned-categories/.test(src)) callers.push(f);
  }
  const human = callers.some((f) => /pieces\.ts|content-approve/.test(f));
  const auto = callers.some((f) => /produce|director/.test(f)) || callers.some((f) => /ai-tell-gate|content-approve/.test(f));
  out("🔴 §2.4 사람 경로·자동 경로 **둘 다** 그 판정을 지난다(한쪽만 막으면 다른 쪽으로 나간다 · AC-29)",
    human && auto, `건강 판정을 부르는 파일: ${callers.join(" · ") || "없음"}`);
}

/** 2.5 🔴 유도 3층 — ①만 빨강 · ②③은 초록. 사장님이 직접 그은 선이다. */
function s25() {
  const L1 = [
    "아래 배너 한 번씩 눌러 주세요.",
    "광고 보고 가세요!",
    "하단 광고 클릭해 주시면 큰 힘이 됩니다.",
    "애드센스 광고 한 번씩 눌러 주시면 감사하겠습니다.",
  ];
  const L2 = [
    "제가 쓴 제품은 아래 링크에서 확인하실 수 있어요.",
    "쿠팡에서 최저가 확인해 보세요.",
    "같은 모델 링크 걸어 둘게요, 필요하시면 눌러서 보세요.",
    "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.",
  ];
  const L3 = [
    "다음 글에서는 건조기 이야기를 해볼게요, 보고 가세요.",
    "나중에 또 필요하실 테니 저장해 두세요.",
    "이웃 추가해 두시면 다음 글도 바로 보실 수 있어요.",
    "댓글로 궁금한 점 남겨 주시면 답해 드릴게요.",
  ];
  const hit = (s: string) => findAdPointing(s).length;

  const l1miss = L1.filter((s) => hit(s) === 0);
  out("🔴 §2.5-① 광고를 가리키는 유도 = **빨강**(계정 정지 사유)", l1miss.length === 0,
    l1miss.length ? `못 잡은 문장 ${l1miss.length}건: «${l1miss[0]}»` : `${L1.length}건 전부 잡힘`);

  const l2bad = L2.filter((s) => hit(s) > 0);
  out("🔴 §2.5-② 우리 링크(쿠팡 제휴)로의 유도 = **초록**(빨개지면 그게 결함이다)", l2bad.length === 0,
    l2bad.length ? `잘못 잡힌 문장 ${l2bad.length}건: «${l2bad.join(" / ")}»` : `${L2.length}건 전부 통과`);

  const l3bad = L3.filter((s) => hit(s) > 0);
  out("🔴 §2.5-③ 독자 행동 유도(계속 읽기·저장·구독) = **초록**(오히려 더 해야 하는 것)", l3bad.length === 0,
    l3bad.length ? `잘못 잡힌 문장 ${l3bad.length}건: «${l3bad.join(" / ")}»` : `${L3.length}건 전부 통과`);

  out("§2.5 고지 문장 자체는 안 잡는다(지시 동사가 없다)", hit("이 글에는 광고가 포함되어 있습니다.") === 0, "고지 → 0건");
}

/** 2.6 해시태그 4건 — 🔴 **grep 이 아니라 함수가 내놓는 문자열**을 센다(AC-57 대용물 금지 · 첫 판에서 내가 grep 으로 쟀다가 틀렸다). */
async function s26() {
  const { buildCaption } = await import("../lib/publish/instagram");
  const { youtubeTags, buildDescription } = await import("../lib/publish/youtube") as {
    youtubeTags: (raw: unknown[]) => string[]; buildDescription?: (p: unknown) => string;
  };
  const tags10 = ["가을이불", "세탁", "빨래방", "꿀팁", "후기", "리뷰", "살림", "주부", "생활", "정보"];
  const base = { id: 1, tenantId: 1, kind: "post", accountId: null, title: "t", bodyHtml: "<p>가을 이불 후기입니다.</p>", blocks: [], images: [], tags: tags10, disclosure: null, affiliate: null };

  const th = buildCaption({ ...base, channel: "threads" } as never, 500);
  const thN = (th.match(/#/g) || []).length;
  out("🔴 §2.6 쓰레드 토픽 태그 **0~1개**(공식: 게시물당 1개 · 해시태그가 아니다)", thN <= 1, `태그 ${thN}개 · 캡션 «${th.slice(-40)}»`);

  const ig = buildCaption({ ...base, channel: "reels" } as never, 2_200);
  out("§2.6 …그러나 인스타는 그대로 여러 개(양성 대조 — 상한이 다른 채널을 같이 깎지 않았다)",
    (ig.match(/#/g) || []).length === tags10.length, `인스타 태그 ${(ig.match(/#/g) || []).length}개`);

  const thAff = buildCaption({ ...base, channel: "threads", affiliate: { provider: "coupang" } } as never, 500);
  out("🔴 §2.6 쓰레드 + 제휴 — 한 자리는 **`#광고` 가 먼저 쓴다**(태그 자리를 법이 먼저 쓴다)",
    (thAff.match(/#/g) || []).length === 1 && thAff.includes("#광고"), `태그 ${(thAff.match(/#/g) || []).length}개 · «${thAff.split("\n").pop()}»`);

  const long = Array.from({ length: 40 }, (_, i) => `아주긴검색태그이름${i}`.padEnd(28, "가"));
  const yts = youtubeTags(long);
  const chars = yts.reduce((a, t) => a + t.length + 1, -1);
  out("🔴 §2.6 `snippet.tags` 500자 컷 — **누적 글자로** 자른다(개수가 아니라)", chars <= 500 && yts.length < long.length,
    `태그 ${yts.length}/${long.length}개 · 누적 ${chars}자(상한 500)`);
  out("§2.6 …짧은 태그는 안 잘린다(양성 대조)", youtubeTags(tags10).length === tags10.length, `${youtubeTags(tags10).length}/${tags10.length}개 통과`);

  const fs = await import("node:fs/promises");
  const yt = await fs.readFile("lib/publish/youtube.ts", "utf8");
  const dh = Number((yt.match(/const DESCRIPTION_HASHTAGS\s*=\s*(\d+)/) ?? [])[1] ?? 0);
  out("§2.6 유튜브 **설명란** 해시태그는 4개(검색 태그와 다른 것)", dh === 4 && /slice\(0,\s*DESCRIPTION_HASHTAGS\)/.test(yt),
    `DESCRIPTION_HASHTAGS=${dh} · 설명란이 그 상수로 자른다`);
}

async function main() {
  try {
    if (SECTIONS.has("1")) { await s12(); s13(); s14(); s15(); s16(); s18(); }
    if (SECTIONS.has("2")) { await s21(); s23(); await s24(); s25(); await s26(); }
  } finally {
    await pgClient.end().catch(() => {});
  }
}
await main();
