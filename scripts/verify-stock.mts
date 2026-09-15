/**
 * scripts/verify-stock.mts — 스톡 사진 조달(`lib/stock/**`)을 **돌려 본다**(계약 P1R8 §10 · B-1 2026-09-15).
 *   실행: `npx --yes tsx scripts/verify-stock.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   ══ 🔴 이 하니스가 정직하게 말하는 한계 ══
 *     **우리 키가 아직 없어 제공사를 실제로 불러 본 적이 없다.** 그래서 «응답 모양이 정말 이런가»는 **못 쟀다**(AC-9).
 *     여기서 쓰는 응답은 공식 문서(https://pixabay.com/api/docs/ · https://www.pexels.com/api/documentation/)에 실린
 *     **예시 응답을 그대로 옮긴 고정 표본**이다. 필드 이름이 문서와 다르면 잡히지만, 문서가 실물과 다르면 못 잡는다.
 *     ⇒ 키가 꽂히면 **첫 호출 1건**으로 이 표본을 실제 응답으로 갈아야 한다(그때까지 «실증»이라 부르지 않는다 · CLAUDE §6).
 *
 *   ══ 음성 대조를 반드시 같이 돈다 ══
 *     «전부 통과»만 찍고 실은 아무것도 안 보는 검사가 제일 나쁘다(AC-58). 그래서 **걸려야 하는 것**을 같이 넣는다:
 *     남의 호스트 · http · 도메인 흉내 · «모름»이 «없음»으로 바뀌지 않는가 · **순서를 바꾸지는 않는가**(사장님 지시의 회귀 방어선).
 */
import { hostAllowed } from "../lib/stock/types";
import { parsePixabayBody, PIXABAY_IMAGE_HOSTS } from "../lib/stock/pixabay";
import { parsePexelsBody, PEXELS_IMAGE_HOSTS } from "../lib/stock/pexels";
import { markStockPicks, toStockMeta, stockTroubleLine, searchStock } from "../lib/stock";
import { creditLineOf, isSourceKey, stockSourceKey } from "../lib/photo-source";
import { emptyMix, heroIndexOf, stockQueryOf, takeCandidate } from "../lib/stock/plan";
import type { StockCandidate } from "../lib/stock/types";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

/* ═══ ① 공식 문서의 예시 응답 → 후보 매핑 ═══════════════════════════════════════ */

/** Pixabay 문서 예시 응답(필드 이름 그대로). */
const PIXABAY_SAMPLE = {
  total: 4692, totalHits: 500,
  hits: [{
    id: 195893, pageURL: "https://pixabay.com/en/blossom-bloom-flower-195893/", type: "photo",
    tags: "blossom, bloom, flower",
    previewURL: "https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg",
    webformatURL: "https://pixabay.com/get/35bbf209e13e39d2_640.jpg",
    largeImageURL: "https://pixabay.com/get/ed6a99fd0a76647_1280.jpg",
    imageWidth: 4000, imageHeight: 2250, user: "Josch13",
  }],
};
{
  const [c] = parsePixabayBody(PIXABAY_SAMPLE);
  const ok = !!c && c.provider === "pixabay" && c.id === "195893"
    && c.downloadUrl === PIXABAY_SAMPLE.hits[0].largeImageURL
    && c.previewUrl === PIXABAY_SAMPLE.hits[0].previewURL
    && c.author === "Josch13" && c.sourceUrl === PIXABAY_SAMPLE.hits[0].pageURL
    && c.width === 4000 && c.height === 2250
    && c.tags.join("|") === "blossom|bloom|flower";
  rec("① Pixabay 예시 응답 → 후보(문서 필드 이름 그대로)", ok,
    ok ? `id=${c.id} 작가=${c.author} 태그 ${c.tags.length}개` : `매핑이 틀렸다: ${JSON.stringify(c)?.slice(0, 200)}`);
  rec("① 🔴 Pixabay 는 people·brand 를 안 준다 → 둘 다 null(«모름»)", c?.people === null && c?.brand === null,
    `people=${String(c?.people)} brand=${String(c?.brand)} — false 가 나오면 짐작한 것이다(AC-57)`);
}

