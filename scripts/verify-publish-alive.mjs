/**
 * scripts/verify-publish-alive.mjs — 🔴 **«한 번 나갔다»는 사실과 그 길을 지킨다**(C · 첫 발행 라운드 2026-09-20).
 *   사용: node scripts/verify-publish-alive.mjs
 *
 *   ══ 왜 이 자가 있나 ══
 *   2026-09-20 01:22 — 라이브 발행 **0건이던 제품이 1건**이 됐다.
 *   `https://blog.naver.com/endy1116/224417377648` · 러너 v1.4.0 · `publish.naver_blog` · 서식 번짐 0.
 *   🔴 그런데 **그 사실을 지키는 자가 없다.** 내일 누가 발행 경로를 깨도 아무도 모른다 —
 *      «발행 0건»은 처음부터 0건이었으니 **0으로 돌아가도 아무 검사가 안 운다.**
 *
 *   ══ 🔴 이 자는 **실발행을 하지 않는다** ══
 *   반복해서 올리면 남의 블로그에 글이 쌓인다. 그래서 잴 수 있는 것만 잰다 —
 *   **«한 번 나갔다는 사실»**과 **«그 길이 여전히 이어져 있나»** 둘이다. SELECT 만 있고 `guard()` 가 실행 직전에 다시 본다.
 *
 *   ══ 무엇을 세는가 ══
 *   ① **나간 글이 라이브에 남아 있나**(사실) — `posts` 에 `external_url` 이 있는 행 · `pieces.published_at`
 *      · `runner_jobs` 중 `kind LIKE 'publish.%'` 의 상태 분포. 🔴 **0건이 되면 빨강이다.**
 *   ② **그 길의 고리가 아직 붙어 있나**(코드 · 실발행 0) — 🔴 **손 목록이 아니라 ①이 알려 준 채널**에서 출발한다.
 *      실제로 나간 채널만 따라간다: 표(`channel-registry`) → 잡 이름 → 러너 핸들러 → 성공 보고 → `posts` 적재.
 *      한 고리라도 끊기면 빨강. 새 채널로 한 건이 나가면 **그날부터 그 채널도 이 자가 지킨다.**
 *   ③ 🔴 **«지금도 올라가나»는 못 쟀다** — 실발행 없이는 못 잰다(AC-9). 자가 그 줄을 스스로 찍는다.
 *
 *   ══ ⓪ 자기 찌르기 ══
 *   ⓪a 사실 판정에 «0건»을 먹이면 운다 · ⓪b «1건»에는 안 운다
 *   ⓪c 코드 **사본**에서 러너 핸들러 한 줄을 지우면 운다 · ⓪d 멀쩡한 사본에는 안 운다
 *   🔴 변이는 **사본**에서만 한다 — 제품 파일을 건드리지 않는다.
 *
 *   종료코드: 0 = 사실도 길도 살아 있다 · 1 = 잃었다 · 2 = 못 쟀다(DB 재료 없음 등).
 */
