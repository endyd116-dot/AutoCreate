/**
 * scripts/verify-blog-identity.mts — 🔴 «지금 내가 어느 블로그에 쓰고 있나» 판정을 잰다(AC-201 · B2 · 2026-09-21).
 *   사용: npx --yes tsx scripts/verify-blog-identity.mts        · DB 0 · 네트워크 0 · 브라우저 0(순수 함수만)
 *
 *   ══ 왜 이 자가 필요한가 ══
 *     이 판정이 틀리는 두 방향의 **값이 완전히 다르다**:
 *       · 헛된 «다르다»  → 고객에게 한 번 물어본다. 성가시지만 **되돌릴 수 있다.**
 *       · 놓친 «다르다»  → 🔴 **남의 블로그에 글이 나간다. 우리가 못 내린다**(§5E ③을 안 만들기로 했다).
 *     그래서 판정기는 **증거의 질에 따라 할 수 있는 말이 다르게** 생겼다. 그 비대칭이 살아 있는지 재는 게 이 자다.
 *
 *   ══ 재는 것 ══
 *     ① blogIdFromUrl      — 주소에서 아이디. 🔴 «이름.naver»·화면 이름은 아이디가 아니다
 *     ② pickBlogIdFromLinks — 최빈값(빈도 ≥2) · 동점은 사전순(재현 안 되는 판정 0)
 *     ③ judgeBlogIdentity  — 판정표 9줄
 *     ④ 🔴 변이 6종(AC-87) — 판정을 일부러 어긋낸 것들이 **전부 빨강**을 내는지
 *     ⑤ 사람말 — 알림 문구에 위협·책임 전가 0(CLAUDE §3)
 */
/* 러너 모듈(.mjs)은 타입 선언이 없다 — `verify-runner-auth.mts` 가 쓰는 **같은 방법**으로 읽는다(두 벌이 되지 않게). */
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(import.meta.dirname, "..");
const load = async (f: string) => await import(pathToFileURL(path.join(ROOT, "runner", "lib", f)).href);
const { blogIdFromUrl, pickBlogIdFromLinks, judgeBlogIdentity, NAVER_NON_IDS, readMyBlogId } = await load("auth-naver.mjs") as {
  blogIdFromUrl: (url: unknown) => string | null;
  pickBlogIdFromLinks: (hrefs: unknown, minCount?: number) => string | null;
  judgeBlogIdentity: (i: { handle?: string; observed?: string | null; via?: string | null; confirmed?: string | null })
    => { kind: string; want: string; got: string | null; via: string | null; why?: string };
  NAVER_NON_IDS: Set<string>;
  readMyBlogId: (page: unknown) => Promise<{ blogId: string | null; via: string | null; why: string | null }>;
};
/* 🔴 «뺀 사다리가 되살아났나»를 **소스로** 본다 — 브라우저 없이 잴 수 있는 유일한 방법이다.
   (함수를 부르면 실제로 네이버에 나간다 — 이 자는 네트워크 0 이 규율이다.) */
const readMyBlogIdSource = String(readMyBlogId);

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };
const u = (x: string) => `https://blog.naver.com/${x}`;