/** Pexels 문서 예시 응답(필드 이름 그대로). */
const PEXELS_SAMPLE = {
  total_results: 10000, page: 1, per_page: 1,
  photos: [{
    id: 3573351, width: 3066, height: 3968, url: "https://www.pexels.com/photo/trees-during-day-3573351/",
    photographer: "Lukas Rodriguez", photographer_url: "https://www.pexels.com/@lukas-rodriguez-1845331",
    src: {
      original: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png",
      large2x: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&w=1880",
      large: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&w=940",
      medium: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&h=350",
      small: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&h=130",
      tiny: "https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&w=280",
    },
    alt: "Brown Rocks During Golden Hour",
  }],
};
{
  const [c] = parsePexelsBody(PEXELS_SAMPLE);
  const ok = !!c && c.provider === "pexels" && c.id === "3573351"
    && c.downloadUrl === PEXELS_SAMPLE.photos[0].src.large2x
    && c.author === "Lukas Rodriguez" && c.sourceUrl === PEXELS_SAMPLE.photos[0].url
    && c.alt === "Brown Rocks During Golden Hour";
  rec("① Pexels 예시 응답 → 후보(문서 필드 이름 그대로)", ok,
    ok ? `id=${c.id} 작가=${c.author}` : `매핑이 틀렸다: ${JSON.stringify(c)?.slice(0, 200)}`);
  /* 🔴 원본(original)을 고르면 안 된다 — 수 MB 라 4MB 상한에 걸려 «찾기는 되는데 붙이기가 안 되는» 기능이 된다. */
  rec("① 🔴 원본이 아니라 large2x 를 고른다(4MB 상한)", c?.downloadUrl !== PEXELS_SAMPLE.photos[0].src.original,
    `고른 것 = ${c?.downloadUrl?.includes("w=1880") ? "large2x" : c?.downloadUrl?.slice(0, 60)}`);
}

/* ═══ ② 🔴 호스트 자물쇠 — 여기가 뚫리면 «긁어 오기»를 우리 손으로 열어 주는 셈이다 ═══ */
{
  const good = [
    ["https://pixabay.com/get/x_1280.jpg", PIXABAY_IMAGE_HOSTS],
    ["https://cdn.pixabay.com/photo/a.jpg", PIXABAY_IMAGE_HOSTS],
    ["https://images.pexels.com/photos/1/a.png", PEXELS_IMAGE_HOSTS],
  ] as const;
  const okGood = good.every(([u, h]) => hostAllowed(u, h));
  rec("② 제공사 호스트는 통과한다", okGood, okGood ? `${good.length}개 통과` : "제공사 주소를 막고 있다(기능이 아예 안 된다)");

  /* 🔴 음성 대조 — 전부 **막혀야** 한다. */
  const bad: [string, readonly string[], string][] = [
    ["https://evil.com/a.jpg", PIXABAY_IMAGE_HOSTS, "남의 호스트"],
    ["https://evil-pixabay.com/a.jpg", PIXABAY_IMAGE_HOSTS, "이름만 비슷한 도메인(endsWith 만 쓰면 뚫린다)"],
    ["https://pixabay.com.attacker.net/a.jpg", PIXABAY_IMAGE_HOSTS, "접두로 흉내 낸 도메인"],
    ["http://pixabay.com/a.jpg", PIXABAY_IMAGE_HOSTS, "http(중간에서 갈아치울 수 있다)"],
    ["https://images.pexels.com/a.png", PIXABAY_IMAGE_HOSTS, "제공사가 뒤바뀐 주소(크레딧이 엉뚱한 곳을 가리킨다)"],
    ["http://169.254.169.254/latest/meta-data/", PIXABAY_IMAGE_HOSTS, "내부 주소(우리 서버가 대신 열어 주는 통로)"],
    ["not-a-url", PIXABAY_IMAGE_HOSTS, "주소가 아닌 값"],
  ];
  const leaked = bad.filter(([u, h]) => hostAllowed(u, h));
  rec("② 🔴 음성 대조 — 남의 주소·흉내 도메인·http·내부 주소는 전부 막힌다", leaked.length === 0,
    leaked.length ? `🔴 뚫렸다: ${leaked.map(([u, , why]) => `${why}(${u})`).join(" · ")}` : `${bad.length}종 전부 막았다`);
}

