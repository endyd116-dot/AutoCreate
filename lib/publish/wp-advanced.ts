/**
 * lib/publish/wp-advanced.ts — [R12-9 · 설계 R12 §8 · B · 2026-09-17] **워드프레스 «고급» 둘**: 사이드바 위젯 · 구조화 데이터 한 겹 더.
 *   AC 신규 2026-09-17(B). 🔎 출처: AC 신규 — AM 원본 없음.
 *
 *   ══ 🔴 왜 워드프레스에만 있나 ══
 *     `lib/publish/seo.ts` 머리말이 이미 답을 적어 뒀다: **머리말·사이트 구조를 만질 수 있는 채널이 둘뿐**이다(워드프레스·블로거).
 *     네이버·티스토리는 러너가 **에디터로 타자**를 쳐서 사이트 구조를 건드릴 자리가 아예 없다.
 *     ⇒ 이건 **선택**이지 «모든 채널이 갖춰야 할 것»이 아니다. 없는 채널은 없는 게 맞는 상태다(게이트로 만들지 않는다 · CLAUDE §9).
 *
 *   ══ 🔴 이 파일이 지키는 것 셋 ══
 *     ① **막지 않는다.** 위젯을 못 꽂아도, 구조화 데이터가 지워져도 **글은 나간다.** 실패는 감사에만 남는다(§9).
 *     ② **지어내지 않는다.** 사이트 이름을 못 읽으면 `publisher` 를 **안 넣는다**(빈 이름을 넣지 않는다 · AC-9).
 *        구글은 빈 `publisher.name` 을 «불일치»로 보고 통째로 무시한다 — 안 넣는 것이 넣는 시늉보다 낫다.
 *     ③ **구글이 살아 있다고 말한 것만 쓴다.** `BreadcrumbList` 는 지금도 지원된다. 🔴 `FAQPage`·`HowTo` 는 **쓰지 않는다**
 *        (2023·2025 에 각각 지원 중단 — `seo.ts` 머리말에 근거가 있다). 다음 사람이 «빠졌네» 하고 넣지 않도록 여기에도 적는다.
 */
import type { PublishPiece } from "./contract";

/* ─────────────────────────── ① 구조화 데이터 한 겹 더 ─────────────────────────── */

export interface WpSiteInfo {
  /** 사이트 이름(`GET {site}/wp-json` 의 `name`). 🔴 **못 읽으면 undefined** — 빈 문자열로 만들지 않는다. */
  name?: string;
  /** 사이트 홈 주소(`{site}` 그대로). BreadcrumbList 의 첫 마디. */
  home: string;
}

/**
 * breadcrumbJsonLd — 🔴 «홈 → 이 글» **두 마디**만 만든다(순수).
 *   왜 두 마디뿐인가: 우리는 고객 사이트의 **카테고리를 모른다.** 세 마디로 만들려면 «어느 분류인가»를 지어내야 하고
 *   그건 구조화 데이터에서 제일 나쁜 종류의 거짓말이다(검색 결과에 **없는 분류**가 뜬다).
 *   🔴 `item`(주소)은 **홈만** 넣는다 — 글 주소는 발행 **뒤에야** 생기는데 JSON-LD 는 본문에 **미리** 실린다.
 *      마지막 마디에 `item` 을 빼는 것은 구글이 권장하는 모양이다(현재 페이지는 주소를 안 적는다).
 *   못 만들면 `null` — 호출부가 통째로 뺀다.
 */
export function breadcrumbJsonLd(piece: PublishPiece, site: WpSiteInfo): Record<string, unknown> | null {
  const home = String(site.home || "").trim().replace(/\/+$/, "");
  const title = String(piece.title || "").trim();
  if (!/^https?:\/\//i.test(home) || !title) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: site.name?.trim() || "홈", item: home },
      { "@type": "ListItem", position: 2, name: title.slice(0, 110) },
    ],
  };
}

/**
 * publisherOf — Article 의 `publisher`. 🔴 **사이트 이름을 못 읽으면 `null`**(빈 이름을 넣지 않는다 · AC-9).
 *   `logo` 는 넣지 않는다 — 고객 사이트 로고 주소를 **우리가 모른다.** 추측한 주소를 넣으면 깨진 그림이 구조화 데이터에 박힌다.
 */
export function publisherOf(site: WpSiteInfo): Record<string, unknown> | null {
  const name = String(site.name ?? "").trim();
  return name ? { "@type": "Organization", name: name.slice(0, 80) } : null;
}

/** JSON-LD 한 덩이를 본문 끝 `<script>` 로 — `seo.ts articleJsonLdScript` 와 **같은 이스케이프 규율**(`</` 를 막는다). */
export function jsonLdScript(ld: Record<string, unknown> | null): string {
  if (!ld) return "";
  return `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/<\//g, "<\\/")}</script>`;
}

/* ─────────────────────────── ② 사이드바 위젯 ─────────────────────────── */

/**
 * 🔴 **무엇을 꽂나** — «최근 글»(`core/latest-posts`) 한 덩이. 우리가 올린 글들이 **서로 이어지게** 하는 내부 링크다
 *   (DESIGN §518 이 «내부 링크»를 🟢 로 꼽았다 — 우리가 쓸 수 있는 몇 안 되는 실효 수단이다).
 *   🔴 **광고·추적을 꽂지 않는다.** 남의 사이트에 우리가 넣는 것은 «그 사이트에 도움이 되는 것»뿐이다.
 */
