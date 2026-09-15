/**
 * runner/core.mjs — 큐 소비 루프(claim → 실행 → report) · 잡 라우팅 · 카나리.
 *   AM 원본: ../AutoMarketing/scripts/content-runner-core.mjs(루프·세션·보고 관례 이식 2026-09-14).
 *
 *   🔴 AC-3 — **잡 1건 = 컨텍스트 1개**. 계정 프로필 폴더는 영구(쿠키 유지)지만 컨텍스트는 매번 새로 열고 닫는다.
 *      재사용하면 앞 계정 세션이 남아 «다른 계정에 글이 올라간다».
 *   🔴 실패는 **정직 분류**다(계약 §2 RunnerErrorKind). 못 했으면 못 했다고 보고한다 — «성공»으로 만들지 않는다.
 */
import { claim, report, release, heartbeat } from "./lib/api.mjs";
import { openContext, applyCookies, exitIp, meterContext, shotKeyFor, SHOTS_ON } from "./lib/browser.mjs";
import { planEditorOps, disclosureIsFirst } from "./lib/plan.mjs";

import * as naverBlog from "./channels/naver-blog.mjs";
import * as tistory from "./channels/tistory.mjs";
import * as sessionLogin from "./channels/session-login.mjs";
import * as postAlive from "./channels/post-alive.mjs";
// [R8 §3 · DESIGN §5E] 올린 글 내리기 — 고객이 «내려 줘»를 눌렀을 때만 온다.
import * as retract from "./channels/retract.mjs";
import * as revenueAdpost from "./channels/revenue-adpost.mjs";
import * as revenueAdfit from "./channels/revenue-adfit.mjs";
import * as revenueClip from "./channels/revenue-clip.mjs";
import * as adsSetupTistory from "./channels/ads-setup-tistory.mjs";
import * as adsStatusBlogger from "./channels/ads-status-blogger.mjs";
import * as adsSetupBlogger from "./channels/ads-setup-blogger.mjs";
// P1R5 §2.2 — 영상 렌더 · 네이버 클립 스텁(AC-18: 채널은 **정적 import** 목록에만 둔다).
import * as renderVideo from "./channels/render-video.mjs";
import * as naverClip from "./channels/naver-clip.mjs";

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
  "publish.retract": retract,
  "revenue.stats": postAlive,
  // P1R3 §2.1 수익 스크랩 3종 · §2.2 광고 상태 읽기 2종
  "revenue.adpost": revenueAdpost,
  "revenue.adfit": revenueAdfit,
  "revenue.clip": revenueClip,
  "ads.setup_tistory": adsSetupTistory,
  "ads.status_blogger": adsStatusBlogger,
  // P1R4 §2.2 블로거 광고 삽입/복원(쓰기 · 한 모듈이 kind 로 분기)
  "ads.setup_blogger": adsSetupBlogger,
  "ads.revert_blogger": adsSetupBlogger,
  // P1R5 §2.2·§2.3
  "render.video": renderVideo,
  "publish.naver_clip": naverClip,
};

/** 영상 렌더 잡 — report 에 `render`(mp4 키·길이·바이트)를 싣는다. */
const RENDER_KINDS = new Set(["render.video"]);

/**
 * 이 PC 가 **집어도 되는** 잡 종류(계약 §2.2).
 *   🔴 ffmpeg 가 없으면 `render.video` 를 **claim 하지 않는다** — 집어 놓고 실패하면 그 글은 재시도만 쌓이고
 *      다른 러너(ffmpeg 있는 PC)도 못 가져간다. 대신 하트비트 `caps.ffmpeg:false` 로 알려 화면이 «ffmpeg 없음»을 띄운다.
 */
export function claimableKinds() {
  const ok = renderVideo.caps().ffmpeg;
  return ALL_KINDS.filter((k) => ok || !RENDER_KINDS.has(k));
}