/* ═══ ③ 판정 — 🔴 **거르지도 미루지도 않는가**(사장님 지시 2026-09-15) ═══════════════ */
const cand = (id: string, tags: string[]): StockCandidate => ({
  provider: "pixabay", id, downloadUrl: `https://pixabay.com/get/${id}.jpg`, previewUrl: `https://cdn.pixabay.com/${id}.jpg`,
  width: 800, height: 600, author: "someone", sourceUrl: `https://pixabay.com/photo-${id}/`,
  licenseUrl: "https://pixabay.com/service/license-summary/", people: null, brand: null, tags, alt: null,
});
const POOL = [cand("a", ["logo", "storefront"]), cand("b", ["woman", "portrait"]), cand("c", ["mountain", "sky"])];
{
  /* 정보성 글 — 사람·상표 조항은 «상업적 사용»을 전제하므로 전부 통과해야 한다. */
  const info = markStockPicks(POOL, false);
  rec("③ 정보성 글에서는 판정이 전부 통과(조항이 «상업적 사용» 전제)", info.length === 3 && info.every((p) => p.verdict.ok),
    `${info.filter((p) => p.verdict.ok).length}/3 통과`);

  const paid = markStockPicks(POOL, true);
  rec("③ 🔴 광고성 글에서도 **한 장도 안 거른다**", paid.length === 3,
    paid.length === 3 ? "3장 그대로" : `🔴 ${3 - paid.length}장이 사라졌다 — 이건 게이트다`);
  /* 🔴 여기가 사장님 지시의 회귀 방어선이다 — 누가 «안전한 것을 위로» 정렬을 다시 넣으면 이 줄이 빨개진다.
     들어온 순서(제공사 사다리 순서)가 a·b·c 그대로여야 한다(판정이 갈려도). */
  const order = paid.map((p) => p.id).join("");
  rec("③ 🔴 사람·상표로 **순서를 바꾸지 않는다**(사장님 «무시해도 돼»)", order === "abc",
    `순서 = ${order} (기대 abc = 들어온 순서 그대로) · 판정 = ${paid.map((p) => `${p.id}:${p.verdict.code ?? "ok"}`).join(" ")}`);
  /* 🔴 순위에 안 쓴다고 **재지 않는 것이 아니다**(§9 «검사를 지우지 마라») — 판정은 계속 쌓여 저장된다. */
  rec("③ 🔴 그래도 판정은 계속 잰다 — 사유·근거 약관이 남는다(나중에 정렬만 켜면 된다)",
    paid.some((p) => !p.verdict.ok) && paid.every((p) => p.verdict.ok || (!!p.verdict.reason && !!p.verdict.law)),
    paid.map((p) => `${p.id}:${p.verdict.code ?? "ok"}`).join(" "));
}

/* ═══ ④ 기록·되짚기·크레딧 ═════════════════════════════════════════════════ */
{
  const c = POOL[1];
  const meta = toStockMeta(c);
  rec("④ 🔴 «모름»이 «없음»으로 바뀌지 않는다(AC-57)", meta.people === null && meta.brand === null,
    `people=${String(meta.people)} brand=${String(meta.brand)}`);

  const key = stockSourceKey(c.provider, c.id);
  rec("④ 되짚기 열쇠가 모양 검사를 통과한다(`piecesUsingSource` 가 이걸 받는다)", isSourceKey(key), key);

  const line = creditLineOf({ kind: "stock", key, addedAt: new Date().toISOString() }, { ...meta, id: String(meta.id) });
  rec("④ 크레딧 줄이 작가·제공사·주소를 다 담는다(Pexels «prominent link» · Pixabay «where from»)",
    !!line && line.includes("someone") && line.includes("Pixabay") && line.includes("pixabay.com/photo-b"), String(line));

  /* 🔴 음성 대조 — 내 사진·AI 사진은 크레딧 줄을 **만들면 안 된다**(없는 출처를 지어내지 않는다). */
  const mine = creditLineOf({ kind: "customer", key: "customer:sha256:" + "a".repeat(64), addedAt: "" }, null);
  rec("④ 🔴 음성 대조 — 내 사진은 크레딧 줄을 안 만든다", mine === null, `결과 = ${String(mine)}`);
}

