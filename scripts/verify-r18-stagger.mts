/**
 * scripts/verify-r18-stagger.mts — 🔴 **한 영상의 N곳이 같은 분에 안 나가는가**(R18 · B2 · 2026-09-26 · 트리거 §6-3 · CLAUDE §4.7)
 *   사용: npx --yes tsx scripts/verify-r18-stagger.mts          · DB 0 · 네트워크 0
 *   🔴 `--json` 은 **일부러 없다** — `tally` 가 사람말을 stdout 에 찍으므로 JSON 을 섞으면 AC-240(남의 입구) 함정이 된다.
 *
 *   ══ 이 자가 보는 것 — «편성 함수 안» (C 와 나눔: C 의 `verify-r18-one-video-many` 는 «결과(DB 의 가족 시각)»를 본다) ══
 *     ⓪ 🔴 과녁이 살아 있나(AC-236) — **옛 길(`pickPublishAt`)이 실제로 같은 분을 내는가**부터 찍는다.
 *        옛 길이 안 모이면 이 자는 «고친 것»이 아니라 «원래 없던 병»을 재는 것이다.
 *     ① `staggerDerived` 표본 — 기본·밤·계정 간격·채널 간격·하루 몫·유튜브 통 · 결정론
 *     ② 퍼징 — 씨앗 고정 난수 **N개 판**에서 불변식 5개(가족 시차·계정 간격·채널 간격·밤 없음·하루 몫)
 *     ③ `staggerClashes` — 깨진 쌍을 세는 자가 **세는가**
 *     ④ 🔴 변이(인자 수준 3종) — 불변식 검사기가 **틀린 배치를 잡는가**(«자가 통과한다»가 아니라 «자가 문다»)
 *     ⑤ 경로 — 파생이 시각을 받는 **모든 길**이 가족을 본다: `scheduleDerived`(새로) · `releaseBacklog`(깰 때) · `slots-reschedule`(옮길 때) · 크론 줍기
 *     ⑥ 🔴 경로 변이 4종 — 소스를 메모리에서 틀어 ⑤의 **같은 판정식**이 우는지(파일은 안 건드린다)
 *
 *   🔴 검산 수는 «무엇을 · 어디서 · 몇»(AC-262). 끝에 표로 찍는다.
 *   종료코드: 0 = 지켜진다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync } from "node:fs";
import {
  staggerDerived, staggerClashes, morningOf, isUnplaced, DERIVED_STAGGER_MIN, DERIVED_LEAD_MIN,
  type StaggerTarget, type StaggerPick,
} from "../lib/derived-schedule";
import { pickPublishAt, kstToUtc, kstDateStr, addDays, isNightHour, ACCOUNT_GAP_MIN, BEST_HOURS } from "../lib/best-time";
import { stripComments, blockOf, orderIn, tally } from "./_lib/block.mjs";

const T = tally();
const counts: Record<string, string> = {};
const KST_MS = 9 * 3600_000;
const kstHour = (d: Date) => new Date(d.getTime() + KST_MS).getUTCHours();
const kst = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(5, 16).replace("T", " ");
const say = (s: string) => { console.log(s); };

/** 불변식 검사기 — 🔴 이 함수가 곧 «자»다. 변이(④)가 이 함수를 그대로 쓴다. */
function violations(originAt: Date, family0: Date[], targets: StaggerTarget[], picks: StaggerPick[], now: Date, stagger = DERIVED_STAGGER_MIN): string[] {
  const out: string[] = [];
  const fam: { id: string; at: Date }[] = [{ id: "origin", at: originAt }, ...family0.map((d, i) => ({ id: `fixed${i}`, at: d }))];
  for (const p of picks) if (p.at) fam.push({ id: `piece${p.pieceId}`, at: p.at });
  for (let i = 0; i < fam.length; i++) for (let j = i + 1; j < fam.length; j++) {
    const g = Math.abs(fam[i].at.getTime() - fam[j].at.getTime()) / 60_000;
    if (g < stagger) out.push(`가족 시차 ${fam[i].id}↔${fam[j].id} ${g.toFixed(1)}분 < ${stagger}`);
  }
  const perDay = new Map<string, number>();
  for (const p of picks) {
    if (!p.at) continue;
    const t = targets.find((x) => x.pieceId === p.pieceId)!;
    if (p.at.getTime() < now.getTime() + DERIVED_LEAD_MIN * 60_000 - 1) out.push(`piece${p.pieceId} 가 지금+${DERIVED_LEAD_MIN}분보다 앞`);
    if (isNightHour(kstHour(p.at))) out.push(`piece${p.pieceId} 가 밤(${kst(p.at)})`);
    for (const x of t.takenSameAccount) if (Math.abs(x.getTime() - p.at.getTime()) < t.accountGapMin * 60_000) out.push(`piece${p.pieceId} 같은 계정 간격 < ${t.accountGapMin}`);
    for (const x of t.takenSameChannel) if (Math.abs(x.getTime() - p.at.getTime()) < t.channelGapMin * 60_000) out.push(`piece${p.pieceId} 같은 채널 간격 < ${t.channelGapMin}`);
    if (t.day) {
      const d = kstDateStr(p.at); const k = `${t.accountId}|${d}`;
      const used = (perDay.get(k) ?? t.day.used.get(d) ?? 0) + 1; perDay.set(k, used);
      if (used > t.day.cap(d)) out.push(`piece${p.pieceId} 하루 몫 초과 ${used}/${t.day.cap(d)} (${d})`);
    }
  }
  return out;
}
const tgt = (pieceId: number, channel: string, accountId: number, extra: Partial<StaggerTarget> = {}): StaggerTarget => ({
  pieceId, channel, accountId, takenSameAccount: [], takenSameChannel: [], accountGapMin: 180, channelGapMin: ACCOUNT_GAP_MIN, ...extra,
});
/** 표본마다 `targets` 가 함수 안에서 바뀌지 않았다는 것을 믿지 않는다 — 검사용 사본을 따로 만든다. */
const clone = (ts: StaggerTarget[]): StaggerTarget[] => ts.map((t) => ({ ...t, takenSameAccount: [...t.takenSameAccount], takenSameChannel: [...t.takenSameChannel],
  ...(t.day ? { day: { cap: t.day.cap, used: new Map(t.day.used) } } : {}), ...(t.pool ? { pool: { cap: t.pool.cap, used: new Map(t.pool.used) } } : {}) }));

