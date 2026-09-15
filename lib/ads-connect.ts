/**
 * lib/ads-connect.ts — «광고를 실제로 붙인다/뗀다»의 **한 창구**(R8 §3.2 · 2026-09-15 B2).
 *   🔎 출처: AC 신규(계약 P1R8-B2 §3.2 · 생성 커밋 `fa73ce5` 2026-09-15) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *     🔴 AM 의 `ads-*.ts`(구글·메타·네이버 **광고 집행**)와 헷갈리지 마라 — **가져오지 않기로 한 축**이다(CLAUDE §1). 여기는 «우리 글에 광고를 붙인다»다.
 *
 *   🔴 왜 새로 만드나: 부품은 다 있었는데 **문이 없었다.** 전수로 확인한 것:
 *     · `lib/publish/ads.ts`(WP 사이드바 위젯 삽입·되돌리기) — `publish/index.ts` 에서 **export 만 되고 호출 0건**
 *     · `ads.setup_tistory` · `ads.setup_blogger` · `ads.revert_blogger` · `ads.status_blogger`
 *       — 잡 종류·우선순위·**보고 처리**(`runner-jobs.ts:1043·1055`)·러너 채널 4개가 전부 있는데 **적재 0건**
 *     · 화면에는 «신청했어요/승인됐어요» 자기신고 단추만
 *     ⇒ `verify.post_alive` 와 똑같은 모양이다(R7 에서 잡은 그것): **만들어는 뒀는데 부르는 사람이 없다.**
 *
 *   🔴 **채널마다 길이 다르다** — 그걸 호출부가 알 필요는 없다(그래서 이 파일이 있다):
 *     · `wordpress` → 우리가 **직접** 코어 REST 로 위젯을 만든다(즉시 결과)
 *     · `tistory`·`blogger` → **러너 잡**을 적재한다(고객 PC 브라우저가 해야 한다 · 결과는 나중에)
 *     · 그 밖 → **정직하게 막는다**. «곧 될 거니까 되는 척»은 하지 않는다(B3 의 `publishVia: null` 과 같은 규율).
 *
 *   🔴 **되돌리기가 없는 길은 붙이지 않는다.** 티스토리는 러너가 «연결 상태를 읽기만» 한다(`ads-setup-tistory.mjs`
 *      주석: «변경은 안 한다») — 그래서 여기서도 «확인»으로만 말한다. 있지도 않은 되돌리기를 약속하지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { writeAudit } from "./audit";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 그 채널에 광고를 붙이는 방법. `null` = **아직 길이 없다**(되는 척하지 않는다). */
export type AdsWay = "wp_widget" | "runner_tistory" | "runner_blogger" | null;
export type AdsConnectResult =
  | { ok: true; way: Exclude<AdsWay, null>; state: "done" | "queued" | "already" | "removed"; message: string; detail?: string }
  | { ok: false; way: AdsWay; state: "unsupported" | "failed" | "no_account"; message: string; detail?: string };

/** 채널 → 길. 🔴 표에 없으면 `null` 이고, 호출부는 정직하게 막는다. */
export function adsWayOf(channel: string): AdsWay {
  switch (String(channel ?? "")) {
    case "wordpress": return "wp_widget";
    case "tistory": return "runner_tistory";
    case "blogger": return "runner_blogger";
    default: return null;
  }
}

/** 이 채널이 «떼기»를 정말 할 수 있나 — 🔴 **읽기만 하는 길은 뗄 것도 없다**(없는 되돌리기를 약속하지 않는다). */
export function adsRemovable(way: AdsWay): boolean {
  return way === "wp_widget" || way === "runner_blogger";
}