console.log("① blogIdFromUrl — 주소에서 아이디(아니면 null)");
{
  ok("평범한 글 주소", blogIdFromUrl("https://blog.naver.com/endy1116/224417455406") === "endy1116");
  ok("블로그 첫 화면", blogIdFromUrl("https://blog.naver.com/endy1116") === "endy1116");
  ok("모바일도 같다", blogIdFromUrl("https://m.blog.naver.com/endy1116/2244") === "endy1116");
  ok("쿼리가 붙어도", blogIdFromUrl("https://blog.naver.com/endy1116?Redirect=Write") === "endy1116");
  ok("🔴 «이름.naver» 는 아이디가 아니다", blogIdFromUrl("https://blog.naver.com/PostList.naver?blogId=x") === null,
    String(blogIdFromUrl("https://blog.naver.com/PostList.naver?blogId=x")));
  ok("🔴 화면 이름(NON_IDS)도 아이디가 아니다",
    ["BlogHome", "FrontMain", "MyBlog", "section", "gnb", "prologue"].every((x) => blogIdFromUrl(u(x)) === null));
  ok("NON_IDS 목록이 비지 않았다(규칙이 살아 있다)", NAVER_NON_IDS.size >= 8, String(NAVER_NON_IDS.size));
  ok("로그인 화면은 아이디가 없다", blogIdFromUrl("https://nid.naver.com/nidlogin.login?url=x") === null);
  ok("다른 도메인은 null", blogIdFromUrl("https://example.com/endy1116") === null);
  ok("한 글자는 아이디가 아니다(최소 2자)", blogIdFromUrl(u("a")) === null);
  ok("빈 값·쓰레기에 안 터진다", blogIdFromUrl("") === null && blogIdFromUrl(null) === null && blogIdFromUrl("!!!") === null);
}

console.log("\n② pickBlogIdFromLinks — 최빈값(빈도 ≥2) · 동점은 사전순");
{
  ok("2건이면 고른다", pickBlogIdFromLinks([u("aa"), u("aa"), u("bb")]) === "aa");
  ok("🔴 1건뿐이면 안 고른다 — 스친 링크를 «내 블로그»로 집으면 이웃을 집는다", pickBlogIdFromLinks([u("aa"), u("bb")]) === null);
  ok("이웃이 섞여도 최빈값", pickBlogIdFromLinks([u("mine"), u("mine"), u("mine"), u("neighbor")]) === "mine");
  ok("🔴 동점은 사전순으로 못 박는다(같은 화면에서 실행마다 다른 답 0)",
    pickBlogIdFromLinks([u("bb"), u("bb"), u("aa"), u("aa")]) === "aa" && pickBlogIdFromLinks([u("aa"), u("aa"), u("bb"), u("bb")]) === "aa");
  ok("화면 이름은 세지 않는다", pickBlogIdFromLinks([u("PostList.naver"), u("PostList.naver"), u("mine"), u("mine")]) === "mine");
  ok("빈 목록은 null", pickBlogIdFromLinks([]) === null && pickBlogIdFromLinks(undefined) === null);
}

/* ═══ ③ 판정표 — 돌리기 전에 먼저 적었다(트리거 §3) ═══ */
interface C { name: string; handle: string; observed: string | null; via: string | null; confirmed: string | null; kind: string; why?: string }
const TABLE: C[] = [
  { name: "장부와 같다 → match", handle: "endy1116", observed: "endy1116", via: "myblog", confirmed: null, kind: "match" },
  { name: "@ 와 대소문자는 무시하고 같다 → match", handle: "@Endy1116", observed: "endy1116", via: "myblog", confirmed: null, kind: "match" },
  { name: "🔴 다른 블로그 · 센 증거 → mismatch(여기만 막는다)", handle: "qj_academy", observed: "with_walk_on_office", via: "myblog", confirmed: null, kind: "mismatch" },
  { name: "🔴 고객이 확인해 준 주소 → confirmed(막지 않는다)", handle: "endy1116", observed: "myblogaddr", via: "myblog", confirmed: "myblogaddr", kind: "confirmed" },
  { name: "🔴 다른데 증거가 약하다(links) → unmeasured", handle: "endy1116", observed: "someone", via: "links", confirmed: null, kind: "unmeasured", why: "weak_evidence" },
  { name: "🔴 못 읽었다 → unmeasured(«같다»가 아니다)", handle: "endy1116", observed: null, via: null, confirmed: null, kind: "unmeasured", why: "not_read" },
  { name: "🔴 장부가 비었다 → unmeasured(댈 것이 없다 · 신규 연결)", handle: "", observed: "someone", via: "myblog", confirmed: null, kind: "unmeasured", why: "no_handle" },
  { name: "확인해 준 주소와도 다르다 → mismatch", handle: "endy1116", observed: "third", via: "myblog", confirmed: "myblogaddr", kind: "mismatch" },
  { name: "확인 주소가 있고 장부와도 같다 → match", handle: "endy1116", observed: "endy1116", via: "myblog", confirmed: "endy1116", kind: "match" },
];

