/**
 * runner/core.mjs — 큐 소비 루프(claim → 실행 → report) · 잡 라우팅 · 카나리.
 *   AM 원본: ../AutoMarketing/scripts/content-runner-core.mjs(루프·세션·보고 관례 이식 2026-09-14).
 *
 *   🔴 AC-3 — **잡 1건 = 컨텍스트 1개**. 계정 프로필 폴더는 영구(쿠키 유지)지만 컨텍스트는 매번 새로 열고 닫는다.
 *      재사용하면 앞 계정 세션이 남아 «다른 계정에 글이 올라간다».
 *   🔴 실패는 **정직 분류**다(계약 §2 RunnerErrorKind). 못 했으면 못 했다고 보고한다 — «성공»으로 만들지 않는다.
 */
import { claim, report, release, heartbeat } from "./lib/api.mjs";
import { openContext, applyCookies, shotKeyFor, SHOTS_ON } from "./lib/browser.mjs";
import { planEditorOps, disclosureIsFirst } from "./lib/plan.mjs";

import * as naverBlog from "./channels/naver-blog.mjs";
import * as tistory from "./channels/tistory.mjs";
import * as sessionLogin from "./channels/session-login.mjs";
import * as postAlive from "./channels/post-alive.mjs";

/** 시각은 저장 UTC · 사람에게 보이는 것은 KST(DESIGN §13.5). 콘솔·파일명은 사람이 보는 것이므로 KST. */
export const kst = (d = new Date()) =>
  new Date(d.getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
export const log = (...a) => console.log(`[${kst()}]`, ...a);

const HANDLERS = {
  "publish.naver_blog": naverBlog,
  "publish.tistory": tistory,
  "session.login": sessionLogin,
  "session.verify": sessionLogin,
  "verify.post_alive": postAlive,
  "revenue.stats": postAlive,
};

/** 사람이 봐야 하는 잡(창이 떠야 한다). */
const NEEDS_HEADED = new Set(["session.login", "session.verify"]);

export const ALL_KINDS = Object.keys(HANDLERS);

/** Error → RunnerErrorKind. 러너가 마커를 박았으면 그대로, 아니면 문구로 추정(서버가 다시 한 번 분류한다). */
function errorKindOf(e) {
  if (e?.errorKind) return String(e.errorKind);
  const m = /\[block:([a-z_]+)\]/.exec(String(e?.message ?? ""));
  if (m) return m[1];
  const s = String(e?.message ?? e);
  if (/timeout|ECONN|ENOTFOUND|net::/i.test(s)) return "network";
  if (/locator|selector|찾지 못|not found|waiting for/i.test(s)) return "selector_changed";
  return "unknown";
}
const cleanMsg = (e) => String(e?.message ?? e).replace(/\[block:[a-z_]+\]\s*/, "").replace(/\s+/g, " ").slice(0, 300);

/**
 * runJob — 잡 1건 실행. 반환 = 서버로 보낼 result(계약 §2 report).
 *   여기서 throw 하지 않는다 — 실패도 «보고할 결과»다(조용히 사라지는 잡이 없게).
 */
export async function runJob({ chromium, token, job, headed, dryRun }) {
  const handler = HANDLERS[job.kind];
  if (!handler) return { ok: false, errorKind: "unknown", detail: `모르는 잡 종류: ${job.kind}` };

  const account = job.account ?? {};
  const shotKey = shotKeyFor(job.id);
  const wantHeaded = headed || NEEDS_HEADED.has(job.kind);
  let ctx = null;

  try {
    const plan = job.kind.startsWith("publish.") ? planEditorOps(job.payload ?? {}) : { ops: [], tags: [], stats: { notes: [] } };

    /* 🔴 러너도 고지를 한 번 더 본다(§16B.4 «발행 직전 재검사»는 서버가 하지만, 순서가 틀어지면 여기서 잡힌다).
       고칠 수 있는 자리가 아니므로 **발행하지 않고** 정직하게 돌려보낸다 — 서버가 awaiting_manual 로 남긴다. */
    if (job.kind.startsWith("publish.") && !disclosureIsFirst(plan, job.payload ?? {})) {
      return { ok: false, errorKind: "unknown", detail: "제휴 고지가 본문 첫머리가 아니라 올리지 않았어요(정책)." };
    }

    ctx = await openContext({ chromium }, {
      profileKey: account.profileKey || `job-${job.id}`,
      proxyUrl: account.proxyUrl,
      headed: wantHeaded,
    });
    const applied = await applyCookies(ctx, account.cookies);
    if (applied) log(`  · 저장된 로그인 사용(쿠키 ${applied}개)`);

    const out = await handler.run({ ctx, job, plan, token, shotKey, dryRun });

    if (out?.dryRun) return { ok: true, dryRun: true, notes: out.notes ?? [] };
    if (job.kind.startsWith("publish.")) {
      if (!out?.externalUrl) return { ok: false, errorKind: "unknown", detail: "올리기는 했는데 글 주소를 회수하지 못했어요." };
      return { ok: true, externalUrl: out.externalUrl, channelRef: out.channelRef, notes: out.notes ?? [] };
    }
    if (job.kind === "verify.post_alive" || job.kind === "revenue.stats") {
      return { ok: true, stats: { ...(out?.stats ?? {}), ...(out?.alive === false ? { alive: false } : {}) }, notes: out?.notes ?? [] };
    }
    return { ok: true, notes: out?.notes ?? [] };
  } catch (e) {
    const errorKind = errorKindOf(e);
    const result = { ok: false, errorKind, detail: cleanMsg(e) };
    // 실패 스냅샷은 채널 모듈이 이미 찍었다 — 그 키를 보고에 실어 사람이 화면을 볼 수 있게 한다.
    result.shotKey = shotKey;
    return result;
  } finally {
    if (ctx) { try { await ctx.close(); } catch { /* 무시 */ } }
  }
}

/** 잡 1건을 실행하고 서버에 보고까지. 반환 = 요약 한 줄(로그용). */
export async function processJob({ chromium, token, job, headed, dryRun }) {
  const label = `#${job.id} ${job.kind}${job.account?.handle ? ` @${job.account.handle}` : ""}`;
  log(`▶ ${label}${dryRun ? " (임시저장까지 · 발행 안 함)" : ""}`);
  const result = await runJob({ chromium, token, job, headed, dryRun });

  if (dryRun) {
    /* 🔴 드라이런은 **보고하지 않는다** — 서버 상태를 건드리면 «발행됐다»가 되거나 잡이 소모된다.
       대신 큐에 되돌려 놓는다(release). 카나리는 하트비트로 따로 보고한다. */
    await release(token, job.id, "dry-run(임시저장까지)").catch(() => {});
    log(result.ok ? `  ✓ ${label} 임시저장까지 성공 — 큐에 되돌림` : `  ✗ ${label} ${result.errorKind}: ${result.detail}`);
    return result;
  }

  const r = await report(token, job.id, result);
  if (!r?.ok) log(`  ⚠ ${label} 보고 실패: ${String(r?.error ?? "").slice(0, 80)}`);
  if (result.ok) log(`  ✓ ${label} ${result.externalUrl ?? "완료"}${r?.verified === "unverified" ? " (서버 재확인 미완)" : ""}`);
  else log(`  ✗ ${label} ${result.errorKind}: ${result.detail}${result.shotKey && SHOTS_ON ? ` · 스냅샷 _shots/${result.shotKey}` : ""}`);
  for (const nt of result.notes ?? []) log(`     · ${nt}`);
  return result;
}

/** 한 바퀴 — 집어서 실행하고 보고한다. 반환 = 처리한 건수. */
export async function tick({ chromium, token, kinds, max, headed, dryRun }) {
  const res = await claim(token, kinds ?? ALL_KINDS, max ?? 1);
  if (!res?.ok) { log(`큐를 읽지 못했어요: ${String(res?.error ?? "").slice(0, 90)}`); return 0; }
  const jobs = res.jobs ?? [];
  if (!jobs.length) return 0;
  for (const job of jobs) await processJob({ chromium, token, job, headed, dryRun });
  return jobs.length;
}

/**
 * canary — 자사 테스트 계정으로 «임시저장까지» 드라이런(DESIGN §19).
 *   셀렉터가 바뀌면 **고객보다 먼저** 안다. 결과는 큐가 아니라 **하트비트의 canary 필드**로 보고한다
 *   (운영 알림만 · 고객 화면·계정 상태는 건드리지 않는다).
 */
export async function canary({ chromium, token, headed }) {
  const kinds = ["publish.naver_blog", "publish.tistory"];
  const res = await claim(token, kinds, 1);
  if (!res?.ok) { log(`카나리: 큐를 읽지 못했어요 — ${String(res?.error ?? "").slice(0, 80)}`); return null; }
  const job = (res.jobs ?? [])[0];
  if (!job) {
    log("카나리: 시험할 발행 잡이 없어요(자사 테스트 계정에 예약을 하나 걸어 두세요).");
    await heartbeat(token, { jobs: 0, canary: { ok: null, step: "no_job", detail: "시험할 발행 잡 없음" } }).catch(() => {});
    return null;
  }
  const result = await runJob({ chromium, token, job, headed: headed !== false, dryRun: true });
  await release(token, job.id, "canary(임시저장까지)").catch(() => {});
  await heartbeat(token, {
    jobs: 0,
    canary: {
      ok: !!result.ok,
      channel: String(job.account?.channel ?? ""),
      step: result.ok ? "draft_saved" : String(result.errorKind ?? "unknown"),
      detail: result.ok ? (result.notes ?? []).join(" · ") : String(result.detail ?? ""),
    },
  }).catch(() => {});
  log(result.ok ? "카나리 ✓ 임시저장까지 정상(셀렉터 살아 있음)" : `카나리 ✗ ${result.errorKind}: ${result.detail}`);
  return result;
}