export async function connectAds(tid: number, accountId: number, mode: "connect" | "disconnect"): Promise<AdsConnectResult> {
  const [acc] = await q(sql`SELECT channel, handle FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} LIMIT 1`);
  if (!acc) return { ok: false, way: null, state: "no_account", message: "계정을 찾을 수 없어요." };
  const channel = String(acc.channel ?? "");
  const way = adsWayOf(channel);

  if (!way) {
    return {
      ok: false, way: null, state: "unsupported",
      message: `«${channel}» 은 아직 광고를 자동으로 붙일 수 없어요. 준비되면 이 화면에서 바로 눌러 붙일 수 있어요.`,
    };
  }
  if (mode === "disconnect" && !adsRemovable(way)) {
    /* 🔴 티스토리는 러너가 **상태를 읽기만** 한다(`ads-setup-tistory.mjs` 가 그렇게 만들어져 있다).
       뗄 코드가 없는데 «뗐어요»라고 하면 그게 거짓말이다 — 그래서 여기서 막는다. */
    return {
      ok: false, way, state: "unsupported",
      message: "티스토리 광고는 티스토리 «수익» 설정에서 직접 꺼 주세요. 우리가 대신 끄지는 않아요.",
    };
  }

  // 🔴 import 는 함수 안에서(AC-17 — publish·runner-jobs 를 최상단에서 묶으면 초기화 고리가 엉킨다).
  if (way === "wp_widget") {
    const { insertWordpressAdWidget, removeWordpressAdWidget } = await import("./publish/ads");
    const r = mode === "connect" ? await insertWordpressAdWidget(tid, accountId) : await removeWordpressAdWidget(tid, accountId);
    if (!r.ok) return { ok: false, way, state: "failed", message: r.error, ...(r.detail ? { detail: r.detail } : {}) };
    const state = r.action === "inserted" ? "done" : r.action === "already" ? "already" : r.action === "removed" ? "removed" : "done";
    const message = r.action === "inserted" ? "사이드바에 광고를 넣었어요."
      : r.action === "already" ? "이미 광고가 들어가 있어요."
      : r.action === "removed" ? "광고를 뺐어요. 원래 위젯은 그대로 있어요."
      : "바꿀 것이 없었어요.";
    return { ok: true, way, state, message, ...(r.detail ? { detail: r.detail } : {}) };
  }

  /* 러너 길 — 잡을 적재한다. 🔴 결과는 **나중에** 온다(고객 PC 가 켜져 있어야 한다).
     그래서 «했어요»가 아니라 «내 PC 프로그램이 켜지면 합니다»라고 말한다(거짓 완료 금지 · AC-9). */
  const { enqueueJob } = await import("./runner-jobs");
  const kind = way === "runner_tistory" ? "ads.setup_tistory"
    : mode === "connect" ? "ads.setup_blogger" : "ads.revert_blogger";
  let j: { id: number; created: boolean };
  try {
    j = await enqueueJob({ tenantId: tid, kind, accountId, dedupe: true });
  } catch (e) {
    /* 🔴 `enqueueJob` 은 실패를 **던진다**(`{ok:false}` 를 안 준다) — 삼키면 «눌렀는데 아무 일도 안 일어난다»가 된다. */
    return { ok: false, way, state: "failed", message: "지금은 예약하지 못했어요. 잠시 뒤 다시 눌러 주세요.", detail: String((e as Error)?.message ?? e).slice(0, 160) };
  }
  /* `created:false` = 같은 잡이 **이미 큐에 있다**(멱등). «했어요»가 아니라 «이미 기다리는 중»이라고 말한다 —
     두 번 눌렀을 때 «또 넣었어요»라고 하면 고객이 광고가 두 번 붙는 줄 안다. */
  if (!j.created) {
    return {
      ok: true, way, state: "already",
      message: "이미 예약돼 있어요. 내 PC 프로그램이 켜지면 순서대로 처리할게요.",
    };
  }
  await writeAudit({
    tenantId: tid, action: mode === "connect" ? "ads_connect_queued" : "ads_disconnect_queued", actorType: "user",
    target: `account:${accountId}`, detail: { channel, kind, jobId: j.id, handle: String(acc.handle ?? "") }, riskLevel: "medium",
  });
  return {
    ok: true, way, state: "queued",
    message: way === "runner_tistory"
      ? "내 PC 프로그램이 켜지면 티스토리 광고 연결 상태를 확인할게요."
      : mode === "connect"
        ? "내 PC 프로그램이 켜지면 블로그에 광고를 넣을게요."
        : "내 PC 프로그램이 켜지면 광고를 빼고 원래대로 돌려놓을게요.",
  };
}

/** 화면이 «이 계정에 단추를 보여도 되나»를 묻는 값(A 가 쓴다). */
export function adsConnectable(channel: string): { connect: boolean; disconnect: boolean; way: AdsWay } {
  const way = adsWayOf(channel);
  return { connect: way !== null, disconnect: adsRemovable(way), way };
}

/** 지금 붙어 있나 — `accounts.monetize` 에 남은 흔적으로 본다(모르면 `null`이다 · AC-9). */
export async function adsStateOf(tid: number, accountId: number): Promise<{ attached: boolean | null; at?: string }> {
  const [a] = await q(sql`SELECT monetize FROM accounts WHERE tenant_id = ${tid} AND id = ${n(accountId)} LIMIT 1`);
  const m = (a?.monetize && typeof a.monetize === "object" ? a.monetize : {}) as Record<string, unknown>;
  const wp = (m.wpAdWidget && typeof m.wpAdWidget === "object" ? m.wpAdWidget : null) as { widgetId?: string; insertedAt?: string } | null;
  if (wp?.widgetId) return { attached: true, ...(wp.insertedAt ? { at: String(wp.insertedAt) } : {}) };
  if (m.adsenseInserted === true) return { attached: true };
  if (m.adsenseInserted === false || wp === null) return { attached: null };   // 🔴 «흔적이 없다» ≠ «안 붙었다»
  return { attached: null };
}
