/**
 * scripts/verify-p1r7-public-probe.mts — **«올렸는데 비공개» 도장 프로브**(C · R7 §5-⑤ · AC-55 뒷정리).
 *   `npx tsx --env-file=.env scripts/verify-p1r7-public-probe.mts --tid <테스트 테넌트>`
 *
 *   🔴 판정 기준을 바꿨다: 러너가 쿠키를 지우고 여는지가 아니라(그건 `launchPersistentContext` 라 **의도적으로 안 한다** —
 *   지우면 그 계정이 로그아웃되어 고객이 다시 로그인해야 한다), **쿠키 없는 서버가 한 번 더 열어 «공개» 도장을 찍는가** 다.
 *   러너의 `alive` 는 «생존» 신호일 뿐 «공개» 증거가 아니다(글쓴이 눈에는 비공개 글도 보인다).
 *
 *   재는 것(전부 **실제 HTTP** — 내가 띄운 임시 서버를 서버 코드가 진짜로 연다):
 *     ① 비공개 안내 페이지 → `posts.stats.public=false` + `publicCheckedAt` + 감사 `publish_not_public`(risk high) + 고객 알림
 *     ② 제목이 일치하는 공개 페이지 → `public:true`
 *     ③ 🔴 **제목 없는 200**(블로그 첫 화면으로 튕긴 모양) → **아무 키도 안 찍힌다**(AC-9 음성 대조 — 여기서 도장을 찍으면 우리가 «틀린 초록»을 만든다)
 *     ④ 404 → 도장 없음(«못 읽었다»를 «비공개»로 바꾸지 않는다)
 *   🔴 테스트 테넌트에서만 · 만든 행은 끝에서 지운다 · 발행은 일어나지 않는다.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import http from "node:http";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { verifyPublishedUrl, registerDevice, enqueueJob, reportJob } from "../lib/runner-jobs";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const TID = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);
const TITLE = "가을 이불 세탁 코인빨래방 후기";

/** 임시 페이지 3장 + 404 — 서버 코드가 **진짜 HTTP 로** 연다(문자열 흉내가 아니다). */
function fixture(): Promise<{ port: number; close: () => void }> {
  const srv = http.createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0];
    const html = (body: string) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<html><head><title>글</title></head><body>${body}</body></html>`); };
    if (p === "/private") return html("<h1>비공개 글입니다</h1><p>작성자만 볼 수 있어요</p>");
    if (p === "/public") return html(`<h1>${TITLE}</h1><p>본문입니다</p>`);
    if (p === "/bare") return html("<h1>블로그 첫 화면</h1><p>최근 글 목록</p>");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end("<html><body>없는 글</body></html>");
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ port: (srv.address() as { port: number }).port, close: () => srv.close() })));
}

async function main() {
  if (!TID) { out("프로브 인자", false, "--tid <테스트 테넌트> 가 필요하다"); return; }
  const [t] = await q(sql`SELECT (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) AS email FROM tenants t WHERE id = ${TID}`);
  if (!String(t?.email ?? "").endsWith("@autocreate.test")) { out("테스트 테넌트 가드", false, `tid ${TID} 은 테스트 집이 아니다`); return; }

  const fx = await fixture();
  const base = `http://127.0.0.1:${fx.port}`;
  const made: { posts: number[]; jobs: number[]; devices: number[]; pieces: number[] } = { posts: [], jobs: [], devices: [], pieces: [] };
  try {
    /* ── 판정 함수부터(4갈래가 다 나오는가) ── */
    const vPrivate = await verifyPublishedUrl(`${base}/private`, TITLE);
    const vPublic = await verifyPublishedUrl(`${base}/public`, TITLE);
    const vBare = await verifyPublishedUrl(`${base}/bare`, TITLE);
    const vBareNoTitle = await verifyPublishedUrl(`${base}/bare`, null);
    const v404 = await verifyPublishedUrl(`${base}/nope`, TITLE);
    out("⑤ 판정 4갈래가 다 나온다 — private·found·unknown·not_found", vPrivate === "private" && vPublic === "found" && vBare === "unknown" && v404 === "not_found",
      `private=${vPrivate} public=${vPublic} 제목불일치=${vBare} 404=${v404}`);
    out("🔴 ⑤ 제목을 안 주면 200 은 그냥 «found» 다 — 그래서 도장 쪽에서 제목을 반드시 본다", vBareNoTitle === "found", `제목 없이 /bare → ${vBareNoTitle}`);

    /* ── 도장: 러너 보고(reportJob) 전 경로를 그대로 탄다 ── */
    const reg = await registerDevice(TID, `C R7 공개확인 PC ${Date.now().toString(36)}`, "own");
    made.devices.push(n(reg.device.id));
    const dev = { id: n(reg.device.id), tenantId: TID, name: String(reg.device.name ?? ""), kind: "own" };

    const stamp = async (label: string, path: string, title: string | null) => {
      /* posts.piece_id 는 NOT NULL — 발행은 늘 글에서 나온다. 씨앗도 글 1행을 먼저 만든다(스키마대로). */
      const [pc] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, status, title, meta) VALUES (${TID}, 'tistory', 'post', 'published', ${TITLE}, ${jsonb({})}) RETURNING id`);
      made.pieces.push(n(pc?.id));
      const [p] = await q(sql`INSERT INTO posts (tenant_id, piece_id, channel, status, external_url, published_at, stats)
        VALUES (${TID}, ${n(pc?.id)}, 'tistory', 'published', ${`${base}${path}`}, NOW(), ${jsonb({})}) RETURNING id`);
      const postId = n(p?.id); made.posts.push(postId);
      const job = await enqueueJob({ tenantId: TID, kind: "verify.post_alive", payload: { postId, externalUrl: `${base}${path}`, ...(title ? { title } : {}) } as never, dedupe: false });
      made.jobs.push(job.id);
      await q(sql`UPDATE runner_jobs SET status = 'claimed', claimed_by = ${dev.id}, claimed_at = NOW() WHERE id = ${job.id}`);
      const rep = await reportJob(dev as never, job.id, { ok: true, stats: { alive: true, views: 12 } } as never);
      const [row] = await q(sql`SELECT stats FROM posts WHERE id = ${postId}`);
      const st = (row?.stats ?? {}) as Row;
      return { postId, st, label, rep };
    };

    /** 🔴 보고가 **처리됐는가**부터 본다. 내 씨앗이 잘못돼 `not_claimed` 로 되돌아오면
     *  stats 는 당연히 비어 있고, 그 빈 stats 를 «안 찍혔다» 로 읽으면 음성 대조가 통째로 가짜 초록이 된다(AC-55). */
    const took = (r: { rep?: unknown }) => {
      const x = (r.rep ?? {}) as { status?: unknown; reason?: unknown };
      return String(x.status) === "done" && !String(x.reason ?? "").startsWith("not_claimed");
    };

    const a = await stamp("비공개", "/private", TITLE);
    const [aud] = await q(sql`SELECT id, risk_level, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'publish_not_public' ORDER BY id DESC LIMIT 1`);
    const [note] = await q(sql`SELECT id, title FROM notifications WHERE tenant_id = ${TID} AND kind = 'publish' ORDER BY id DESC LIMIT 1`);
    out("🔴 ⑤ 비공개 페이지 → stats.public=false + publicCheckedAt + 감사 publish_not_public(high) + 고객 알림",
      took(a) && a.st.public === false && !!a.st.publicCheckedAt && !!aud && String(aud.risk_level) === "high" && !!note,
      `post ${a.postId} public=${a.st.public} checkedAt=${a.st.publicCheckedAt ? "있음" : "없음"} · 감사 ${aud?.id}/${aud?.risk_level} · report ${JSON.stringify(a.rep)}`);

    const b = await stamp("공개", "/public", TITLE);
    out("⑤ 제목이 맞는 공개 페이지 → stats.public=true", took(b) && b.st.public === true && !!b.st.publicCheckedAt, `post ${b.postId} 보고처리=${took(b)} public=${b.st.public}`);

    const c = await stamp("제목 없는 200", "/bare", null);
    out("🔴 ⑤ **제목 없는 200 → 아무 도장도 안 찍는다**(음성 대조 · 여기서 true 를 찍으면 우리가 «틀린 초록»을 만든다)",
      took(c) && !("public" in c.st) && !("publicCheckedAt" in c.st), `post ${c.postId} 보고처리=${took(c)} stats 키 [${Object.keys(c.st).join(",")}]`);

    const d = await stamp("404", "/nope", TITLE);
    out("⑤ 404 → 도장 없음(«못 읽었다»를 «비공개»로 바꾸지 않는다 · AC-9)", took(d) && !("public" in d.st), `post ${d.postId} 보고처리=${took(d)} stats 키 [${Object.keys(d.st).join(",")}]`);

    const e = await stamp("살아 있음만", "/public", null);
    out("⑤ 제목을 안 실은 보고는 «found» 여도 도장 없음(제목 없이는 공개를 단정하지 않는다)", took(e) && !("public" in e.st), `post ${e.postId} 보고처리=${took(e)} stats 키 [${Object.keys(e.st).join(",")}]`);
  } catch (e) {
    out("프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 200));
  } finally {
    fx.close();
    for (const id of made.jobs) await q(sql`DELETE FROM runner_jobs WHERE id = ${id}`).catch(() => []);
    for (const id of made.posts) await q(sql`DELETE FROM posts WHERE id = ${id}`).catch(() => []);
    for (const id of made.devices) await q(sql`DELETE FROM runner_devices WHERE id = ${id}`).catch(() => []);
    for (const id of made.pieces) await q(sql`DELETE FROM pieces WHERE id = ${id}`).catch(() => []);
    await q(sql`DELETE FROM audit_logs WHERE tenant_id = ${TID} AND action = 'publish_not_public'`).catch(() => []);
    await q(sql`DELETE FROM notifications WHERE tenant_id = ${TID} AND kind = 'publish'`).catch(() => []);
    out("프로브 정리(post·job·device·감사·알림)", true, `posts ${made.posts.join(",") || "0"}`);
    await pgClient.end().catch(() => {});
  }
}
await main();
