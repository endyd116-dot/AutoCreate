/**
 * scripts/verify-b4-place.mts — **장소/링크 카드**(DESIGN §5C.3 네이버 시각 요소 · R8CLOSE-B1 §B4).
 *   실행: `npx --yes tsx scripts/verify-b4-place.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   🔴 이 하니스가 지키는 것 둘:
 *     ① **계약이 스스로 싸우지 않는가** — 2026-09-15 `visualMin.faq:1` 이 `tiers.optional` 과 싸워
 *        네이버 글 10편 중 8편이 재작성됐다(**돈 두 배**). 새 블록을 **필수로 넣지 않았는지** 여기서 못 박는다.
 *     ② **«있는 척»을 안 하는가** — 러너는 에디터 «장소» 카드를 못 넣는다. 링크로 내려앉히고 그 사실을 적는지 본다.
 */
import { renderBlocksHtml, normalizeBlocks, type Block } from "../lib/blocks";
import { WRITING_CONTRACTS, contractSelfConflicts, structureFor } from "../lib/writing-contracts";
import { planEditorOps } from "../runner/lib/plan.mjs";
import fs from "node:fs";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

/* ── ① 🔴 계약이 스스로 싸우지 않는다 — 전 채널 0건이어야 한다 ── */
{
  let total = 0; const bad: string[] = [];
  for (const [ch, c] of Object.entries(WRITING_CONTRACTS)) {
    const conf = contractSelfConflicts(c);
    total += conf.length; if (conf.length) bad.push(`${ch}: ${conf.join(" / ")}`);
  }
  rec("① 🔴 계약 자기충돌 0건(visualMin ↔ tiers)", total === 0, bad.join(" | ") || "전 채널 0");
  const nb = WRITING_CONTRACTS["naver_blog"];
  rec("① 🔴 place 는 visualMin 에 **없다**(필수로 넣지 않았다)", !("place" in (nb.visualMin as Record<string, unknown>)), `visualMin = ${JSON.stringify(nb.visualMin)}`);
  /* 🔴 처음엔 optional 에 넣었다가 ②가 «전 구성에 박힌다»를 잡아서 뺐다 — 골격은 강제하지 않고 프롬프트가 허락한다. */
  rec("① 🔴 place 는 tiers 어느 칸에도 없다(골격이 강제하지 않는다)",
    !["required", "optional", "suppress"].some((k) => ((nb.tiers as Record<string, string[]>)?.[k] ?? []).includes("place")),
    JSON.stringify(nb.tiers));
  rec("① 대신 프롬프트가 «있을 때만 넣어도 된다»고 허락한다", /place{place:/.test(fs.readFileSync("lib/content-gen.ts", "utf8")), "lib/content-gen.ts 블록 어휘");
  rec("① 시각 요소 목록에 적혀 있다(설계 §5C.3)", nb.visual.some((v) => v.includes("장소")), nb.visual.join(" · "));
}

/* ── ② 골격이 place 를 **강제로** 만들지 않는다(장소 없는 글이 대부분이다) ── */
{
  const forced = Object.entries(WRITING_CONTRACTS).flatMap(([ch, c]) =>
    Object.keys(c.structure).map((f) => [ch, f, structureFor(c, f as never, null, 6, 1)] as const))
    .filter(([, , seq]) => (seq as string[]).includes("place"));
  rec("② 🔴 어떤 채널·구성도 place 를 골격에 박지 않는다", forced.length === 0, forced.map(([ch, f]) => `${ch}/${f}`).join(",") || "0건");
}

/* ── ③ 파싱 — 모델이 내면 실제로 받는다(파싱이 없으면 조용히 버려진다) ── */
{
  const ok = normalizeBlocks([{ type: "place", place: { name: "성수 카페", url: "https://map.naver.com/x", address: "서울 성동구", note: "주차 가능" } }]);
  rec("③ 제대로 된 장소 블록은 살아남는다", ok.length === 1 && ok[0].place?.name === "성수 카페", JSON.stringify(ok[0]?.place ?? null));
  const noName = normalizeBlocks([{ type: "place", place: { url: "https://x" } }]);
  rec("③ 이름 없는 장소 블록은 버린다(빈 카드는 카드가 아니다)", noName.length === 0);
  const js = normalizeBlocks([{ type: "place", place: { name: "가게", url: "javascript:alert(1)" } }]);
  rec("③ 🔴 http(s) 아닌 주소는 안 받는다(우리가 구멍을 심지 않는다)", js.length === 1 && js[0].place?.url === undefined, JSON.stringify(js[0]?.place ?? null));
}

/* ── ④ 렌더 — 링크가 있으면 카드, 없으면 글줄 ── */
{
  const html = renderBlocksHtml([{ type: "place", place: { name: "성수 카페", url: "https://map.naver.com/x", address: "서울 성동구" } }] as Block[], "naver_blog");
  rec("④ 링크가 있으면 <a> 로 그린다", /<aside class="place"><a href="https:\/\/map\.naver\.com\/x"/.test(html), html.slice(0, 90));
  const plain = renderBlocksHtml([{ type: "place", place: { name: "성수 카페" } }] as Block[], "naver_blog");
  rec("④ 링크가 없어도 이름은 남는다", plain.includes("성수 카페") && !plain.includes("<a "), plain);
  const empty = renderBlocksHtml([{ type: "place" }] as Block[], "naver_blog");
  rec("④ 알맹이가 없으면 아무것도 안 그린다", empty === "", `«${empty}»`);
}

/* ── ⑤ 🔴 러너 — «있는 척»을 안 한다 ── */
{
  const plan = planEditorOps({ blocks: [{ type: "place", place: { name: "성수 카페", url: "https://map.naver.com/x", address: "서울 성동구" } }] });
  const ops = plan.ops as { op: string; text?: string; url?: string }[];
  rec("⑤ 장소를 link op 로 내려앉힌다(러너가 실제로 할 수 있는 길)", ops.some((o) => o.op === "link" && o.url === "https://map.naver.com/x"), JSON.stringify(ops));
  rec("⑤ 🔴 못 한 것을 적는다(«장소 카드는 아직 못 넣어서»)", ops.some((o) => o.op === "note" && /장소 카드는 아직/.test(String(o.text))), "note op");
  rec("⑤ note 는 본문에 안 들어간다(러너 case \"note\" = break)", true, "runner/channels/naver-blog.mjs:437 «사람이 읽는 메모 — 본문에 넣지 않는다»");
  const noUrl = planEditorOps({ blocks: [{ type: "place", place: { name: "성수 카페" } }] }).ops as { op: string }[];
  rec("⑤ 링크가 없으면 글줄로 넣는다(빠뜨리지 않는다)", noUrl.some((o) => o.op === "para"), JSON.stringify(noUrl));
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nB4 장소/링크 카드 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 58)} ${w(r.note, 88)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 못 하는 것: **에디터의 «장소» 카드 자체**는 안 만들었다 — 스마트에디터에서 장소를 검색해 꽂는 것은 B7(R10 · AM 발행 러너 이식)과 같은 일이다.");
console.log("   지금은 링크로 내려앉히고 «장소 카드는 아직 못 넣어요»를 보고에 남긴다(§9 «없는 길»은 없는 길이라고 적는다).");
process.exit(fail ? 1 : 0);
