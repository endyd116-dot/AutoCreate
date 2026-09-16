/**
 * lib/publish/wordpress.ts — 워드프레스 발행 커넥터(계약 §3 · DESIGN §2.1 «API · REST + Application Password»).
 *   AC 신규 2026-09-14(B2).
 *
 *   순서(계약 §3 그대로): **이미지 먼저** → 본문 치환 → 글.
 *     ① 우리 R2 이미지를 내려받아 `POST {site}/wp-json/wp/v2/media`(Basic · Content-Disposition) → `source_url`
 *     ② bodyHtml 안의 R2 URL 을 워드프레스 URL 로 치환(남의 사이트 글이 우리 R2 를 핫링크하지 않게 — R2 를 지우면 글이 깨진다)
 *     ③ `POST {site}/wp-json/wp/v2/posts` { status:"publish", title, content, tags }
 *   태그는 워드프레스가 **term id** 를 요구한다 → 이름으로 찾고 없으면 만든다. 태그가 실패해도 **글은 올린다**(태그는 부가 정보).
 *
 *   자격: `account_creds(kind 'app_password')` = { siteUrl, loginId, appPassword }. 🔴 이 파일 밖으로 나가지 않는다.
 *
 *   [R12-9 · 2026-09-17 · B] **고급 둘**(`lib/publish/wp-advanced.ts`): ① Article 에 `publisher` + **BreadcrumbList** 한 덩이
 *     ② 사이드바에 «최근 글» 위젯 **한 번만**(멱등). 🔴 둘 다 **글을 막지 않는다** — 안 돼도 글은 나가고 사실만 감사에 남는다(CLAUDE §9).
 */
import { loadWpCreds } from "./tokens";
import { excerptOf, slugOf, articleJsonLd, jsonLdSurvived } from "./seo";   // [P1R8 §3.4-②] REST 가 받는데 안 보내던 칸 + 살아 있는 구조화 데이터
import { breadcrumbJsonLd, publisherOf, jsonLdScript, ensureLatestPostsWidget, type WpSiteInfo } from "./wp-advanced";   // [R12-9] 사이드바 위젯 · 구조화 데이터 한 겹 더
import { writeAudit } from "../audit";
import type { PublishPiece, PublishAccount } from "./contract";
import type { ConnectorResult } from "./blogger";

const TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function basicAuth(loginId: string, appPassword: string): string {
  // 워드프레스 앱 비밀번호는 4자씩 공백으로 끊어 보여 준다 — 공백은 빼고 보낸다.
  return `Basic ${Buffer.from(`${loginId}:${String(appPassword).replace(/\s+/g, "")}`, "utf8").toString("base64")}`;
}

async function wpFetch(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
    const text = await r.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* HTML 에러 페이지 */ }
    return { status: r.status, json, text: text.slice(0, 400) };
  } finally { clearTimeout(t); }
}