/** 하트비트에 실을 이 PC 의 능력(§2.4) — 지금은 ffmpeg 유무·버전. */
export function runnerCaps() {
  return renderVideo.caps();
}
/** 수익 스크랩 잡 — report 에 `revenueRows` 를 싣는다(서버가 upsert · 러너는 DB 를 안 본다). */
const REVENUE_KINDS = new Set(["revenue.adpost", "revenue.adfit", "revenue.clip"]);
/** 광고 상태 «읽기» — report 에 `adsense` 를 싣는다. */
const ADS_KINDS = new Set(["ads.setup_tistory", "ads.status_blogger"]);
/** 광고 «쓰기»(블로거 템플릿 삽입/복원) — report 에 `monetize`(백업 원문 포함)를 싣는다. */
const ADS_WRITE_KINDS = new Set(["ads.setup_blogger", "ads.revert_blogger"]);

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
export async function runJob(args) {
  /* 🔴 실제로 나간 IP 는 **성공이든 실패든** 보고돼야 한다(계약 §2.5-4) — 서버가 `accounts.last_exit_ip` 에 적고
     «두 계정이 같은 IP» 를 운영에 경고한다. 반환 지점이 여러 곳이라, 한 군데서 얹도록 감싼다
     (반환마다 손으로 붙이면 언젠가 하나를 빠뜨리고, 그러면 그 계정만 조용히 기록이 빈다). */
  const seen = { ip: null, bytes: null };
  const r = await runJobInner(args, seen);
  return { ...r, ...(seen.ip ? { exitIp: seen.ip } : {}), ...(seen.bytes ? { bytes: seen.bytes } : {}) };
}