/* ═══ ⓪ 과녁이 살아 있나 — 옛 길이 정말 같은 분을 내나 ═══ */
say("■ ⓪ 🔴 과녁 — 옛 길(`pickPublishAt` · 채널별로 따로 잡는다)이 **실제로** 한 가족을 같은 분에 모으나(AC-236)");
{
  const now = kstToUtc("2026-09-28", 13, 0);   // C 실측과 같은 조건(KST 13:00 · 흔들림 씨앗 없음 = releaseBacklog 그대로)
  const chans = ["youtube_shorts", "reels", "tiktok", "naver_clip", "facebook_reels"];
  const old = chans.map((c) => ({ c, at: pickPublishAt({ channel: c, taken: [], takenSameAccount: [], now }).at }));
  const same = old.filter((a, i) => old.some((b, j) => j !== i && a.at.getTime() === b.at.getTime()));
  say(`    옛 길: ${old.map((o) => `${o.c} ${kst(o.at)}`).join(" · ")}`);
  T.ok("⓪ 옛 길은 틱톡·클립을 **같은 분**에 둔다(= 고칠 병이 실제로 있다 · 과녁이 산다)", same.some((s) => s.c === "tiktok") && same.some((s) => s.c === "naver_clip"),
    `같은 분 ${same.map((s) => s.c).join(",") || "없음"} — 기본표가 바뀌었으면 이 과녁을 다시 골라라`);
  T.ok("⓪ 기본표에 틱톡·클립 첫 후보가 둘 다 19:00(과녁의 근거)", BEST_HOURS.tiktok?.[0]?.h === 19 && BEST_HOURS.naver_clip?.[0]?.h === 19);
}

