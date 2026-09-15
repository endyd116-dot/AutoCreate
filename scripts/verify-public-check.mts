/**
 * scripts/verify-public-check.mts — «남이 볼 수 있나» 판정을 **실제로 돌려서** 확인한다(2026-09-15 · AC-55 뒷정리).
 *
 *   🔴 왜 이 스크립트가 있나: 이번 라운드에 두 번 당했다 —
 *      `run.bat` 은 읽어서는 멀쩡했는데 **한 번도 동작한 적이 없었고**(지연확장),
 *      preflight 는 «항목 전부 ✗ 인데 판정은 ✓ 전부 통과»로 찍혔다(칸 이름 오독).
 *      **코드를 읽어서는 못 잡는다 · 돌려야 한다**(AC-51). 그래서 `tsc` 통과는 증거로 세지 않는다.
 *
 *   무엇을 확인하나: `verifyPublishedUrl` 이 네 갈래를 **정말로** 가르는지.
 *      found     — 제목이 보이는 정상 글
 *      private   — 비공개 안내(200 · 403 둘 다)
 *      not_found — 404 / 410
 *      unknown   — 200 이지만 제목이 없다(블로그 첫 화면으로 튕김 등) · 우리가 못 읽은 것
 *
 *   🔴 **음성 대조(negative control) 를 같이 돌린다** — 판정이 «그냥 다 private» 이거나 «그냥 다 found» 면
 *      초록이 의미가 없다. 그래서 «비공개 표식이 없는 페이지»와 «제목이 안 맞는 페이지»를 반드시 섞는다.
 *
 *   ⚠️ 한계(정직): 여기 쓰는 비공개 문구는 **우리가 추정한 목록**이다(티스토리 계정이 `pending_login` 이라
 *      실제 비공개 페이지를 아직 못 열어 봤다). 이 스크립트는 «목록에 있는 말이 오면 잡는다»를 증명하지,
 *      «티스토리가 정말 그 말을 쓴다»를 증명하지 않는다. 그건 첫 실발행 탐침 때 확정한다.
 *
 *   ── §한계 (알고 고른 것) ─────────────────────────────────────────────
 *   낱말로 가리므로 **«비공개»를 이야기하는 정상 글이 비공개로 잡힌다**(`/mentions-private` 케이스 · 실측 확인).
 *   그래도 이 방향을 고른 이유 — **두 오류의 값이 다르다**:
 *     · 못 잡으면(거짓 음성): 고객 글이 **아무에게도 안 보이는데 우리는 «발행 성공»** 이라고 말한다. 조용하다.
 *     · 잘못 잡으면(거짓 양성): 고객이 «확인해 주세요» 알림을 받고 글을 열어 본다. 5초에 끝나고, 발행은 확정돼 있다.
 *   ⇒ **조용한 «틀린 성공»보다 시끄러운 헛경보가 낫다.** 그래서 알림 문구도 «비공개입니다»가 아니라
 *      «안 보였어요 · 확인해 주세요»로 적었다(단정하지 않는다).
 *   🔴 오탐을 줄이는 길은 **실물 페이지를 보는 것**뿐이다(길이·표식 위치로 가르기). 추정으로 규칙을 더 얹지 않았다 —
 *      첫 실발행 탐침 때 비공개 페이지 1장을 저장해 오면 그때 좁힌다.
 *
 *   실행: npx --yes tsx scripts/verify-public-check.mts     (DB·네트워크 불필요 — 로컬 서버만 띄운다)
 */
import http from "node:http";
import { verifyPublishedUrl } from "../lib/runner-jobs";

const TITLE = "가을 등산화 고르는 법";