/* ═══ ⑤ 조달 계획 — «어디서 가져올지»를 정하는 순수 함수(`lib/stock/plan.ts`) ═══════════ */
{
  /* 대표는 **첫 이미지 블록**이다 — 블록 순서가 뒤섞여 들어와도 «제일 작은 번호»여야 한다. */
  rec("⑤ 대표는 첫 이미지 블록(번호가 뒤섞여도)", heroIndexOf([3, 0, 1, 2]) === 0 && heroIndexOf([2, 5]) === 2,
    `[3,0,1,2]→${heroIndexOf([3, 0, 1, 2])} · [2,5]→${heroIndexOf([2, 5])}`);
  rec("⑤ 🔴 사진이 없으면 대표도 없다(-1) — 0 으로 접히면 0번 자리를 대표로 착각한다", heroIndexOf([]) === -1, String(heroIndexOf([])));

  /* 검색어는 **짧아야** 맞는 사진이 온다. 군더더기(총정리·추천·후기)와 연도 숫자는 뺀다. */
  const qa = stockQueryOf("에어프라이어 청소 방법 총정리 2026");
  rec("⑤ 검색어: 군더더기·숫자를 빼고 낱말 3개까지", qa === "에어프라이어 청소", `"${qa}"`);
  const qb = stockQueryOf("가을 산책하기 좋은 서울 공원 베스트 10");
  rec("⑤ 검색어: 긴 제목도 3낱말로 (긴 문장을 그대로 넣으면 0건이 된다)", qb.split(" ").length <= 3, `"${qb}"`);
  rec("⑤ 🔴 빈 제목이면 빈 검색어 — 지어내지 않는다", stockQueryOf("") === "", `"${stockQueryOf("")}"`);

  /* 같은 글에 같은 사진이 두 번 들어가면 두 번째는 «이미 있다»로 접혀 **그 자리가 빈 채 남는다**. */
  const used = new Set<string>();
  const a1 = takeCandidate(POOL, used), a2 = takeCandidate(POOL, used), a3 = takeCandidate(POOL, used), a4 = takeCandidate(POOL, used);
  rec("⑤ 🔴 같은 사진을 두 번 주지 않는다(두 번째는 그 자리를 빈 채 남긴다)",
    a1?.id === "a" && a2?.id === "b" && a3?.id === "c" && a4 === null,
    `${[a1, a2, a3].map((x) => x?.id).join("")} 그다음 ${String(a4)}`);

  const m = emptyMix();
  rec("⑤ 사진 출처 세기는 0 에서 시작한다(없는 출처를 1 로 시작하면 원장이 거짓이 된다)",
    m.ai === 0 && m.stock === 0 && m.customer === 0 && m.failed === 0, JSON.stringify(m));
}

/* ═══ ⑥ 키가 없을 때 — «0건»이 아니라 «아직 안 꽂혔다»로 말하는가 ═══════════════ */
{
  const hadPixabay = process.env.PIXABAY_API_KEY, hadPexels = process.env.PEXELS_API_KEY;
  delete process.env.PIXABAY_API_KEY; delete process.env.PEXELS_API_KEY;
  const r = await searchStock({ query: "가을 산책", paid: false });
  const allNoKey = r.tried.length === 2 && r.tried.every((t) => t.reason === "no_key");
  rec("⑥ 키가 없으면 제공사를 부르지 않고 «열쇠 없음»이라고 말한다", allNoKey && !r.ok,
    `tried = ${r.tried.map((t) => `${t.provider}:${t.reason}`).join(" ")}`);
  const line = stockTroubleLine(r.tried);
  rec("⑥ 🔴 «0건»과 «아직 안 켰다»를 갈라 말한다(CLAUDE §8 «키 꽂으면 즉시 가동»)",
    !!line && line.includes("열쇠"), String(line));
  if (hadPixabay !== undefined) process.env.PIXABAY_API_KEY = hadPixabay;
  if (hadPexels !== undefined) process.env.PEXELS_API_KEY = hadPexels;
}

/* ═══ 출력 ═══════════════════════════════════════════════════════════════ */
const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n스톡 사진 조달 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 84)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 제공사를 **실제로 불러 본 적이 없다** — 위 응답은 공식 문서의 예시다. 키가 꽂히면 첫 호출 1건으로 갈아야 «실증»이다.");
process.exit(fail ? 1 : 0);