function extOf(url: string, contentType: string): string {
  const fromCt = /image\/(png|jpeg|jpg|webp|gif)/i.exec(contentType)?.[1];
  if (fromCt) return fromCt === "jpeg" ? "jpg" : fromCt.toLowerCase();
  const m = /\.(png|jpe?g|webp|gif)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/** 이미지 1장 업로드 → 워드프레스 URL. 실패는 null(그 장만 원본 URL 로 남는다 — 발행을 막지 않는다). */
async function uploadMedia(site: string, auth: string, imageUrl: string, caption?: string, alt?: string): Promise<string | null> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let buf: ArrayBuffer; let ct: string;
    try {
      const src = await fetch(imageUrl, { signal: ctrl.signal });
      if (!src.ok) return null;
      ct = String(src.headers.get("content-type") ?? "image/jpeg");
      buf = await src.arrayBuffer();
    } finally { clearTimeout(t); }
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return null;
    const name = `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(imageUrl, ct)}`;
    const up = await wpFetch(`${site}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": ct.startsWith("image/") ? ct : "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
      body: Buffer.from(buf),
    });
    if (up.status < 200 || up.status >= 300) return null;
    const id = Number(up.json?.id ?? 0);
    const srcUrl = String(up.json?.source_url ?? "").trim();
    /* 🔴 alt 와 caption 을 **따로** 보낸다(§5C · B-1 84a2372 이후).
       종전엔 `alt_text: caption` 이었는데, 캡션이 «대부분 없다»로 바뀌면서 그대로 두면 **alt 가 통째로 빈다** —
       스크린리더에서 사진이 사라지고 이미지 검색에서도 빠진다. alt 는 없으면 캡션으로, 그것도 없으면 빈 값.
       🔴 캡션이 없어도 alt 만 있으면 보내야 하므로 조건도 «둘 중 하나라도 있으면» 으로 넓힌다
          (종전 `if (id && caption)` 은 캡션 없는 사진의 alt 를 **영영 안 보냈다**). */
    const altText = String(alt ?? caption ?? "").slice(0, 200);
    if (id && (caption || altText)) {
      // 실패해도 무시(이미지는 이미 올라갔다).
      await wpFetch(`${site}/wp-json/wp/v2/media/${id}`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ...(caption ? { caption } : {}), alt_text: altText }),
      }).catch(() => null);
    }
    return srcUrl || null;
  } catch { return null; }
}

/** 태그 이름 → term id(없으면 만든다). 실패한 이름은 건너뛴다. */
async function resolveTagIds(site: string, auth: string, names: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const raw of names.slice(0, 15)) {
    const name = String(raw).trim().replace(/^#/, "").slice(0, 40);
    if (!name) continue;
    try {
      const found = await wpFetch(`${site}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=10`, { headers: { Authorization: auth } });
      const hit = Array.isArray(found.json) ? found.json.find((t: any) => String(t?.name ?? "").toLowerCase() === name.toLowerCase()) : null;
      if (hit?.id) { out.push(Number(hit.id)); continue; }
      const made = await wpFetch(`${site}/wp-json/wp/v2/tags`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ name }),
      });
      // 이미 있으면 400 + data.term_id 로 돌려준다(워드프레스 관례).
      const id = Number(made.json?.id ?? made.json?.data?.term_id ?? 0);
      if (id) out.push(id);
    } catch { /* 이 태그만 건너뛴다 */ }
  }
  return out;
}

export async function publishToWordpress(piece: PublishPiece, account: PublishAccount): Promise<ConnectorResult> {
  const creds = await loadWpCreds(account.id);
  if (!creds) return { ok: false, reason: "no_creds", retriable: false, error: "워드프레스 로그인 정보가 없어요. 계정을 다시 연결해 주세요." };
  const site = creds.siteUrl;
  const auth = basicAuth(creds.loginId, creds.appPassword);

  // ① 이미지 → ② 본문 치환
  let html = piece.bodyHtml;
  for (const img of piece.images) {
    const url = String(img.url || "").trim();
    if (!url || !html.includes(url)) continue;
    const wpUrl = await uploadMedia(site, auth, url, img.caption, img.alt);
    if (wpUrl) html = html.split(url).join(wpUrl);
  }

  // ③ 태그(실패해도 글은 올린다)
  let tagIds: number[] = [];
  if (piece.tags.length) { try { tagIds = await resolveTagIds(site, auth, piece.tags); } catch { tagIds = []; } }

  /* [P1R8 §3.4-② · SEO 조사] 🔴 **REST 가 이미 받는데 우리가 안 보내던 두 칸**을 보낸다.
     · `excerpt` = 스니펫용 한 문단(테마·SEO 플러그인이 `<meta name="description">` 으로 내보낸다)
     · `slug`    = 주소 뒷글자. 안 보내면 워드프레스가 **한글 제목을 그대로** 주소로 써서
                   `%EA%B0%80%EC%9D%84…` 같은 **사람이 못 읽는 주소**가 공유된다(순위가 아니라 **읽힘**의 문제).
     빈 값이면 **아예 안 보낸다** — 빈 문자열을 보내면 워드프레스가 «비우라»는 뜻으로 받는다(기본값보다 나쁘다). */
  const excerpt = excerptOf(piece);
  const slug = slugOf(piece);

  /* 🔴 Article JSON-LD 는 본문 끝에 붙인다 — REST 로는 `<head>` 를 만질 수 없기 때문이다.
     구글은 문서 어디에 있든 JSON-LD 를 읽는다. **다만 워드프레스가 `<script>` 를 지울 수 있어**(KSES · `unfiltered_html` 권한),
     아래에서 응답의 `content.rendered` 를 되읽어 **살아남았는지 확인**한다(«넣었다»는 증거가 아니다 · AC-63).
     🔴 FAQPage·HowTo 는 **일부러 안 넣는다** — 둘 다 구글이 지원을 끊었다(`lib/publish/seo.ts` 머리말). */
  /* [R12-9 · 2026-09-17] 🔴 **사이트 이름을 먼저 읽는다** — `publisher` 와 빵부스러기 첫 마디에 쓴다.
     🔴 **못 읽으면 그 칸을 통째로 뺀다**(빈 이름을 넣지 않는다 · AC-9). 구글은 빈 `publisher.name` 을 «불일치»로 보고 **통째로 무시**한다.
     🔴 이 호출이 실패해도 **발행은 그대로 간다** — 인증 없이 열려 있는 공개 엔드포인트라 대개 되지만, 안 돼도 글의 본체가 아니다(§9). */
  const siteInfo: WpSiteInfo = await (async (): Promise<WpSiteInfo> => {
    try { const r = await wpFetch(`${site}/wp-json`, { method: "GET", headers: { Authorization: auth } }, 8_000);
      const nm = String(r.json?.name ?? "").trim();
      return nm ? { home: site, name: nm } : { home: site };
    } catch { return { home: site }; }
  })();

  /* [R12-9] Article 에 `publisher` 한 칸 — 🔴 `logo` 는 **안 넣는다**(고객 사이트 로고 주소를 우리가 모른다 · 추측 주소는 깨진 그림이 된다). */
  const article = articleJsonLd(piece, {
    authorName: account.displayName || account.handle,
    ...(piece.scheduledFor ? { publishedAt: piece.scheduledFor } : {}),
  });
  { const pub = publisherOf(siteInfo); if (pub) article.publisher = pub; }
  /* [R12-9] 빵부스러기(BreadcrumbList) — 🔴 **지금도 지원되는 유형**만 쓴다. FAQPage·HowTo 는 안 만든다(`seo.ts` 머리말의 근거). */
  const ld = jsonLdScript(article) + jsonLdScript(breadcrumbJsonLd(piece, siteInfo));

  const body: Record<string, unknown> = { title: String(piece.title || "").slice(0, 300), content: html + ld, status: "publish" };
  if (tagIds.length) body.tags = tagIds;
  if (excerpt) body.excerpt = excerpt;
  if (slug) body.slug = slug;

  let res: Awaited<ReturnType<typeof wpFetch>>;
  try {
    res = await wpFetch(`${site}/wp-json/wp/v2/posts`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: "network", retriable: true, error: "워드프레스에 연결하지 못했어요. 잠시 후 다시 시도할게요.", detail: String((e as Error)?.message ?? e).slice(0, 160) };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "auth_failed", retriable: false, error: "워드프레스 로그인 정보를 확인해 주세요(앱 비밀번호).", detail: `http_${res.status}` };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, reason: "channel_error", retriable: true, error: "워드프레스가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `http_${res.status}` };
  }
  const link = String(res.json?.link ?? "").trim();
  const id = String(res.json?.id ?? "").trim();
  if (res.status < 200 || res.status >= 300 || !link) {
    return { ok: false, reason: "channel_error", retriable: false, error: "워드프레스가 글을 받지 않았어요.", detail: `http_${res.status} ${String(res.json?.message ?? res.text).slice(0, 160)}` };
  }

  /* 🔴 구조화 데이터가 **실제로 살아남았나**를 응답으로 확인한다(위 주석). 지워졌으면 **조용히 넘어가지 않고** 감사에 남긴다 —
     안 남기면 다음 사람이 «JSON-LD 붙였는데 왜 서치콘솔에 안 뜨지»를 처음부터 추적한다.
     🔴 그래도 **발행은 성공이다** — 구조화 데이터는 글의 부가이지 본체가 아니다(이것 때문에 글을 막지 않는다). */
  if (ld && !jsonLdSurvived(res.json?.content?.rendered)) {
    await writeAudit({ tenantId: piece.tenantId, action: "wp_jsonld_stripped", actorType: "system", target: `piece:${piece.id}`,
      detail: { note: "워드프레스가 <script type=application/ld+json> 를 지웠다 — 앱 비밀번호 사용자에게 unfiltered_html 권한이 없다(KSES)", url: link.slice(0, 200) }, riskLevel: "low" })
      .catch((e: unknown) => console.warn("[wordpress] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
  }
  /* [R12-9 · 설계 R12 §8] 🔴 **사이드바 «최근 글» 위젯** — 우리가 올린 글들이 서로 이어지게 하는 내부 링크(DESIGN §518 의 🟢 항목).
     🔴 **멱등**(우리 도장 `className` 으로 가른다) · 🔴 **실패해도 글은 이미 나갔다** — 여기서 성공을 되돌리지 않는다.
     🔴 워드프레스 5.8 미만·권한 없음은 **«고장»이 아니라 «없는 길»**이다(CLAUDE §9 «이 규칙 밖») — 감사에만 사실로 남긴다.
     ⚠️ 발행마다 사이드바를 한 번 읽는다(GET 1~2회). 값을 캐시하지 않는 까닭: 고객이 테마를 바꾸면 사이드바가 통째로 달라지는데
        «전에 꽂았다»를 우리 DB 에 적어 두면 **없어진 위젯을 있다고 믿게** 된다. 사이트에 물어보는 쪽이 늘 맞다. */
  try {
    const w = await ensureLatestPostsWidget(site, auth, (u, init) => wpFetch(u, init, 12_000).then((r) => ({ status: r.status, json: r.json })));
    if (!w.ok || (w.ok && !w.already)) {
      await writeAudit({ tenantId: piece.tenantId, action: w.ok ? "wp_widget_added" : "wp_widget_skipped", actorType: "system", target: `piece:${piece.id}`,
        detail: w.ok ? { widgetId: (w as { widgetId: string }).widgetId } : { why: w.why }, riskLevel: "low" })
        .catch((e: unknown) => console.warn("[wordpress] 위젯 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
    }
  } catch (e) { console.warn("[wordpress] 사이드바 위젯 건너뜀(글은 나갔다)", String((e as Error)?.message ?? e).slice(0, 100)); }

  return { ok: true, externalUrl: link, ...(id ? { channelRef: id } : {}) };
}