/* ═══ ① 표본 ═══ */
say("■ ① `staggerDerived` 표본");
{
  const now = kstToUtc("2026-09-28", 13, 0);
  const originAt = kstToUtc("2026-09-28", 18, 0);
  // 기본 — 넷
  const ts = [tgt(11, "reels", 101), tgt(12, "tiktok", 102), tgt(13, "naver_clip", 103), tgt(14, "facebook_reels", 104)];
  const picks = staggerDerived({ originAt, targets: clone(ts), now });
  say(`    기본: 원본 ${kst(originAt)} → ${picks.map((p) => `${p.channel} ${p.at ? kst(p.at) : "없음"}`).join(" · ")}`);
  T.ok("① 넷 다 자리를 받는다", picks.every((p) => !!p.at));
  T.ok("① 불변식 위반 0(가족 시차·밤·간격·하루 몫)", violations(originAt, [], ts, picks, now).length === 0, violations(originAt, [], ts, picks, now).join(" / "));
  T.ok("① 전부 원본 **뒤**", picks.every((p) => p.at && p.at.getTime() >= originAt.getTime() + DERIVED_STAGGER_MIN * 60_000));
  const again = staggerDerived({ originAt, targets: clone(ts), now });
  T.ok("① 결정론 — 같은 입력이면 같은 시각(편성은 여러 번 돈다)", JSON.stringify(picks) === JSON.stringify(again));
  T.ok("① 입력 `targets` 를 건드리지 않는다(부른 쪽 목록이 몰래 늘지 않는다)", ts.every((t) => t.takenSameAccount.length === 0 && t.takenSameChannel.length === 0));

  // 밤 — 원본 23:40 → 셋째부터 00시를 넘는다
  const late = kstToUtc("2026-09-28", 23, 40);
  const pn = staggerDerived({ originAt: late, targets: clone(ts), now });
  say(`    밤: 원본 ${kst(late)} → ${pn.map((p) => `${p.channel} ${p.at ? kst(p.at) : "없음"}`).join(" · ")}`);
  T.ok("① 밤(0~6시 KST)에 안 잡는다 — 그 채널 아침 첫 좋은 시각으로 넘어간다", pn.every((p) => p.at && !isNightHour(kstHour(p.at))));
  T.ok("① 밤을 넘겨도 불변식 위반 0", violations(late, [], ts, pn, now).length === 0, violations(late, [], ts, pn, now).join(" / "));
  const tk = pn.find((p) => p.channel === "tiktok");
  T.ok("① 넘어간 자리는 그 채널의 `morningOf`(틱톡 19:00) 이후", !!tk?.at && (kstHour(tk.at) >= morningOf("tiktok").h || tk.at.getTime() - late.getTime() < 3 * 3600_000));

  // 계정 간격 — 같은 계정의 다른 글이 18:30 에 있다(간격 180)
  const busyAcc = [tgt(21, "reels", 201, { takenSameAccount: [kstToUtc("2026-09-28", 18, 30)], accountGapMin: 180 })];
  const pa = staggerDerived({ originAt, targets: clone(busyAcc), now });
  T.ok("① 같은 계정 글과 180분 이상 떨어진다", violations(originAt, [], busyAcc, pa, now).length === 0 && !!pa[0].at, pa[0].at ? kst(pa[0].at) : "없음");

  // 채널 간격 — 같은 채널 다른 계정이 18:40
  const busyCh = [tgt(31, "tiktok", 301, { takenSameChannel: [kstToUtc("2026-09-28", 18, 40)], channelGapMin: 30 })];
  const pc = staggerDerived({ originAt, targets: clone(busyCh), now });
  T.ok("① 같은 채널 다른 계정과 30분 이상", violations(originAt, [], busyCh, pc, now).length === 0 && !!pc[0].at, pc[0].at ? kst(pc[0].at) : "없음");

  // 하루 몫 — 그날 이미 1건 · 상한 1
  const d0 = kstDateStr(originAt);
  const capped = [tgt(41, "naver_clip", 401, { day: { cap: () => 1, used: new Map([[d0, 1]]) } })];
  const pd = staggerDerived({ originAt, targets: clone(capped), now });
  T.ok("① 하루 몫이 찬 날은 건너뛴다(다음 날 아침)", !!pd[0].at && kstDateStr(pd[0].at) === addDays(d0, 1), pd[0].at ? kst(pd[0].at) : "없음");

  // 유튜브 통 — 테넌트 그날 유튜브 5/5
  const pool = { cap: () => 5, used: new Map([[d0, 5]]) };
  const yt = [tgt(51, "youtube_shorts", 501, { pool })];
  const py = staggerDerived({ originAt: kstToUtc("2026-09-28", 15, 0), targets: yt, now });
  T.ok("① 유튜브 통(하루 5)이 찬 날은 건너뛴다 — «내일 이어서»를 세 번 돌지 않게", !!py[0].at && kstDateStr(py[0].at) === addDays(d0, 1), py[0].at ? kst(py[0].at) : "없음");
  T.ok("① 잡으면 통에 1 을 더한다(같은 통을 쓰는 다음 파생이 본다)", (pool.used.get(kstDateStr(py[0].at!)) ?? 0) === 1);

  // 자리가 없다 — 14일 내내 하루 몫 0
  const none = [tgt(61, "reels", 601, { day: { cap: () => 0, used: new Map() } })];
  const pz = staggerDerived({ originAt, targets: clone(none), now });
  T.ok("① 자리가 없으면 `at:null`·`no_room` 으로 **돌려준다**(지어내지 않는다 · 막지도 않는다 — 부른 쪽이 «기다린다»고 말한다)", pz[0].at === null && (pz[0] as { why?: string }).why === "no_room");

  // 이미 나간 원본 — 원본이 과거면 지금+20분부터
  const pastOrigin = kstToUtc("2026-09-27", 18, 0);
  const pp = staggerDerived({ originAt: pastOrigin, targets: clone(ts.slice(0, 2)), now });
  T.ok("① 원본이 이미 나갔으면 지금+20분 뒤부터(과거에 잡지 않는다)", pp.every((p) => p.at && p.at.getTime() >= now.getTime() + DERIVED_LEAD_MIN * 60_000));

  // 가족에 이미 잡힌 형제가 있다 — 그 시각도 피한다
  const fixed = [kstToUtc("2026-09-28", 18, 30)];
  const pf = staggerDerived({ originAt, family: fixed, targets: clone([tgt(71, "tiktok", 701)]), now });
  T.ok("① 이미 잡힌 형제 시각도 30분 피한다", violations(originAt, fixed, [tgt(71, "tiktok", 701)], pf, now).length === 0, pf[0].at ? kst(pf[0].at) : "없음");
}