export const WP_WIDGET_TITLE = "최근 글";
export const WP_WIDGET_INSTANCE = { className: "ac-latest-posts", postsToShow: 5, displayPostDate: true } as const;

/** 위젯 하나가 우리 것인가 — 🔴 `className` 도장으로 가른다(제목은 고객이 바꿀 수 있다). 이게 **멱등의 근거**다. */
export function isOurWidget(w: unknown): boolean {
  const o = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
  if (String(o.id_base ?? "") === "block" || String(o.idBase ?? "") === "block") {
    const inst = ((o.instance as Record<string, unknown>)?.raw ?? {}) as Record<string, unknown>;
    return String(inst.content ?? "").includes(WP_WIDGET_INSTANCE.className);
  }
  return String((o as { rendered?: unknown }).rendered ?? "").includes(WP_WIDGET_INSTANCE.className);
}

/** 우리가 꽂을 블록 마크업 — 워드프레스 5.8+ 는 위젯이 **블록**이다. */
export function widgetBlockHtml(): string {
  const a = WP_WIDGET_INSTANCE;
  return `<!-- wp:heading {"level":3} --><h3>${WP_WIDGET_TITLE}</h3><!-- /wp:heading -->`
    + `<!-- wp:latest-posts {"postsToShow":${a.postsToShow},"displayPostDate":${a.displayPostDate},"className":"${a.className}"} -->`
    + `<!-- /wp:latest-posts -->`;
}

export type WidgetOutcome =
  | { ok: true; already: true }
  | { ok: true; already: false; widgetId: string }
  /** 🔴 **실패해도 글은 나간다.** `why` 는 감사에 남길 사람말이다(화면에 안 나간다). */
  | { ok: false; why: string };

/**
 * ensureLatestPostsWidget — 사이드바에 «최근 글»을 **한 번만** 꽂는다.
 *   🔴 **멱등**: 이미 우리 도장(`className`)이 있으면 아무것도 안 한다. 두 번 꽂으면 고객 사이드바에 같은 위젯이 둘이 된다.
 *   🔴 **워드프레스 5.8 미만은 이 API 자체가 없다**(404) — 그건 «고장»이 아니라 **없는 길**이다(CLAUDE §9 «이 규칙 밖»). 조용히 넘어간다.
 *   🔴 **권한이 없어도**(403) 넘어간다 — 앱 비밀번호 사용자가 `edit_theme_options` 를 못 가진 집이 흔하다.
 *   `fetchJson` 을 주입받는 까닭: 이 파일을 **네트워크 없이** 하니스에서 돌리기 위해서다(AC-99 ⑩ «있나»가 아니라 «도나»).
 */
export async function ensureLatestPostsWidget(
  site: string, auth: string,
  fetchJson: (url: string, init: RequestInit) => Promise<{ status: number; json: any }>,
): Promise<WidgetOutcome> {
  const base = String(site || "").replace(/\/+$/, "");
  let sidebars: any;
  try {
    const r = await fetchJson(`${base}/wp-json/wp/v2/sidebars`, { method: "GET", headers: { Authorization: auth } });
    if (r.status === 404) return { ok: false, why: "이 워드프레스에는 위젯 API 가 없어요(5.8 미만) — 사이드바는 그대로 둡니다." };
    if (r.status === 401 || r.status === 403) return { ok: false, why: "사이드바를 바꿀 권한이 없어요 — 글은 그대로 올라갑니다." };
    if (r.status < 200 || r.status >= 300) return { ok: false, why: `사이드바를 읽지 못했어요(http_${r.status}).` };
    sidebars = r.json;
  } catch (e) { return { ok: false, why: `사이드바를 읽지 못했어요(${String((e as Error)?.message ?? e).slice(0, 60)}).` }; }

  const list = Array.isArray(sidebars) ? sidebars : [];
  /* 🔴 `wp_inactive_widgets`(비활성 보관함)에는 꽂지 않는다 — 꽂아도 아무 데도 안 보인다. */
  const target = list.find((s: any) => String(s?.id ?? "") && String(s.id) !== "wp_inactive_widgets");
  if (!target) return { ok: false, why: "이 테마에는 사이드바가 없어요 — 글은 그대로 올라갑니다." };
  if ((target.widgets ?? []).length && Array.isArray(target.widgets)) {
    /* 목록이 id 문자열만 줄 수도 있어 본문을 한 번 더 확인한다. 못 읽으면 **꽂지 않는다**(두 번 꽂는 것보다 안 꽂는 쪽이 낫다). */
    try {
      const r = await fetchJson(`${base}/wp-json/wp/v2/widgets?sidebar=${encodeURIComponent(String(target.id))}`, { method: "GET", headers: { Authorization: auth } });
      const ws = Array.isArray(r.json) ? r.json : [];
      if (ws.some(isOurWidget)) return { ok: true, already: true };
    } catch { return { ok: false, why: "사이드바에 이미 있는지 확인하지 못해 그대로 두었어요." } }
  }

  try {
    const r = await fetchJson(`${base}/wp-json/wp/v2/widgets`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ id_base: "block", sidebar: String(target.id), instance: { raw: { content: widgetBlockHtml() } } }),
    });
    if (r.status < 200 || r.status >= 300) return { ok: false, why: `위젯을 꽂지 못했어요(http_${r.status}).` };
    return { ok: true, already: false, widgetId: String(r.json?.id ?? "") };
  } catch (e) { return { ok: false, why: `위젯을 꽂지 못했어요(${String((e as Error)?.message ?? e).slice(0, 60)}).` }; }
}
