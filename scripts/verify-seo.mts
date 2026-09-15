/**
 * scripts/verify-seo.mts — `lib/publish/seo.ts` 를 **실제로 돌려 본다**(순수 함수 하니스 · 네트워크 0 · DB 0).
 *   사용: npx --yes tsx scripts/verify-seo.mts
 *
 *   왜 필요한가: 로마자 표(초·중·종성 3벌 × 68칸)는 **한 칸이 밀려도 조용히 그럴듯한 글자**가 나온다.
 *   «gaeul» 이 «gaeur» 이 돼도 아무 데서도 안 걸리고, 그 주소가 몇 달 뒤 카톡에 실려 나간다 —
 *   돈·날짜 파서와 같은 종류의 오류다(B2-HANDOFF §3 «오류는 소리가 안 난다»).
 *
 *   🔴 **통과해야 하는 것과 떨어져야 하는 것을 같은 수만큼 잰다**(AC-68) —
 *      «전부 통과»는 검사가 아무것도 안 보고 있다는 뜻일 수도 있다.
 */
import { excerptOf, slugOf, romanizeKo, articleJsonLd, articleJsonLdScript, jsonLdSurvived } from "../lib/publish/seo";
import type { PublishPiece } from "../lib/publish/contract";

let pass = 0; let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      받은 값: ${g}\n      기대값: ${w}`); }
};
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

const piece = (over: Partial<PublishPiece> = {}): PublishPiece => ({
  id: 1, tenantId: 1, channel: "wordpress", kind: "post", accountId: 1,
  title: "가을 이불 세탁 방법", bodyHtml: "<p>첫 문단입니다.</p>", blocks: [], images: [], tags: [],
  disclosure: null, status: "approved", ...over,
});

console.log("① 로마자 — 국어의 로마자 표기법(자음동화는 일부러 안 넣었다)");
eq("가을", romanizeKo("가을"), "gaeul");
eq("서울", romanizeKo("서울"), "seoul");
eq("한국", romanizeKo("한국"), "hanguk");
eq("김치", romanizeKo("김치"), "gimchi");
eq("이불", romanizeKo("이불"), "ibul");
eq("세탁", romanizeKo("세탁"), "setak");
/* 🔴 **알면서 다른 값** — 표준 표기는 «tteokbokki»(ㄲ 받침이 뒤 모음을 만나 겹친다)인데 우리는 «tteokboki» 를 낸다.
   자음동화를 안 넣었기 때문이고, 주소로 읽히는 데는 지장이 없다. **모르는 게 아니라 정한 것**이라 여기 못 박아 둔다 —
   나중에 누가 이 값을 보고 «버그다» 하고 고치려 들면 이 줄이 답이다. */
eq("떡볶이(자음동화 없음 · 표준은 tteokbokki)", romanizeKo("떡볶이"), "tteokboki");
eq("한글 아닌 글자는 그대로", romanizeKo("iPhone 15 리뷰"), "iPhone 15 ribyu");

console.log("② slug — 읽히는 주소(순위가 아니라 공유가 이유다)");
eq("한글 제목", slugOf(piece()), "gaeul-ibul-setak-bangbeop");
eq("영문·숫자 섞임", slugOf(piece({ title: "iPhone 15 후기 3가지" })), "iphone-15-hugi-3gaji");
eq("특수문자는 이음표로", slugOf(piece({ title: "«가을» 이불, 세탁!" })), "gaeul-ibul-setak");
eq("제목이 비면 빈 문자열(억지로 post-1 을 만들지 않는다)", slugOf(piece({ title: "  " })), "");
ok("길이 상한을 넘지 않는다", slugOf(piece({ title: "가을".repeat(40) }), 60).length <= 60);

console.log("③ excerpt — summary 블록 우선 · 고지는 빼고");
eq("summary 블록이 있으면 그것",
  excerptOf(piece({ blocks: [{ type: "para", text: "첫 문단" }, { type: "summary", text: "이 글의 요약입니다." }] as never })),
  "이 글의 요약입니다.");
eq("없으면 첫 문단",
  excerptOf(piece({ blocks: [{ type: "para", text: "첫 문단입니다." }] as never })),
  "첫 문단입니다.");
eq("블록이 아예 없으면 본문에서",
  excerptOf(piece({ bodyHtml: "<p>본문 첫 줄.</p><p>둘째 줄.</p>" })),
  "본문 첫 줄. 둘째 줄.");
/* 🔴 이게 이 절의 핵심 — 고지가 메타 설명으로 올라가면 검색 결과에 «이 글은 광고를…»만 뜬다. */
ok("고지 문장은 빠진다",
  !excerptOf(piece({
    disclosure: "이 글은 광고를 포함합니다.",
    bodyHtml: "<p>이 글은 광고를 포함합니다. 가을 이불 세탁은…</p>",
  })).includes("광고를 포함"));

console.log("④ Article JSON-LD — 살아 있는 유형만 · 없는 칸은 안 만든다");
const ld = articleJsonLd(piece({ images: [{ url: "https://r2.example/a.jpg" }] }), { authorName: "@dohyun", publishedAt: "2026-09-15T01:00:00.000Z" });
eq("@type", ld["@type"], "Article");
eq("headline = 보이는 제목", ld.headline, "가을 이불 세탁 방법");
eq("author 는 @ 를 뗀다", ld.author, { "@type": "Person", name: "dohyun" });
eq("image 는 절대 주소만", ld.image, ["https://r2.example/a.jpg"]);
const bare = articleJsonLd(piece({ images: [{ url: "/relative.jpg" }] }));
ok("상대 주소 사진은 안 싣는다(빈 배열도 안 만든다)", !("image" in bare));
ok("이름이 없으면 author 칸 자체가 없다", !("author" in bare));
/* 🔴 하면 안 되는 것 — 이 둘이 나오면 조사 결론을 거스른 것이다(둘 다 구글이 지원을 끊었다). */
const script = articleJsonLdScript(piece());
ok("FAQPage 를 만들지 않는다", !script.includes("FAQPage"));
ok("HowTo 를 만들지 않는다", !script.includes("HowTo"));
ok("</script> 를 본문이 조기 종료시키지 못한다",
  !articleJsonLdScript(piece({ title: "제목 </script><b>주입</b>" })).replace(/<\/script>$/, "").includes("</script>"));

console.log("⑤ «붙었나» 판정 — 🔴 음성 대조(통과해야 하는 것과 떨어져야 하는 것)");
ok("스크립트가 살아 있으면 true", jsonLdSurvived(`<p>글</p><script type="application/ld+json">{}</script>`));
ok("지워졌으면 false", !jsonLdSurvived("<p>글</p>"));
ok("빈 값이면 false(모른다를 «있다»로 바꾸지 않는다)", !jsonLdSurvived(undefined));

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