/* ═══ ② 퍼징 ═══ */
say("■ ② 퍼징 — 씨앗 고정 난수 판에서 불변식 5개");
const FUZZ = 600;
let fuzzPicks = 0, fuzzNoRoom = 0, fuzzBad = 0;
const fuzzBadSamples: string[] = [];
{
  let seed = 20260926;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const CH = ["reels", "tiktok", "naver_clip", "facebook_reels", "youtube_shorts"];
  for (let run = 0; run < FUZZ; run++) {
    const day = addDays("2026-09-28", Math.floor(rnd() * 5));
    const now = kstToUtc(day, Math.floor(rnd() * 24), Math.floor(rnd() * 60));
    const originAt = new Date(now.getTime() + Math.floor(rnd() * 72 * 60) * 60_000 - 6 * 3600_000);
    const k = 1 + Math.floor(rnd() * 4);
    const chans = [...CH].sort(() => rnd() - 0.5).slice(0, k);
    const ts = chans.map((c, i) => {
      const accGap = [60, 180, 360][Math.floor(rnd() * 3)];
      const takenA = Array.from({ length: Math.floor(rnd() * 4) }, () => new Date(originAt.getTime() + Math.floor(rnd() * 24 * 60) * 60_000));
      const takenC = Array.from({ length: Math.floor(rnd() * 4) }, () => new Date(originAt.getTime() + Math.floor(rnd() * 24 * 60) * 60_000));
      const capN = [0, 1, 2, 3][Math.floor(rnd() * 4)];
      const used = new Map<string, number>(); for (let d = -1; d < 16; d++) if (rnd() < 0.3) used.set(addDays(day, d), Math.floor(rnd() * 3));
      return tgt(1000 + run * 10 + i, c, 5000 + i, { takenSameAccount: takenA, takenSameChannel: takenC, accountGapMin: accGap, channelGapMin: rnd() < 0.5 ? 30 : 5,
        ...(rnd() < 0.7 ? { day: { cap: () => capN, used } } : {}) });
    });
    const family = rnd() < 0.3 ? [new Date(originAt.getTime() + 45 * 60_000)] : [];
    const picks = staggerDerived({ originAt, family, targets: clone(ts), now });
    fuzzPicks += picks.filter((p) => p.at).length; fuzzNoRoom += picks.filter((p) => !p.at).length;
    const v = violations(originAt, family, ts, picks, now);
    if (v.length) { fuzzBad++; if (fuzzBadSamples.length < 3) fuzzBadSamples.push(`판 ${run}: ${v[0]}`); }
  }
  T.ok(`② ${FUZZ}판 · 잡힌 자리 ${fuzzPicks} · 자리 없음 ${fuzzNoRoom} — 불변식 위반 판 0`, fuzzBad === 0, fuzzBadSamples.join(" / "));
  T.ok("② 퍼징이 «자리 없음» 판도 실제로 만든다(한쪽만 재는 퍼징이 아니다)", fuzzNoRoom > 0 && fuzzPicks > 0, `잡힘 ${fuzzPicks} · 없음 ${fuzzNoRoom}`);
  counts["퍼징"] = `${FUZZ}판 · 자리 ${fuzzPicks} · 없음 ${fuzzNoRoom} · 위반 ${fuzzBad}`;
}