async function runJobInner({ chromium, token, job, headed, dryRun }, seen) {
  const handler = HANDLERS[job.kind];
  if (!handler) return { ok: false, errorKind: "unknown", detail: `모르는 잡 종류: ${job.kind}` };

  const account = job.account ?? {};
  const shotKey = shotKeyFor(job.id);
  const wantHeaded = headed || NEEDS_HEADED.has(job.kind);
  let ctx = null;
  let meter = null;                          // 이 잡이 쓴 트래픽(프록시 GB 원가 산정 · finally 에서 걷는다)

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
    /* 이 잡이 쓴 트래픽을 센다(프록시 GB 과금 원가 산정 · 계약 §2.5 원가표).
       🔴 **IP 확인보다 먼저 붙인다** — 그래야 확인에 쓴 바이트도 같이 세어 «잡 1건의 진짜 비용»이 된다. */
    meter = meterContext(ctx);
    /* 🔴 프록시를 배정받은 계정이면 **나가는 IP 를 잡 시작 때 한 번 확인한다**(계약 P1R7 §2.5-4).
       «프록시를 걸었다»와 «그 IP 로 나간다»는 다르다 — 프록시가 죽으면 우리는 프록시를 쓴다고 믿으면서
       집 IP 로 계정을 굴리게 되고, 그게 사장님이 걱정하는 연좌제를 **우리도 모르게** 만든다.
       🔴 판정은 3값이다(AC-9): 기대와 **다르면 중단** · **모르면**(네트워크 문제) 그냥 진행하고 기록만.
          «못 읽었다»를 «틀렸다»로 바꾸면 인터넷이 잠깐 나쁜 날 전 계정 발행이 멈춘다. */
    if (account.proxyUrl) {
      const ip = await exitIp(ctx);
      if (!ip) {
        log("  · 나가는 IP 를 확인하지 못했어요(그대로 진행합니다)");
      } else if (account.expectExitIp && ip !== account.expectExitIp) {
        /* 🔴 B 의 전이표(7종)를 **넓히지 않는다** — 그 표는 `lib/account-health.ts` 한 벌뿐이고 B 소유다.
           대신 이미 있는 선례를 따른다: `"parse"` 처럼 **표 밖 kind**(계정 전이 0 · 우리 문제 · 감사 high).
           계정 잘못이 아니고(상태를 바꾸면 고객에게 «다시 로그인»을 시키게 된다) 채널이 바뀐 것도 아니다 —
           **우리 프록시가 죽은 것**이라 고칠 사람은 우리다. */
        return { ok: false, errorKind: "proxy",
          detail: `배정된 IP(${account.expectExitIp}) 가 아니라 ${ip} 로 나가고 있어요 — 다른 계정과 묶이지 않도록 멈췄어요.` };
      } else {
        seen.ip = ip;
        log(`  · 나가는 IP ${ip}`);
      }
    }

    const applied = await applyCookies(ctx, account.cookies);
    if (applied) log(`  · 저장된 로그인 사용(쿠키 ${applied}개)`);

    const out = await handler.run({ ctx, job, plan, token, shotKey, dryRun });

    // 🔴 shotKey 를 함께 돌려준다 — 카나리가 이 키를 하트비트에 실어야 운영이 «깨진 화면»을 찾아간다(없으면 canary_runs.shot_key 가 늘 비었다).
    if (out?.dryRun) return { ok: true, dryRun: true, shotKey, notes: out.notes ?? [] };
    /* 🔴 **`publish.retract` 는 `publish.` 로 시작한다** — 아래 발행 분기보다 **먼저** 가른다.
       안 그러면 «올리기는 했는데 글 주소를 회수하지 못했어요»라는 엉뚱한 실패가 난다(내리는 잡에 외부 주소가 있을 리 없다).
       접두사로 종류를 가르는 코드에 새 잡을 끼울 때 늘 생기는 함정이라 여기 적어 둔다. */
    if (job.kind === "publish.retract") {
      return { ok: true, stats: { ...(out?.retract ?? {}) }, shotKey, notes: out?.notes ?? [] };
    }
    if (job.kind.startsWith("publish.")) {
      if (!out?.externalUrl) return { ok: false, errorKind: "unknown", detail: "올리기는 했는데 글 주소를 회수하지 못했어요." };
      return { ok: true, externalUrl: out.externalUrl, channelRef: out.channelRef, notes: out.notes ?? [] };
    }
    if (REVENUE_KINDS.has(job.kind)) {
      /* 🔴 행 0개도 성공이다(미가입·미등록 = 정직한 «없음»). 0원 행을 지어내지 않는다(AC-9). */
      const rows = Array.isArray(out?.revenueRows) ? out.revenueRows : [];
      return { ok: true, revenueRows: rows, ...(out?.adpostState ? { adpostState: out.adpostState } : {}), shotKey, notes: out?.notes ?? [] };
    }
    if (ADS_KINDS.has(job.kind)) {
      return { ok: true, adsense: out?.adsense ?? { linked: false, state: "unknown" }, shotKey, notes: out?.notes ?? [] };
    }
    if (RENDER_KINDS.has(job.kind)) {
      /* 🔴 «구웠다»는 말만으로는 성공이 아니다 — key 가 없으면 실패로 돌려보낸다.
         서버는 여기 더해 **R2 HEAD 로 실존까지** 확인한다(계약 §2.1 · 러너 주장 불신). */
      if (!out?.render?.key) return { ok: false, errorKind: "encode", detail: "영상을 구웠다는데 파일 키가 없어요.", shotKey };
      return { ok: true, render: out.render, shotKey, notes: out.notes ?? [] };
    }
    if (ADS_WRITE_KINDS.has(job.kind)) {
      // 🔴 monetize.bloggerTemplateBackup(원문)을 그대로 실어 보낸다 — 서버가 accounts.monetize 에 저장(복원 재료 · §5 경계).
      return { ok: true, monetize: out?.monetize ?? {}, shotKey, notes: out?.notes ?? [] };
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
    /* 🔴 컨텍스트를 닫기 **전에** 계측값을 걷는다(닫으면 CDP 세션이 사라진다).
       성공·실패·예외 어느 길로 나가도 여기를 지나므로, «실패한 잡의 트래픽»도 빠짐없이 센다 —
       실패가 오히려 더 많이 쓰는 경우(재시도·타임아웃)가 있어서 그쪽이 원가에는 더 중요하다. */
    if (meter?.attached) {
      seen.bytes = { rx: meter.rx, tx: meter.tx, requests: meter.requests };
      log(`  · 이 잡이 쓴 트래픽 ↓${(meter.rx / 1048576).toFixed(2)}MB ↑${(meter.tx / 1048576).toFixed(2)}MB (요청 ${meter.requests}건)`);
    }
    if (ctx) { try { await ctx.close(); } catch { /* 무시 */ } }
  }
}