console.log("\n③ judgeBlogIdentity — 판정표 9줄");
for (const c of TABLE) {
  const r = judgeBlogIdentity(c);
  ok(c.name, r.kind === c.kind && (!c.why || r.why === c.why), `kind=${r.kind} why=${r.why ?? "-"}`);
}

/* ═══ ④ 🔴 변이 — 이 판정에서 틀릴 수 있는 여섯 가지. 표가 전부 잡아야 한다 ═══ */
console.log("\n④ 🔴 변이 6종 — 자가 «틀린 판정»을 잡는지(AC-87 음성 대조)");
type J = (c: C) => string;
const real: J = (c) => judgeBlogIdentity(c).kind;
const MUT: { name: string; f: J }[] = [
  { name: "V1 약한 증거(links)로도 막는다 → 멀쩡한 계정에 엉뚱한 주소를 들이민다",
    f: (c) => { const r = judgeBlogIdentity({ ...c, via: c.via === "links" ? "myblog" : c.via }); return r.kind; } },
  { name: "🔴 V2 못 읽은 것을 match 로 읽는다(제일 비싼 실패 — 남의 블로그로 나간다)",
    f: (c) => (c.observed ? real(c) : "match") },
  { name: "V3 confirmed 를 안 본다 → 확인해 준 계정을 매번 다시 막는다",
    f: (c) => real({ ...c, confirmed: null }) },
  { name: "V4 대소문자를 안 맞춘다 → «Endy1116» 과 «endy1116» 이 다른 블로그가 된다",
    f: (c) => { const w = String(c.handle ?? "").replace(/^@/, "").trim(); const g = String(c.observed ?? "").trim();
      if (!g) return "unmeasured"; if (w && g === w) return "match";
      if (c.confirmed && g === c.confirmed) return "confirmed";
      if (c.via !== "myblog") return "unmeasured"; if (!w) return "unmeasured"; return "mismatch"; } },
  { name: "V5 장부가 비어도 mismatch 를 낸다 → 새로 연결한 계정이 첫 글부터 막힌다",
    f: (c) => { const r = judgeBlogIdentity(c); return (r.why === "no_handle" ? "mismatch" : r.kind); } },
  { name: "🔴 V6 아예 안 잰다(늘 match) — 이 기능을 통째로 뺀 것",
    f: () => "match" },
];
for (const m of MUT) {
  const caught = TABLE.filter((c) => m.f(c) !== c.kind);
  ok(`${m.name} — 잡힘(${caught.length}줄)`, caught.length > 0, "🔴 아무 줄도 못 잡는다 = 그 규칙은 지금 아무도 안 지키고 있다");
}