/** 실제 채널 페이지의 모양을 흉내낸 응답들. key = 경로. */
const PAGES: Record<string, { status: number; body: string; why: string }> = {
  "/ok": {
    status: 200, why: "정상 공개 글(제목이 보인다)",
    body: `<html><head><title>${TITLE}</title></head><body><h1>${TITLE}</h1><p>본문…</p></body></html>`,
  },
  "/private-200": {
    status: 200, why: "비공개 안내(200) — 티스토리류",
    body: `<html><body><div class="notice">비공개 글입니다.</div></body></html>`,
  },
  "/private-403": {
    status: 403, why: "비공개 안내(403) — «못 본다»를 «없다»로 뭉개지 않는지",
    body: `<html><body>접근 권한이 없습니다.</body></html>`,
  },
  "/private-with-title": {
    status: 200, why: "🔴 비공개인데 제목까지 품고 있다(og:title·목록 잔재) — 제목 검사보다 먼저 걸러야 한다",
    body: `<html><head><meta property="og:title" content="${TITLE}"></head><body>보호된 글입니다.</body></html>`,
  },
  "/gone": { status: 404, why: "삭제됨", body: "not found" },
  "/gone410": { status: 410, why: "삭제됨(410)", body: "gone" },
  "/home": {
    status: 200, why: "음성 대조 ①: 블로그 첫 화면으로 튕김(제목 없음 · 비공개 표식도 없음) → 단정하면 안 된다",
    body: `<html><body><h1>내 블로그</h1><ul><li>다른 글</li></ul></body></html>`,
  },
  "/other-post": {
    status: 200, why: "음성 대조 ②: 멀쩡한 남의 글(비공개 표식 없음) → private 로 잡히면 오탐이다",
    body: `<html><body><h1>전혀 다른 글 제목</h1><p>비공개라는 말은 한 마디도 없다</p></body></html>`,
  },
  "/mentions-private": {
    status: 200, why: "🔴 음성 대조 ③: **본문에서 «비공개»를 이야기하는 정상 글** — 낱말만 보면 오탐 난다",
    body: `<html><head><title>${TITLE}</title></head><body><h1>${TITLE}</h1>
      <p>블로그 글을 비공개로 설정하는 방법을 알아봅니다. 비공개 글입니다 라는 안내가 뜨면…</p></body></html>`,
  },
};

type Verdict = "found" | "not_found" | "private" | "unknown";
interface Case { path: string; title: string | null; want: Verdict; note?: string }

const CASES: Case[] = [
  { path: "/ok",                 title: TITLE, want: "found" },
  { path: "/private-200",        title: TITLE, want: "private" },
  { path: "/private-403",        title: TITLE, want: "private" },
  { path: "/private-with-title", title: TITLE, want: "private",   note: "제목이 있어도 비공개가 이긴다" },
  { path: "/gone",               title: TITLE, want: "not_found" },
  { path: "/gone410",            title: TITLE, want: "not_found" },
  { path: "/home",               title: TITLE, want: "unknown",   note: "음성 대조 — 단정 금지" },
  { path: "/other-post",         title: TITLE, want: "unknown",   note: "음성 대조 — private 아님" },
  { path: "/ok",                 title: null,  want: "found",     note: "제목 없이 부르면 200 이면 found(그래서 호출부가 제목을 함께 본다)" },
  /* 🔴 알려진 한계를 **테스트로 고정**한다(숨기지 않는다).
     본문에서 «비공개»를 설명하는 정상 글은 낱말만 보는 이 방식으로는 private 으로 잡힌다 = **오탐**.
     지금은 그게 사실이므로 그렇게 적는다 — 초록으로 덮으면 다음 사람이 «오탐 없음»으로 믿는다. */
  { path: "/mentions-private",   title: TITLE, want: "private",   note: "⚠️ 알려진 오탐 — §한계 참조" },
];

const server = http.createServer((req, res) => {
  const p = new URL(req.url ?? "/", "http://x").pathname;
  const page = PAGES[p];
  if (!page) { res.writeHead(404); res.end("no fixture"); return; }
  res.writeHead(page.status, { "content-type": "text/html; charset=utf-8" });
  res.end(page.body);
});

async function main() {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  console.log(`\n  «남이 볼 수 있나» 판정 실측 — ${base}\n`);

  let pass = 0; const fails: string[] = [];
  for (const c of CASES) {
    const got = await verifyPublishedUrl(`${base}${c.path}`, c.title);
    const ok = got === c.want;
    if (ok) pass++; else fails.push(`${c.path}(제목 ${c.title ? "있음" : "없음"}): 기대 ${c.want} · 실제 ${got}`);
    console.log(`  ${ok ? "✓" : "✗"} ${c.path.padEnd(22)} 제목 ${c.title ? "○" : "×"}  → ${String(got).padEnd(10)} ${c.note ?? PAGES[c.path]?.why ?? ""}`);
  }

  /* 🔴 판정이 한쪽으로 쏠렸으면 초록이 의미 없다 — 네 갈래가 **다 나왔는지** 본다(false green 방지). */
  const verdicts = new Set<string>();
  for (const c of CASES) verdicts.add(await verifyPublishedUrl(`${base}${c.path}`, c.title));
  const spread = ["found", "private", "not_found", "unknown"].filter((v) => verdicts.has(v));

  console.log(`\n  통과 ${pass}/${CASES.length} · 나온 판정 ${spread.length}/4 (${spread.join(", ")})`);
  if (spread.length < 4) fails.push(`판정이 ${spread.length}종만 나왔다 — 한쪽으로 쏠렸으면 이 검사는 초록이어도 의미가 없다`);
  if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
  else console.log("\n  ✓ 네 갈래를 모두 정확히 가른다(음성 대조 포함).\n");

  await new Promise<void>((ok) => server.close(() => ok()));
}

main().catch((e) => { console.error(e); process.exitCode = 1; server.close(); });