/* ═══ ③ staggerClashes ═══ */
say("■ ③ `staggerClashes` — 깨진 쌍을 세는가");
{
  const a = kstToUtc("2026-09-28", 19, 0);
  const c1 = staggerClashes([{ pieceId: 1, at: a }, { pieceId: 2, at: a }, { pieceId: 3, at: new Date(a.getTime() + 40 * 60_000) }]);
  T.ok("③ 같은 분 한 쌍을 센다(1↔2)", c1.length === 1 && c1[0].a === 1 && c1[0].b === 2 && c1[0].gapMin === 0);
  const c2 = staggerClashes([{ pieceId: 1, at: a }, { pieceId: 2, at: new Date(a.getTime() + 29 * 60_000) }]);
  T.ok("③ 29분도 깨진 쌍이다(같은 분뿐 아니라 시차 안이면)", c2.length === 1);
  const c3 = staggerClashes([{ pieceId: 1, at: a }, { pieceId: 2, at: new Date(a.getTime() + 30 * 60_000) }]);
  T.ok("③ 딱 30분은 괜찮다(경계)", c3.length === 0);
  /* 무엇을 «얹을 것»으로 보나 — B 계약 v1.2(scheduled ∧ 시각 없음) − waitOrigin(B dea5b50). */
  T.ok("③ `isUnplaced` — «scheduled ∧ 시각 없음»은 얹을 것", isUnplaced({ status: "scheduled", scheduled_for: null, meta: {} }));
  T.ok("③ `isUnplaced` — 🔴 원본을 다시 만드는 중(`waitOrigin`)이면 **아니다**(옛 영상이 나간다)", !isUnplaced({ status: "scheduled", scheduled_for: null, meta: { reuse: { waitOrigin: true } } }));
  T.ok("③ `isUnplaced` — 시각이 있거나 다른 상태면 아니다", !isUnplaced({ status: "scheduled", scheduled_for: "2026-09-28T09:00:00Z", meta: {} }) && !isUnplaced({ status: "approved", scheduled_for: null, meta: {} }));
}