/* ═══ 🔴 회귀 방지 — «링크 최빈값»을 다시 사다리로 쓰지 못하게 못 박는다 ═══ */
console.log("\n④-b 🔴 BlogHome 링크 최빈값은 **신원의 증거가 아니다**(2026-09-21 실측)");
{
  /* 실측(로그아웃 · `section.blog.naver.com/BlogHome.naver` 를 두 번 열었다):
       1회차 링크 96개 · 아이디로 읽힌 것 84개 · 최빈값 5회 = aronmovie · liferecord689 · winsighting …
       2회차 같은 화면                              최빈값 5회 = nuk1905 · lbmoon68 · minahan …
     🔴 **전부 생판 남의 블로그였고, 두 번이 서로 달랐다.** 값이 틀릴 뿐 아니라 **재현되지도 않는다.**
     ⇒ `readMyBlogId` 에서 이 사다리를 뺐다. 아래 줄들은 «다시 넣지 마라»를 코드로 적어 둔 것이다. */
  const round1 = ["aronmovie", "liferecord689", "winsighting", "just_do_it2023", "awe0254"];
  const round2 = ["nuk1905", "lbmoon68", "minahan", "ektha0108", "okmijnuhb489"];
  const soup = (ids: string[]) => ids.flatMap((x) => [u(x), u(x), u(x), u(x), u(x)]);
  const r1 = pickBlogIdFromLinks(soup(round1));
  const r2 = pickBlogIdFromLinks(soup(round2));
  ok("실측 그대로 — 남의 블로그를 «내 블로그»로 집는다(그래서 뺐다)", !!r1 && round1.includes(r1), String(r1));
  ok("🔴 두 번이 서로 다르다 — 재현 안 되는 판정", r1 !== r2, `${r1} vs ${r2}`);
  /* 🔴 못 ①: 그런 값이 들어와도 판정기는 «다르다»를 선언하지 않는다(약한 증거 규칙).
     이 줄이 빨강이면 누군가 `judgeBlogIdentity` 의 비대칭을 없앤 것이다. */
  ok("🔴 그래도 판정기는 «다르다»를 선언하지 않는다(via=links → unmeasured)",
    judgeBlogIdentity({ handle: "endy1116", observed: r1, via: "links", confirmed: null }).kind === "unmeasured");
  /* 🔴 못 ②: **진짜 위험은 발행이 아니라 장부다.** 그 값이 `accounts.identity.observed` 로 적히면
     화면이 «이 주소가 맞나요?»로 **남의 블로그를 내밀고**, 고객이 «맞아요»를 누르면 `confirmed` → `expectBlogId` 가 된다.
     ⇒ **가드가 자기 폴백에 무장해제된다.** 그래서 사다리 자체를 뺐다. */
  ok("🔴 readMyBlogId 는 링크 사다리를 쓰지 않는다",
    !readMyBlogIdSource.includes("BlogHome") && !readMyBlogIdSource.includes("pickBlogIdFromLinks"),
    "🔴 링크 사다리가 되살아났다 — 로그인 상태로 실제로 재 보고 넣은 것인가?");
}

console.log("\n⑤ 사람말 — 고객에게 가는 문구(CLAUDE §3 · 위협·책임 전가 0)");
{
  /* `lib/runner-jobs.ts` 의 `identity_mismatch` 알림 본문을 **글자 그대로** 옮겨 잰다.
     🔴 두 벌이 되는 것을 알고 둔다 — 서버 문구를 고치면 이 줄이 빨강을 내고, 그때 같이 고치라는 뜻이다. */
  const want = "endy1116", got = "with_walk_on_office";
  const body = `저장된 주소는 «${want}» 인데 지금 로그인된 블로그는 «${got}» 예요. 네이버는 아이디와 블로그 주소가 다를 수 있어서, 맞는지 한 번만 확인해 주세요. 확인해 주시면 다음부터는 묻지 않고 그대로 올릴게요. 그동안 글은 올리지 않고 보관해 두었어요.`;
  const BAD = ["정지", "불이익", "책임", "알려만", "경고", "위반", "제재", "삭제됩니다", "주의하세요"];
  ok("겁주는 말 0", BAD.every((b) => !body.includes(b)), BAD.filter((b) => body.includes(b)).join(","));
  ok("①사실 — 무엇이 다른지 두 주소를 다 보여 준다", body.includes(want) && body.includes(got));
  ok("②어떻게 하면 되는지 — 한 번 확인", body.includes("한 번만 확인"));
  ok("③우리가 대신 한 것 — 안 올리고 보관했다", body.includes("보관"));
  ok("🔴 «정상일 수 있다»를 먼저 말한다(겁주지 않는다)", body.includes("다를 수 있어서"));
  ok("시스템 용어 0", !/테넌트|piece|러너 잡|job|blogId/i.test(body), body);
}

console.log(`\n${fail === 0 ? "🟢" : "🔴"} pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