import { readFileSync, existsSync, mkdtempSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(ROOT, ".env"))) {
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

let fail = 0;
const say = (s = "") => console.log(s);
const unmeasured = [];

/* ═══════════════ ② 길 — 순수 함수라 **사본에도 돌릴 수 있다**(그래서 변이를 넣을 수 있다) ═══════════════ */
/** 그 채널이 실제로 나갈 수 있는 길로 이어져 있나. root 를 바꾸면 사본을 잰다. */
function chainOf(root, channel) {
  const read = (rel) => { try { return readFileSync(path.join(root, rel), "utf8"); } catch { return null; } };
  const links = [];
  const add = (name, ok, detail) => links.push({ name, ok, detail });

  const reg = read("lib/channel-registry.ts");
  if (reg == null) { add("표(lib/channel-registry.ts)", false, "파일이 없다"); return links; }
  const row = reg.split("\n").find((l) => new RegExp(`key:\\s*["']${channel}["']`).test(l));
  if (!row) { add(`표에 «${channel}» 줄`, false, "표에 그 채널이 없다"); return links; }
  const via = (row.match(/publishVia:\s*["'](\w+)["']/) || [])[1] || null;
  const jobKind = (row.match(/jobKind:\s*["']([\w.]+)["']/) || [])[1] || null;
  add(`표가 «${channel}» 의 발행 길을 안다`, !!via, `publishVia=${via ?? "null"}`);
  if (!via) return links;

  if (via === "runner") {
    add(`표에 잡 이름이 있다`, !!jobKind, `jobKind=${jobKind ?? "null"}`);
    const port = read("lib/cron/publish-port.ts");
    add("서버 잡 어휘(publish-port.ts)가 그 이름을 안다", !!(port && jobKind && port.includes(`"${jobKind}"`)), jobKind ?? "");
    const core = read("runner/core.mjs");
    let handlerFn = null;
    if (core && jobKind) {
      const m = core.match(new RegExp(`["']${jobKind.replace(".", "\\.")}["']\\s*:\\s*([A-Za-z_$][\\w$]*)`));
      handlerFn = m ? m[1] : null;
    }
    add("러너가 그 잡을 처리한다(runner/core.mjs HANDLERS)", !!handlerFn, handlerFn ? `→ ${handlerFn}()` : "HANDLERS 에 그 이름이 없다");
    if (core && handlerFn) {
      /* 세 가지 들여오는 꼴을 다 본다 — `import * as X from`, `import { X } from`, `import X from`. */
      const im = core.match(new RegExp(`import\\s*\\*\\s*as\\s+${handlerFn}\\s+from\\s*["']([^"']+)["']`))
        || core.match(new RegExp(`import\\s*\\{[^}]*\\b${handlerFn}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`))
        || core.match(new RegExp(`import\\s+${handlerFn}\\s+from\\s*["']([^"']+)["']`));
      const file = im ? im[1].replace(/^\.\//, "") : null;
      add("그 처리기의 파일이 있다", !!(file && existsSync(path.join(root, "runner", file))), file ?? "import 를 못 찾았다");
    }
    const rj = read("lib/runner-jobs.ts");
    add("러너의 성공 보고가 발행으로 이어진다(runner-jobs.ts)", !!(rj && /kind\.startsWith\(\s*["']publish\.["']\s*\)/.test(rj)), "");
  } else {
    const idx = read("lib/publish/index.ts");
    add("API 발행 모듈이 그 채널을 부른다(lib/publish/index.ts)", !!(idx && idx.includes(channel)), channel);
  }
  const fin = read("lib/publish/finalize.ts");
  add("나간 글이 posts 에 적힌다(finalize.ts)", !!(fin && /INSERT\s+INTO\s+posts/i.test(fin)), "");
  return links;
}

/* ═══════════════ ① 사실 — 판정은 **순수 함수**로 떼어 둔다(⓪ 가 먹여 볼 수 있게) ═══════════════ */
/** @returns {{ok:boolean, why:string}} */
function judgeFacts(f) {
  if (f.postsWithUrl > 0) return { ok: true, why: `밖에 남아 있는 글 ${f.postsWithUrl}건` };
  if (f.piecesPublished > 0) return { ok: false, why: `🔴 piece 는 «발행됨»인데 **주소가 남은 posts 행이 0건**이다 — 나간 자취를 잃었다` };
  return { ok: false, why: "🔴 **라이브 발행 0건으로 돌아갔다** — 2026-09-20 01:22 에 1건이 나갔던 제품이다" };
}

/* ═══════════════ 라이브 읽기 ═══════════════ */
const URLSTR = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
/** 🔴 실행 직전 재확인 — 이 파일이 나중에 고쳐져도 쓰기가 섞이면 여기서 멈춘다. */
const guard = (text) => {
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|copy)\b/i.test(text)) {
    console.error(`🔴 읽기 전용 자에 쓰기 문장이 섞였다 — 중단한다:\n${text.slice(0, 200)}`);
    process.exit(3);
  }
  return text;
};

say("🔴 «한 번 나갔다»를 지키는 자 — 실발행 0 · 읽기만 · " + new Date().toISOString());
say("─".repeat(112));

let facts = null, channels = [];
if (!URLSTR) {
  unmeasured.push("라이브를 못 읽었다 — `NETLIFY_DATABASE_URL` 이 없다. ①(사실)은 **못 쟀음**이다.");
} else {
  const { default: postgres } = await import("postgres");
  const sqlc = postgres(URLSTR, { ssl: "require", max: 1 });
  const ask = async (text) => { guard(text); try { return await sqlc.unsafe(text); } catch (e) { return { err: String(e?.message ?? e).slice(0, 160) }; } };
  const p1 = await ask("SELECT COUNT(*)::int AS all_rows, COUNT(external_url)::int AS with_url FROM posts");
  const p2 = await ask("SELECT channel, published_via, COUNT(*)::int AS n FROM posts WHERE external_url IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC");
  const p3 = await ask("SELECT COUNT(*)::int AS n FROM pieces WHERE published_at IS NOT NULL AND external_url IS NOT NULL");
  const p4 = await ask("SELECT kind, status, COUNT(*)::int AS n FROM runner_jobs WHERE kind LIKE 'publish.%' GROUP BY 1,2 ORDER BY 1,2");
  await sqlc.end({ timeout: 3 });
  if (p1.err || p2.err || p3.err || p4.err) {
    unmeasured.push(`라이브를 못 읽었다 — ${(p1.err || p2.err || p3.err || p4.err)}. ①(사실)은 **못 쟀음**이다.`);
  } else {
    facts = { posts: p1[0].all_rows, postsWithUrl: p1[0].with_url, piecesPublished: p3[0].n, byChannel: [...p2], jobs: [...p4] };
    channels = [...new Set(facts.byChannel.map((r) => r.channel))];
  }
}

/* ═══════════════ ① 판정 ═══════════════ */
say("① 나간 글이 라이브에 남아 있나 — **사실**");
if (!facts) {
  say("   ⊘ 못 쟀음 — 라이브를 못 읽었다.");
} else {
  const v = judgeFacts(facts);
  if (!v.ok) fail++;
  say(`   ${v.ok ? "✓" : "✗"} ${v.why}`);
  say(`     posts ${facts.posts}행(그 중 주소 있는 것 ${facts.postsWithUrl}행) · pieces «발행됨+주소» ${facts.piecesPublished}건`);
  for (const r of facts.byChannel) say(`       · ${r.channel} — ${r.published_via ?? "(방법 없음)"} ${r.n}건`);
  const noVia = facts.byChannel.filter((r) => !r.published_via).reduce((a, r) => a + r.n, 0);
  if (noVia) say(`     △ 살펴볼 것 — 주소는 있는데 **«올린 방법»이 빈 행 ${noVia}개**. 화면은 «올린 방법»을 그 칸에서 읽는다(posts.html).`);
  if (facts.jobs.length) for (const r of facts.jobs) say(`       · 러너 잡 ${r.kind} — ${r.status} ${r.n}개`);
  else say("       · 러너 잡 publish.* 0개 — 🔴 posts 는 있는데 잡이 없다면 **길이 바뀐 것**이다(살펴볼 것)");
}
say("");

/* ═══════════════ ② 판정 ═══════════════ */
say("② 그 길의 고리가 아직 붙어 있나 — **코드**(실발행 0 · 🔴 목록은 ①이 준다)");
if (!channels.length) {
  say("   ⊘ 못 쟀음 — ①이 채널을 못 알려 줬다. **손으로 채널을 적지 않는다**(적으면 그 목록이 낡는다 · AC-113).");
  unmeasured.push("②(길) — 나간 채널을 라이브에서 못 읽어 **한 채널도 못 따라갔다**.");
} else {
  for (const ch of channels) {
    const links = chainOf(ROOT, ch);
    const broken = links.filter((l) => !l.ok);
    if (broken.length) fail++;
    say(`   ${broken.length ? "✗" : "✓"} ${ch} — 고리 ${links.length - broken.length}/${links.length}`);
    for (const l of links) say(`       ${l.ok ? "·" : "🔴"} ${l.name}${l.detail ? `  (${l.detail})` : ""}`);
  }
}
say("");

/* ═══════════════ ③ 🔴 못 쟀음 — 자가 스스로 찍는다 ═══════════════ */
say("③ 🔴 **«지금도 올라가나»는 못 쟀다** — 실발행 없이는 못 잰다.");
say("   이 자가 아는 것은 «한 번 나갔다»와 «길이 끊기지 않았다» 둘뿐이다.");
say("   지금 올라가는지는 **B2 가 서식 시험으로 한 건 올릴 때**만 알 수 있다(사장님 블로그 · 1~2건).");
say("   🔴 길이 붙어 있다고 **올라간다는 뜻은 아니다** — 셀렉터가 바뀌면 길은 붙은 채로 실패한다.");
say("");

/* ═══════════════ ⓪ 자기 찌르기 ═══════════════ */
const probes = [];
const chk = (name, ok, note) => { probes.push({ name, ok, note }); if (!ok) fail++; };

chk("⓪a 사실 판정에 «0건»을 먹이면 운다", judgeFacts({ posts: 0, postsWithUrl: 0, piecesPublished: 0 }).ok === false, "");
chk("⓪a2 «piece 는 발행됨인데 posts 주소 0»에도 운다", judgeFacts({ posts: 3, postsWithUrl: 0, piecesPublished: 2 }).ok === false, "자취를 잃은 자리");
chk("⓪b «1건»에는 안 운다(거짓 빨강 없음)", judgeFacts({ posts: 1, postsWithUrl: 1, piecesPublished: 1 }).ok === true, "");

/* ⓪c·⓪d — 🔴 **사본**에서만 변이한다. 제품 파일은 안 건드린다. */
const MUT_CH = channels[0] || "naver_blog";
const tmp = mkdtempSync(path.join(os.tmpdir(), "ac-alive-"));
const NEED = ["lib/channel-registry.ts", "lib/cron/publish-port.ts", "lib/runner-jobs.ts", "lib/publish/index.ts", "lib/publish/finalize.ts", "runner/core.mjs"];
try {
  for (const rel of NEED) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) continue;
    mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    copyFileSync(src, path.join(tmp, rel));
  }
  /* 러너 처리기 파일들도 함께 옮겨야 «파일이 있다» 고리가 사본에서도 참이다. */
  const chDir = path.join(ROOT, "runner", "channels");
  if (existsSync(chDir)) {
    mkdirSync(path.join(tmp, "runner", "channels"), { recursive: true });
    for (const f of (await import("node:fs")).readdirSync(chDir)) copyFileSync(path.join(chDir, f), path.join(tmp, "runner", "channels", f));
  }
  const clean = chainOf(tmp, MUT_CH);
  chk("⓪d 멀쩡한 **사본**에는 안 운다(대조군)", clean.length > 2 && clean.every((l) => l.ok), `사본 고리 ${clean.filter((l) => l.ok).length}/${clean.length}`);

  /* 변이 — 러너 HANDLERS 에서 그 채널 줄을 뺀다(«러너가 그 잡을 더는 모른다») */
  const coreP = path.join(tmp, "runner", "core.mjs");
  const before = readFileSync(coreP, "utf8");
  const reg = readFileSync(path.join(tmp, "lib/channel-registry.ts"), "utf8");
  const jk = ((reg.split("\n").find((l) => new RegExp(`key:\\s*["']${MUT_CH}["']`).test(l)) || "").match(/jobKind:\s*["']([\w.]+)["']/) || [])[1];
  const after = jk ? before.split("\n").filter((l) => !l.includes(`"${jk}"`) || !/:\s*[A-Za-z_$][\w$]*\s*,?\s*$/.test(l)).join("\n") : before;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(coreP, after);
  const mutated = chainOf(tmp, MUT_CH);
  chk("⓪c 사본에서 러너 처리기 줄을 지우면 운다", after !== before && mutated.some((l) => !l.ok),
    after === before ? `🔴 변이를 못 넣었다(jobKind=${jk ?? "없음"}) — **자가 못 쟀다는 뜻**이다` : `끊긴 고리: ${mutated.filter((l) => !l.ok).map((l) => l.name).join(" · ") || "없음"}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

say("⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «변이를 넣으면 우는가»");
for (const p of probes) say(`  ${p.ok ? "✓" : "✗"} ${p.name}${p.note ? `  — ${p.note}` : ""}`);
say("");
if (unmeasured.length) {
  say(`⊘ 못 쟀음 ${unmeasured.length}개 — **통과가 아니다**(AC-9)`);
  for (const u of unmeasured) say(`   · ${u}`);
  say("");
}
say("─".repeat(112));
say(fail ? "🔴 잃었다 — 위를 보라."
  : "✅ ①«한 번 나갔다»는 사실도 ②그 길도 살아 있다.  🔴 다만 이 자는 **«지금도 올라간다»고 말하지 않는다**(③).");
process.exit(fail ? 1 : 0);