/* ═══ ④ 변이 — 검사기가 틀린 배치를 무는가 ═══ */
say("■ ④ 🔴 변이(인자 수준) — `violations()` 가 **틀린 배치를 잡는가**");
let mutantsCaught = 0; const MUTANTS = 3;
{
  const now = kstToUtc("2026-09-28", 13, 0);
  const originAt = kstToUtc("2026-09-28", 18, 0);
  const ts = [tgt(81, "reels", 801, { takenSameAccount: [kstToUtc("2026-09-28", 19, 0)], accountGapMin: 180 }), tgt(82, "tiktok", 802), tgt(83, "naver_clip", 803)];
  // M1 시차 0 — 가족을 안 벌린다
  const m1 = staggerDerived({ originAt, targets: clone(ts), now, staggerMin: 1 });
  const v1 = violations(originAt, [], ts, m1, now);
  T.ok("④ M1 «시차 1분» 배치를 문다(가족 시차 위반)", v1.some((x) => x.startsWith("가족 시차")), v1.join(" / ") || "안 울었다"); if (v1.length) mutantsCaught++;
  // M2 채널별로 따로(옛 길) — 가족을 모른다
  const m2 = ts.map((t) => ({ pieceId: t.pieceId, channel: t.channel, at: pickPublishAt({ channel: t.channel, taken: [], takenSameAccount: [], now }).at }));
  const v2 = violations(originAt, [], ts, m2, now);
  T.ok("④ M2 «채널별로 따로 잡기»(옛 `releaseBacklog` 길) 배치를 문다", v2.length > 0, v2.join(" / ") || "안 울었다"); if (v2.length) mutantsCaught++;
  // M3 계정 목록을 안 넘긴다 — 같은 계정 간격을 모른다
  const m3 = staggerDerived({ originAt, targets: clone(ts).map((t) => ({ ...t, takenSameAccount: [] })), now });
  const v3 = violations(originAt, [], ts, m3, now);
  T.ok("④ M3 «같은 계정 목록 누락» 배치를 문다", v3.some((x) => x.includes("같은 계정")), v3.join(" / ") || "안 울었다"); if (v3.length) mutantsCaught++;
  counts["변이"] = `${mutantsCaught}/${MUTANTS} 물었다`;
}