/** 잡 1건을 실행하고 서버에 보고까지. 반환 = 요약 한 줄(로그용). */
export async function processJob({ chromium, token, job, headed, dryRun }) {
  // handle 은 이미 «@» 로 시작할 때가 많다(계정 등록 화면이 @ 를 붙여 받는다) → 붙이지 말고 **없을 때만** 붙인다(«@@r7walk» 실측).
  const handle = String(job.account?.handle ?? "").trim();
  const label = `#${job.id} ${job.kind}${handle ? ` ${handle.startsWith("@") ? handle : `@${handle}`}` : ""}`;
  log(`▶ ${label}${dryRun ? " (임시저장까지 · 발행 안 함)" : ""}`);
  const result = await runJob({ chromium, token, job, headed, dryRun });

  if (dryRun) {
    /* 🔴 드라이런은 **보고하지 않는다** — 서버 상태를 건드리면 «발행됐다»가 되거나 잡이 소모된다.
       대신 큐에 되돌려 놓는다(release). 카나리는 하트비트로 따로 보고한다. */
    await release(token, job.id, "dry-run(임시저장까지)").catch(() => {});
    const what = REVENUE_KINDS.has(job.kind)
      ? `수익 ${result.revenueRows?.length ?? 0}행${result.adpostState ? ` · 상태 ${result.adpostState}` : ""} 읽음(서버에 안 보냄)`
      : ADS_KINDS.has(job.kind) ? `광고 상태 ${result.adsense?.state ?? "?"} 읽음(서버에 안 보냄)` : "임시저장까지 성공";
    log(result.ok ? `  ✓ ${label} ${what} — 큐에 되돌림` : `  ✗ ${label} ${result.errorKind}: ${result.detail}`);
    /* 🔴 드라이런에서도 notes 를 찍는다. 종전엔 발행 경로에서만 찍어서, **폴백이 몇 건 났는지**를
       검증에서 볼 수 없었다 — «성공»만 보고 서식이 깎인 걸 놓친다(2026-09-14 실측: 소제목 크기 미적용을
       스냅샷을 눈으로 보고서야 알았다). 검증은 폴백 건수를 숫자로 봐야 한다. */
    for (const nt of result.notes ?? []) log(`     · ${nt}`);
    return result;
  }

  const r = await report(token, job.id, result);
  if (!r?.ok) log(`  ⚠ ${label} 보고 실패: ${String(r?.error ?? "").slice(0, 80)}`);
  if (result.ok) log(`  ✓ ${label} ${result.externalUrl ?? "완료"}${r?.verified === "unverified" ? " (서버 재확인 미완)" : ""}`);
  else log(`  ✗ ${label} ${result.errorKind}: ${result.detail}${result.shotKey && SHOTS_ON ? ` · 스냅샷 _shots/${result.shotKey}` : ""}`);
  for (const nt of result.notes ?? []) log(`     · ${nt}`);
  return result;
}

/**
 * 한 바퀴 — 집어서 실행하고 보고한다.
 * @returns `{ count, results }` — 🔴 **결과를 돌려준다**(종전엔 건수만 줘서, 드라이런 실패를
 *   검증 하니스가 «잡이 queued 니까 성공»으로 읽고 **실패에 ✓ 를 찍었다** · 2026-09-14 실측).
 *   드라이런은 release 로 되돌리므로 잡 행만 보면 성공·실패가 구분되지 않는다 — 판정은 이 결과로 한다.
 */
export async function tick({ chromium, token, kinds, max, headed, dryRun }) {
  const res = await claim(token, kinds ?? ALL_KINDS, max ?? 1);
  if (!res?.ok) { log(`큐를 읽지 못했어요: ${String(res?.error ?? "").slice(0, 90)}`); return { count: 0, results: [] }; }
  const jobs = res.jobs ?? [];
  if (!jobs.length) return { count: 0, results: [] };
  const results = [];
  for (const job of jobs) results.push(await processJob({ chromium, token, job, headed, dryRun }));
  return { count: jobs.length, results };
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
  /* 🔴 AC-9 세 값. 성공=true. 실패라도 **셀렉터 문제만** false 로 본다 —
     로그인/세션/네트워크 실패는 «판정 불가(null)»다(예: 티스토리 세션 없음). 안 그러면 크론이 매일 «티스토리 down» 오경보를 낸다. */
  const UNKNOWN = new Set(["login_fail", "session_expired", "network", "no_job"]);
  const ok = result.ok ? true : UNKNOWN.has(String(result.errorKind ?? "")) ? null : false;
  await heartbeat(token, {
    jobs: 0,
    canary: {
      ok,
      channel: String(job.account?.channel ?? ""),
      step: result.ok ? "draft_saved" : String(result.errorKind ?? "unknown"),
      detail: result.ok ? (result.notes ?? []).join(" · ") : String(result.detail ?? ""),
      // 🔴 실패했을 때 «어느 화면에서 깨졌나»를 운영이 바로 열 수 있게(ops-canary·down 제안 감사에 그대로 실린다).
      shotKey: result.shotKey ?? null,
    },
  }).catch(() => {});
  log(result.ok ? "카나리 ✓ 임시저장까지 정상(셀렉터 살아 있음)" : ok === null ? `카나리 · 판정 불가(${result.errorKind}) — 셀렉터 아님` : `카나리 ✗ ${result.errorKind}: ${result.detail}`);
  return result;
}
