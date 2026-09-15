/**
 * scripts/stock-cost-effect.mts — 「스톡으로 가져오면 **편당 원가가 얼마가 되나**」(계약 P1R8 §10.4 B-1 몫 «효과를 숫자로»).
 *   실행: `npx --yes tsx scripts/stock-cost-effect.mts`   · DB·네트워크·AI 호출 **0**.
 *
 *   ══ 🔴 왜 손으로 적지 않고 돌리나 ══
 *     사진 수를 **문서에 베껴 적으면** 계약이 바뀔 때 이 표만 옛날 값으로 남는다(AC-59 «주석이 코드보다 앞서 나간다»).
 *     그래서 사진 수는 `lib/writing-contracts.ts` 에서 **직접 읽는다** — 계약이 바뀌면 이 표도 같이 바뀐다.
 *
 *   ══ 단가의 출처(전부 라이브 `ai_usage` 실측 · 2026-09-15 메인) ══
 *     · 사진 1장 $0.046317  = $0.8337 ÷ 18장   (₩64.8)
 *     · 글 1편   $0.0494    = $0.1482 ÷ 3편     (₩69.2 · 🔴 **재작성 2회 포함**한 값이다 — 3편 모두 재작성에 걸렸다)
 *     · 환율 1,400(`FX_USD_KRW` 기준값)
 *     🔴 «추정»이 아니라 **실측**이다. 다만 표본이 3편이라 정확도는 그만큼이다.
 */
import { WRITING_CONTRACTS, imagesFor, type TopicGroup } from "../lib/writing-contracts";
import { COIN_TABLE } from "../lib/coin-table";

/* ── 실측 단가 ─────────────────────────────────────────────────────────── */
const FX = Number(process.env.FX_USD_KRW || "1400");
const USD_PER_IMAGE = 0.8337 / 18;
const USD_PER_TEXT = 0.1482 / 3;          /* 재작성 2회 포함(지금 재작성률 100%) */
const USD_PER_TEXT_ONE_CALL = USD_PER_TEXT / 2;   /* 첫 판이 통과했을 때(§10.5 목표) */
const won = (usd: number) => Math.round(usd * FX);

const GROUPS: TopicGroup[] = ["review", "info", "life"];

const rows: { channel: string; group: string; imgs: number; nowWon: number; after1: number; after2: number; coins: number; swappable: boolean }[] = [];
for (const [channel, c] of Object.entries(WRITING_CONTRACTS)) {
  for (const g of GROUPS) {
    const imgs = imagesFor(c, g).default;
    /* 🔴 영상 채널은 이 표의 대상이 아니다 — 사진 0장이고 원가가 영상 provider 쪽에서 난다(여기 넣으면 «글 ₩69» 만 찍혀 거짓말이 된다). */
    if (imgs === 0) continue;
    const text = USD_PER_TEXT;
    const now = won(text + imgs * USD_PER_IMAGE);
    const after = (keep: number) => won(text + Math.min(keep, imgs) * USD_PER_IMAGE);
    /* 지금 받는 코인 = 글 1 + 사진 장당 1(`lib/director.ts` 실측 · `coin_ledger` 의 `piece:N:imgK`). */
    const coins = COIN_TABLE.blog + imgs * COIN_TABLE.image;
    /* 🔴 글자가 얹힌 그림(infographic·카드뉴스)은 스톡 사진이 대신할 수 없다 — 표 **안에서** 말한다(각주로만 말하면 표가 거짓말을 한다). */
    const swappable = c.images.style !== "infographic";
    rows.push({ channel, group: g, imgs, nowWon: now, after1: after(1), after2: after(2), coins, swappable });
  }
}

const w = (x: unknown, n: number) => String(x ?? "").padEnd(n);
const r = (x: unknown, n: number) => String(x ?? "").padStart(n);
console.log(`\n스톡으로 바꾸면 편당 원가가 얼마가 되나 (글 채널만 · FX ${FX} · 단가는 라이브 ai_usage 실측) · ${new Date().toISOString()}`);
console.log("─".repeat(106));
console.log(`${w("채널", 14)}${w("주제군", 8)}${r("사진", 5)}${r("지금", 9)}${r("AI 1장", 9)}${r("AI 2장", 9)}${r("줄어드는 폭", 13)}${r("받는 코인", 10)}${r("코인 수입", 11)}`);
console.log("─".repeat(106));
for (const x of rows) {
  const cut = Math.round((1 - x.after1 / x.nowWon) * 100);
  const a1 = x.swappable ? "₩" + x.after1 : "—";
  const a2 = x.swappable ? "₩" + x.after2 : "—";
  const cutCol = x.swappable ? `-${cut}%` : "못 바꿈(그림)";
  console.log(`${w(x.channel, 14)}${w(x.group, 8)}${r(x.imgs, 5)}${r("₩" + x.nowWon, 9)}${r(a1, 9)}${r(a2, 9)}${r(cutCol, 13)}${r(x.coins, 10)}${r("₩" + (x.coins * 500).toLocaleString(), 11)}`);
}
console.log("─".repeat(106));

/* ── 사장님이 물으신 그 숫자 ────────────────────────────────────────────── */
const nb = imagesFor(WRITING_CONTRACTS.naver_blog, null).default;
const nowNb = won(USD_PER_TEXT + nb * USD_PER_IMAGE);
const afterNb = won(USD_PER_TEXT + 1 * USD_PER_IMAGE);
const afterNbNoRewrite = won(USD_PER_TEXT_ONE_CALL + 1 * USD_PER_IMAGE);
console.log(`\n🔴 §10 이 말한 그 편(네이버 · 사진 ${nb}장): **₩${nowNb} → ₩${afterNb}**(-${Math.round((1 - afterNb / nowNb) * 100)}%)`);
console.log(`   여기에 §10.5(«첫 판이 통과하게» · 지금 재작성률 100%)까지 되면 **₩${afterNbNoRewrite}**(-${Math.round((1 - afterNbNoRewrite / nowNb) * 100)}%)`);
console.log(`   받는 것은 그대로 ${COIN_TABLE.blog + nb * COIN_TABLE.image}코인 = ₩${((COIN_TABLE.blog + nb * COIN_TABLE.image) * 500).toLocaleString()} ⇒ 마진 ${(((COIN_TABLE.blog + nb * COIN_TABLE.image) * 500) / afterNb).toFixed(1)}배(지금 ${(((COIN_TABLE.blog + nb * COIN_TABLE.image) * 500) / nowNb).toFixed(1)}배)`);

console.log(`\n🔴 이 표가 **말하지 않는 것**(정직)`);
console.log(`   · 인스타(infographic ${imagesFor(WRITING_CONTRACTS.instagram, null).default}장)는 **스톡으로 못 바꾼다** — 글자가 얹힌 그림이라 스톡 사진이 대신할 수 없다.`);
console.log(`     ⇒ 카드뉴스는 이 절감의 바깥이다. §2.5 를 할 때 따로 봐야 한다.`);
console.log(`   · 스톡은 AI 값이 0 이지만 **R2 저장·전송은 든다**(사진 1장 수백 KB). 작아서 안 셌지 «0원»이라서 안 센 게 아니다.`);
console.log(`   · «스톡 사진이 글을 약하게 하나»는 **못 쟀다** — 네이버 공식 문서를 우리 도구가 못 읽는다(체크리스트 13번 · B3 조사 §2 «추정»).`);
console.log(`   · 🔴 **코인 값은 이 표가 정하지 않는다.** 원가가 내려가면 편수를 늘릴 여지가 생길 뿐이고, 최종 숫자는 사장님 몫이다(§10.4).`);