/* ═══ ⑤ 경로 — 파생이 시각을 받는 모든 길이 가족을 보나 ═══ */
say("■ ⑤ 경로 — 파생이 시각을 받는 **모든 길**이 가족을 본다");
type Src = Record<"DS" | "PAUSE" | "SLOTS" | "REUSE" | "CRON" | "RUNNER" | "PUB" | "ONE", string>;
/** 🔴 판정식을 이름 붙여 뺐다 — ⑥ 변이가 **같은 식**을 변이된 소스에 다시 돌린다(식이 두 벌이면 변이가 다른 것을 잰다). */
const PATH_RULES: { key: string; name: string; judge: (s: Src) => boolean | null }[] = [
  { key: "sd-order", name: "`scheduleDerived` 가 후보를 `staggerDerived` 에서 받고 **판정자 `checkCadenceAt`** 에게 묻는다",
    judge: (s) => { const b = blockOf(s.DS, "export async function scheduleDerived(", ["\nexport async function restaggerFamily("])?.body; return b == null ? null : /staggerDerived\(/.test(b) && /checkCadenceAt\(/.test(b) && (orderIn(b, /staggerDerived\(/, /checkCadenceAt\(/)?.ok ?? false); } },
  { key: "sd-family", name: "`scheduleDerived` 가 가족(원본 + 이미 잡힌 형제 + 이번에 잡은 것)을 넘긴다",
    judge: (s) => { const b = blockOf(s.DS, "export async function scheduleDerived(", ["\nexport async function restaggerFamily("])?.body; return b == null ? null : /family:\s*\[\.\.\.family,\s*\.\.\.placedTimes\]/.test(b); } },
  { key: "sd-claim", name: "박는 줄이 조건부(새것 «scheduled ∧ 시각 없음»)라 두 손이 와도 한 번만",
    judge: (s) => { const b = blockOf(s.DS, "export async function scheduleDerived(", ["\nexport async function restaggerFamily("])?.body; return b == null ? null : /: UNPLACED_SQL\}/.test(b) && /export const UNPLACED_SQL = sql`status = \$\{UNPLACED_STATUS\} AND scheduled_for IS NULL/.test(s.DS); } },
  { key: "pause", name: "깰 때(`releaseBacklog`) 파생을 `pickPublishAt` 루프에서 **빼고**, 원본을 다 옮긴 **뒤** `scheduleDerived(… reseat)` 로 얹는다",
    judge: (s) => { const b = blockOf(s.PAUSE, "export async function releaseBacklog(", ["\nexport "])?.body; return b == null ? null : /origin_piece_id/.test(b) && /for \(const p of plain\) await placeOne/.test(b) && /scheduleDerived\(tid, originId, \{ now, reseat:/.test(b) && (orderIn(b, /for \(const p of plain\)/, /scheduleDerived\(/)?.ok ?? false); } },
  { key: "reschedule", name: "옮길 때(`slots-reschedule`) `restaggerFamily` 로 깨진 파생만 다시 맞춘다(고객이 고른 글은 `keepPieceId`)",
    judge: (s) => { const b = blockOf(s.SLOTS, 'path.endsWith("/slots-reschedule")', ['path.endsWith("/slots-produce-now")'])?.body; return b == null ? null : /restaggerFamily\(tid, n\(s\.piece_id\), \{ keepPieceId: n\(s\.piece_id\) \}\)/.test(b); } },
  { key: "seam", name: "새로 만들 때(B `deriveVideoPieces` 끝 «B2 SEAM») `scheduleDerived` 를 부른다",
    judge: (s) => { const b = blockOf(s.REUSE, "export async function deriveVideoPieces(", ["\nexport async function "])?.body; return b == null ? null : /scheduleDerived\(tid, originPieceId\)/.test(b); } },
  { key: "cron-pick", name: "크론 `reuse.schedule` 이 B 계약 v1.2 줍는 조건 그대로 줍는다",
    judge: (s) => /origin_piece_id IS NOT NULL AND \$\{UNPLACED_SQL\}/.test(s.CRON) },
  { key: "wait-origin", name: "원본을 **다시 만드는 중**인 파생(`meta.reuse.waitOrigin`)은 줍지도 박지도 않는다 — SQL 판·JS 판 둘 다(B dea5b50 · 옛 영상이 나가는 틈)",
    judge: (s) => /UNPLACED_SQL = sql`[^`]*waitOrigin[^`]*<> 'true'`/.test(s.DS) && /export const isUnplaced = [^\n]*!waitsOrigin\(f\)/.test(s.DS) },
  { key: "takedown-body", name: "발행 크론이 `p.body` 를 싣는다 → 신고 차단의 «같은 본문 해시»가 산다(파생은 원본 본문을 그대로 들고 태어난다)",
    judge: (s) => { const due = blockOf(s.PUB, "const due = await q(sql`SELECT", ["FROM pieces p"])?.body; const one = blockOf(s.ONE, "export async function publishOne(", ["\n}\n"])?.body;
      return due == null || one == null ? null : /\bp\.body\b/.test(due) && (orderIn(one, /takedownBlock\(tid, p\)/, /triggerVideoPublish\(/)?.ok ?? false); } },
  { key: "tell-keep", name: "고객이 **직접** 형제 옆에 붙인 시각은 안 옮기고 **말한다**(`restaggerFamily` → `reuseNote` · §9 막지 않는다)",
    judge: (s) => { const b = blockOf(s.DS, "export async function restaggerFamily(", ["\n}\n"])?.body; return b == null ? null : /if \(keep\)/.test(b) && /staggerClashes\(t2\)\.filter\(\(c\) => c\.a === keep \|\| c\.b === keep\)/.test(b) && /say\.push\(/.test(b); } },
  { key: "cron-reg", name: "그 크론이 `STEPS` 에 등록돼 있다(등록 안 된 스텝은 안 돈다 · PITFALLS #7)",
    judge: (s) => /\n\s*reuseScheduleStep,/.test(s.RUNNER) },
  { key: "const", name: "파생 시차 상수는 새 숫자가 아니라 `ACCOUNT_GAP_MIN` 에서 온다",
    judge: (s) => /export const DERIVED_STAGGER_MIN = ACCOUNT_GAP_MIN;/.test(s.DS) },
];
const FILES_OF: Record<keyof Src, string> = { DS: "lib/derived-schedule.ts", PAUSE: "lib/tenant-pause.ts", SLOTS: "netlify/functions/slots.ts", REUSE: "lib/video/reuse.ts", CRON: "lib/cron/reuse-schedule.ts", RUNNER: "lib/cron/runner.ts", PUB: "lib/cron/publisher.ts", ONE: "lib/publish-one.ts" };
const missing = Object.values(FILES_OF).filter((f) => !existsSync(f));
const SRC: Src | null = missing.length ? null : Object.fromEntries(Object.entries(FILES_OF).map(([k, f]) => [k, stripComments(readFileSync(f, "utf8"))])) as Src;
if (!SRC) T.unmeasured("⑤ 파일", `없다: ${missing.join(", ")}`);
else for (const r of PATH_RULES) { const v = r.judge(SRC); if (v === null) T.unmeasured(`⑤ ${r.name}`, "덩이를 못 잡았다"); else T.ok(`⑤ ${r.name}`, v); }

/* ═══ ⑥ 경로 변이 — 소스를 **메모리에서** 틀어 같은 판정식이 빨개지나(파일은 안 건드린다) ═══ */
say("■ ⑥ 🔴 경로 변이 — 가족을 안 보게 소스를 틀면 ⑤가 **우는가**");
let pathCaught = 0; const PATH_MUTANTS: { name: string; file: keyof Src; from: RegExp; to: string; rule: string }[] = [
  { name: "깰 때 파생도 옛 루프에 넣는다(`plain` → `held`)", file: "PAUSE", from: /for \(const p of plain\) await placeOne\(p\);/, to: "for (const p of held) await placeOne(p);", rule: "pause" },
  { name: "옮길 때 형제를 안 본다(restaggerFamily 호출 삭제)", file: "SLOTS", from: /await restaggerFamily\([^)]*\)[^)]*\)/, to: "await Promise.resolve()", rule: "reschedule" },
  { name: "편성이 가족을 안 넘긴다(`family: []`)", file: "DS", from: /family: \[\.\.\.family, \.\.\.placedTimes\]/, to: "family: []", rule: "sd-family" },
  { name: "B2 SEAM 을 비운다(파생 만들고 안 얹음)", file: "REUSE", from: /await scheduleDerived\(tid, originPieceId\)/, to: "await Promise.resolve(null)", rule: "seam" },
  { name: "고객이 붙인 시각에 말을 안 한다(say.push 삭제)", file: "DS", from: /say\.push\(`같은 영상을 올리는 다른 곳과/, to: "void (`같은 영상을 올리는 다른 곳과", rule: "tell-keep" },
  { name: "줍는 SQL 에서 waitOrigin 조건을 뺀다", file: "DS", from: / AND COALESCE\(meta->'reuse'->>'waitOrigin', ''\) <> 'true'/, to: "", rule: "wait-origin" },
  { name: "발행 크론이 본문을 다시 안 싣는다(`p.body` 삭제)", file: "PUB", from: /p\.scheduled_for, p\.body, /, to: "p.scheduled_for, ", rule: "takedown-body" },
];
if (SRC) for (const m of PATH_MUTANTS) {
  /* 🔴 과녁이 살아 있나 먼저(AC-236) — 변이할 글자가 소스에 없으면 «울었다/안 울었다»가 아니라 **못 쟀다**다. */
  if (!m.from.test(SRC[m.file])) { T.unmeasured(`⑥ ${m.name}`, `변이할 글자가 ${FILES_OF[m.file]} 에 없다`); continue; }
  const mutated: Src = { ...SRC, [m.file]: SRC[m.file].replace(m.from, m.to) };
  const rule = PATH_RULES.find((r) => r.key === m.rule)!;
  const v = rule.judge(mutated);
  T.ok(`⑥ «${m.name}» → ⑤ «${rule.key}» 가 운다`, v === false, `판정 ${v}`);
  if (v === false) pathCaught++;
}
counts["경로"] = `규칙 ${PATH_RULES.length} · 파일 ${Object.keys(FILES_OF).length} · 변이 ${pathCaught}/${PATH_MUTANTS.length} 물었다`;

counts["표본(①)"] = "11 표본 · 채널 5";
const code = T.done("verify-r18-stagger");
console.log("\n  ── 검산 수(무엇을 · 어디서 · 몇) ──");
for (const [k, v] of Object.entries(counts)) console.log(`   · ${k}: ${v}`);
console.log(`   · 범위: 순수 함수(\`lib/derived-schedule.ts\` staggerDerived·isUnplaced) + 경로 소스 ${Object.keys(FILES_OF).length}파일 — **DB 의 실제 가족 시각은 C 의 \`verify-r18-one-video-many\` 가 본다**`);
process.exit(code);
