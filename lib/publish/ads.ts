/**
 * lib/publish/ads.ts — 워드프레스 광고 위젯 삽입/되돌리기(계약 P1R3 v3.4 §2.2 · DESIGN §9.0 애드센스).
 *   AC 신규 2026-09-14(B2).
 *
 *   길: 코어 REST `wp/v2/widgets`(WP 5.8+) 로 **사이드바에 광고 위젯**을 만든다. 테마 파일은 건드리지 않는다(코어 REST 에 없다 · 플러그인 영역).
 *   🔴 되돌리기 가능이 원칙 — 삽입 전 **원래 사이드바 위젯 목록을 통째로 백업**(`accounts.monetize.wpAdWidget`)하고,
 *      되돌리기는 우리가 만든 위젯 id 를 `DELETE wp/v2/widgets/{id}?force=true` 한다. 남의 위젯은 절대 지우지 않는다.
 *   🔴 멱등 — 같은 계정에 이미 우리 위젯이 살아 있으면 다시 만들지 않는다(같은 광고가 두 번 뜨면 애드센스 정책 위반).
 *   🔴 애드센스 키가 없으면 아무것도 안 만든다(빈 광고 자리를 남기지 않는다).
 *   블로거는 여기 없다 — Blogger API v3 에 템플릿 리소스가 없다(계약 v3.4 정정). 블로거·티스토리는 글 단위 `.ad-slot` 실체화(gate.ts).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { writeAudit } from "../audit";
import { loadWpCreds } from "./tokens";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const TIMEOUT_MS = 20_000;

export type AdsResult =
  | { ok: true; action: "inserted" | "already" | "removed" | "nothing"; widgetId?: string; sidebar?: string; detail?: string }
  | { ok: false; reason: "no_creds" | "no_adsense" | "auth_failed" | "unsupported" | "channel_error" | "network"; error: string; detail?: string };

function basicAuth(loginId: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${loginId}:${String(appPassword).replace(/\s+/g, "")}`, "utf8").toString("base64")}`;
}
async function wp(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let json: any = null; try { json = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/** 애드센스 유닛 HTML(gate.ts materializeAdsense 와 같은 모양 · «광고» 라벨 포함 · §16B.3). */
export function adsenseWidgetHtml(pub: string): string {
  return `<div class="adsense"><span class="ad-label">광고</span>`
    + `<ins class="adsbygoogle" style="display:block" data-ad-client="${pub}" data-ad-format="auto" data-full-width-responsive="true"></ins>`
    + `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(pub)}" crossorigin="anonymous"></script>`
    + `<script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
}

interface WidgetBackup { widgetId: string; sidebar: string; before: unknown[]; insertedAt: string }

async function loadAccount(tid: number, accountId: number): Promise<{ channel: string; monetize: Record<string, unknown> } | null> {
  const [a] = await q(sql`SELECT channel, monetize FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} LIMIT 1`);
  if (!a) return null;
  return { channel: String(a.channel ?? ""), monetize: (a.monetize && typeof a.monetize === "object" ? a.monetize : {}) as Record<string, unknown> };
}

/**
 * insertWordpressAdWidget — 사이드바 첫 자리에 애드센스 위젯 1개. 이미 있으면 already.
 *   백업: 삽입 직전 그 사이드바의 위젯 id 목록 + 우리 위젯 id → accounts.monetize.wpAdWidget(되돌리기 재료).
 */
export async function insertWordpressAdWidget(tid: number, accountId: number): Promise<AdsResult> {
  const acc = await loadAccount(tid, accountId);
  if (!acc) return { ok: false, reason: "no_creds", error: "계정을 찾을 수 없어요." };
  if (acc.channel !== "wordpress") return { ok: false, reason: "unsupported", error: "워드프레스 계정에만 위젯을 넣을 수 있어요." };
  const pub = String(acc.monetize.adsensePub ?? "").trim();
  if (!pub) return { ok: false, reason: "no_adsense", error: "애드센스 게시자 ID(ca-pub-…)를 먼저 등록해 주세요." };
  const existing = acc.monetize.wpAdWidget as WidgetBackup | undefined;
  const creds = await loadWpCreds(accountId);
  if (!creds) return { ok: false, reason: "no_creds", error: "워드프레스 로그인 정보가 없어요. 계정을 다시 연결해 주세요." };
  const auth = basicAuth(creds.loginId, creds.appPassword);

  try {
    // 멱등 — 우리가 만든 위젯이 아직 살아 있나.
    if (existing?.widgetId) {
      const cur = await wp(`${creds.siteUrl}/wp-json/wp/v2/widgets/${encodeURIComponent(existing.widgetId)}`, { headers: { Authorization: auth } });
      if (cur.status === 200) return { ok: true, action: "already", widgetId: existing.widgetId, sidebar: existing.sidebar };
      // 지워졌으면 아래에서 새로 만든다(백업은 갱신).
    }
    // 사이드바 목록 → 첫 «등록된» 사이드바(wp_inactive_widgets 제외)
    const sbs = await wp(`${creds.siteUrl}/wp-json/wp/v2/sidebars`, { headers: { Authorization: auth } });
    if (sbs.status === 401 || sbs.status === 403) return { ok: false, reason: "auth_failed", error: "워드프레스 로그인 정보를 확인해 주세요(앱 비밀번호).", detail: `sidebars_${sbs.status}` };
    if (sbs.status < 200 || sbs.status >= 300 || !Array.isArray(sbs.json)) return { ok: false, reason: "channel_error", error: "사이드바 목록을 읽지 못했어요(위젯 API 미지원 테마일 수 있어요).", detail: `sidebars_${sbs.status}` };
    const sidebar = (sbs.json as any[]).find((s) => s?.id && s.id !== "wp_inactive_widgets" && s.status !== "inactive") ?? (sbs.json as any[]).find((s) => s?.id && s.id !== "wp_inactive_widgets");
    if (!sidebar?.id) return { ok: false, reason: "channel_error", error: "위젯을 넣을 사이드바가 없어요(테마에 위젯 영역이 없어요)." };
    const before: unknown[] = Array.isArray(sidebar.widgets) ? sidebar.widgets : [];

    // 위젯 생성 — custom_html(클래식) 우선, 없으면 block 위젯.
    const html = adsenseWidgetHtml(pub);
    let made = await wp(`${creds.siteUrl}/wp-json/wp/v2/widgets`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ id_base: "custom_html", sidebar: sidebar.id, instance: { raw: { title: "", content: html } } }),
    });
    if (made.status < 200 || made.status >= 300) {
      made = await wp(`${creds.siteUrl}/wp-json/wp/v2/widgets`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ id_base: "block", sidebar: sidebar.id, instance: { raw: { content: `<!-- wp:html -->${html}<!-- /wp:html -->` } } }),
      });
    }
    if (made.status === 401 || made.status === 403) return { ok: false, reason: "auth_failed", error: "위젯을 만들 권한이 없어요(관리자 계정의 앱 비밀번호가 필요해요).", detail: `widgets_${made.status}` };
    const widgetId = String(made.json?.id ?? "").trim();
    if (made.status < 200 || made.status >= 300 || !widgetId) return { ok: false, reason: "channel_error", error: "위젯을 만들지 못했어요.", detail: `widgets_${made.status} ${String(made.json?.message ?? "").slice(0, 100)}` };

    // 백업 저장(되돌리기 재료) — 사이드바 «원래 목록» + 우리 위젯 id.
    const backup: WidgetBackup = { widgetId, sidebar: String(sidebar.id), before, insertedAt: new Date().toISOString() };
    await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ wpAdWidget: backup })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
    await writeAudit({ tenantId: tid, action: "ads_widget_inserted", actorType: "system", target: `account:${accountId}`, detail: { widgetId, sidebar: sidebar.id, beforeCount: before.length }, riskLevel: "medium" });
    return { ok: true, action: "inserted", widgetId, sidebar: String(sidebar.id) };
  } catch (e) {
    return { ok: false, reason: "network", error: "워드프레스에 연결하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** removeWordpressAdWidget — 우리가 만든 위젯만 지운다(백업의 id). 남의 위젯은 건드리지 않는다. */
export async function removeWordpressAdWidget(tid: number, accountId: number): Promise<AdsResult> {
  const acc = await loadAccount(tid, accountId);
  if (!acc) return { ok: false, reason: "no_creds", error: "계정을 찾을 수 없어요." };
  const backup = acc.monetize.wpAdWidget as WidgetBackup | undefined;
  if (!backup?.widgetId) return { ok: true, action: "nothing", detail: "넣은 위젯이 없어요." };
  const creds = await loadWpCreds(accountId);
  if (!creds) return { ok: false, reason: "no_creds", error: "워드프레스 로그인 정보가 없어요." };
  try {
    const del = await wp(`${creds.siteUrl}/wp-json/wp/v2/widgets/${encodeURIComponent(backup.widgetId)}?force=true`, { method: "DELETE", headers: { Authorization: basicAuth(creds.loginId, creds.appPassword) } });
    if (del.status === 401 || del.status === 403) return { ok: false, reason: "auth_failed", error: "위젯을 지울 권한이 없어요.", detail: `delete_${del.status}` };
    if (del.status !== 404 && (del.status < 200 || del.status >= 300)) return { ok: false, reason: "channel_error", error: "위젯을 지우지 못했어요.", detail: `delete_${del.status}` };
    await q(sql`UPDATE accounts SET monetize = monetize - 'wpAdWidget', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
    await writeAudit({ tenantId: tid, action: "ads_widget_removed", actorType: "system", target: `account:${accountId}`, detail: { widgetId: backup.widgetId, sidebar: backup.sidebar, wasGone: del.status === 404 }, riskLevel: "medium" });
    return { ok: true, action: "removed", widgetId: backup.widgetId, sidebar: backup.sidebar };
  } catch (e) {
    return { ok: false, reason: "network", error: "워드프레스에 연결하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
