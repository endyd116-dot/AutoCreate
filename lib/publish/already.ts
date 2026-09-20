/**
 * lib/publish/already.ts — 🔴 **올리기 전에 «채널에 이미 있나»를 채널에 묻는다**(2026-09-21 · B2 · AC-200).
 *   🔎 출처: AC 신규. AM 에도 «발행 전 자기 중복 확인»은 없다(AM 은 올린 뒤 주소만 확인한다).
 *
 *   ══ 왜 ══
 *     §4.7 «발행 멱등»의 열쇠가 `pieces.external_url`/`channel_ref` — **우리 기록**이다.
 *     🔴 그래서 **«우리 기록이 없는 사고»는 구조적으로 못 막는다.** 실제 경로가 코드에 있다:
 *        러너가 claim → **글을 올린다** → 보고 전에 죽는다 → 15분(`STALE_CLAIM_MIN`) 뒤 `reapStaleJobs` 가
 *        `status='queued'` 로 되돌린다 → 다른 러너가 집는다 → **같은 글이 또 올라간다.**
 *        이 경로는 `publish()` 를 **거치지 않으므로** 멱등 검사 ①을 아예 안 탄다.
 *     ⇒ 우리 장부만 보지 말고 **채널에 물어본다.** 장부가 비어 있어도 채널은 알고 있다.
 *
 *   ══ 지킨 선 ══
 *     🔴 `verifyPublishedUrl`(lib/runner-jobs.ts)을 **건드리지 않았다** — 그건 «주소 하나가 살아 있나»를 보는 자다.
 *        여기는 그 **앞 걸음**이다(«주소를 모를 때 채널 목록에서 찾는다»). 같은 규율만 물려받는다:
 *        **쿠키 없는 서버 fetch = 로그아웃한 남의 눈**(글쓴이 브라우저로는 못 보는 것을 본다).
 *     🔴 **막지 않는다**(CLAUDE §9). 이 자는 «있는 것 같아요»를 **말해 줄 뿐**이다 — 단 하나,
 *        `found_after`(우리가 올려 놓고 기록을 잃은 경우)만은 **막는 게 아니라 기록을 복구**하는 것이라 다르다.
 *        그건 게이트가 아니라 §4.7 멱등 그 자체다(«이미 나간 글은 두 번 나가지 않는다»의 재료를 채널에서 주워 온 것).
 *
 *   ══ 🔴 판정표 (돌리기 전에 먼저 적고, 2026-09-21 실측으로 확정했다) ══
 *     | 본 것                                      | verdict        | 뜻 / 행동 |
 *     |---|---|---|
 *     | 피드를 못 읽음(네트워크·404·타임아웃)       | `unknown`      | **못 물어봤다.** 그대로 간다 |
 *     | 채널 제목이 빈 태그                         | `unknown`      | 그 블로그가 안 열린다 — 실측: 없는 네이버 id 는 **404 가 아니라 200 + `<title/>`** |
 *     | 항목 0건                                    | `unknown`      | 🔴 **«없다»가 아니다.** RSS 를 껐거나 비공개일 수 있다(실측: ppss·itwiki 티스토리 = 제목 있고 0건) |
 *     | 같은 제목이 있고 **`since` 뒤**에 올라감      | `found_after`  | 🔴 **우리가 올려 놓고 기록을 잃었다.** 재발행 대신 그 주소로 확정 |
 *     | 같은 제목이 있고 `since` 앞 · 또는 시각 모름  | `found_before` | 전부터 있던 같은 제목 — **말해 주고 그대로 올린다**(판단은 고객 · §9) |
 *     | 항목은 있는데 같은 제목 없음                  | `absent`       | **최근 목록 안에는** 없다(전체가 아니다 — 네이버·티스토리 둘 다 최대 50건) |
 *
 *   ══ 실측(2026-09-21 · 읽기만 · 쓰기 0) ══
 *     · `https://rss.blog.naver.com/{id}.xml`   200 · 제목·주소(logNo)·pubDate · 최대 50건 ✅
 *     · `https://{host}/rss`(티스토리)           200 · 같은 모양 ✅ · 없는 블로그는 404
 *     · 없는 네이버 id                           **200 + 빈 채널 제목**(0건과 구분된다)
 *   🔴 **순수**(판정)와 **I/O**(한 함수)를 갈라 놨다 — `scripts/verify-publish-already.mts` 가 네트워크 없이 판정만 돌린다.
 */

/** 판정 네 값 — 🔴 «확실히 없다»는 없다. 못 본 것을 «깨끗»으로 바꾸지 않는다(AC-9). */
export type AlreadyVerdict = "found_after" | "found_before" | "absent" | "unknown";

export interface FeedItem {
  title: string;
  url: string;
  /** 발행 시각 ISO(UTC). 🔴 못 읽으면 **null** — 0 이나 now 로 채우지 않는다. */
  at: string | null;
}

export interface AlreadyAsk {
  verdict: AlreadyVerdict;
  /** 무엇으로 물었나. 못 물었으면 null. */
  source: "rss" | null;
  /** 찾은 글(있으면). */
  hit: FeedItem | null;
  /** 훑어본 글 수. 0 이면 «못 봤다»(«없다»가 아니다). */
  scanned: number;
  /** unknown 사유 — `no_feed`(채널에 물을 길이 없다) · `no_handle` · `no_title` · `fetch_failed` · `blog_not_found` · `empty_feed` · `http_NNN` */
  why?: string;
  askedAt: string;
}

/* ─────────────────────────── 순수 ─────────────────────────── */

/**
 * 채널별 «최근 글 목록» 주소. 🔴 **모르면 null** — 추측해서 주소를 짓지 않는다(`publishViaOf` 와 같은 규율).
 *   ⚠️ 워드프레스·블로거는 **지금 못 묻는다**(사유는 파일 끝 주석 · 「못 쟀음」으로 보고한다).
 */
export function feedUrlFor(channel: string, handle: string): string | null {
  const h = String(handle ?? "").replace(/^@/, "").trim();
  if (!h) return null;
  if (channel === "naver_blog") {
    // 네이버는 «블로그 아이디» 하나로 결정된다. 주소가 통째로 들어와 있으면 그 칸을 뽑아 쓴다.
    const id = /^https?:\/\//i.test(h) ? (h.match(/blog\.naver\.com\/([^/?#]+)/i)?.[1] ?? "") : h;
    return /^[A-Za-z0-9_-]{2,}$/.test(id) && !/\.naver$/i.test(id) ? `https://rss.blog.naver.com/${id}.xml` : null;
  }
  if (channel === "tistory") {
    /* 🔴 `runner/channels/tistory.mjs blogHost` 와 **같은 규칙**이다 — 두 곳이 다른 주소를 만들면
       «러너가 올린 블로그»와 «우리가 물어본 블로그»가 갈라진다. 규칙을 바꾸면 둘 다 바꾼다. */
    let host: string | null = null;
    if (/^https?:\/\//i.test(h)) { try { host = new URL(h).host; } catch { host = null; } }
    else host = h.includes(".") ? h : `${h}.tistory.com`;
    return host && /^[A-Za-z0-9.-]{4,}$/.test(host) ? `https://${host}/rss` : null;
  }
  return null;
}

/** XML 엔티티·CDATA 를 푼다(피드 제목은 `&amp;`·CDATA 가 섞여 온다). */
function unxml(s: string): string {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * 제목 대조용 정규화 — 🔴 **넓게 잡지 않는다.** 공백·문장부호·대소문자만 지운다.
 *   낱말을 잘라 내거나 앞뒤를 자르면 «비슷한 제목»이 «같은 제목»이 되고, 그러면 멀쩡한 새 글이 «이미 있어요»가 된다.
 */
export function normTitle(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s​-‍﻿]+/g, "")
    .replace(/[!-/:-@[-`{-~·…—–‥「」『』（）【】]/g, "");
}

/** RSS 2.0 한 벌 → 채널 제목 + 항목. 파서를 새로 들이지 않는다(함수 번들 무게). */
export function parseFeed(xml: string): { channelTitle: string | null; items: FeedItem[] } {
  const body = String(xml ?? "");
  const items: FeedItem[] = [];
  /* 채널 제목은 **첫 `<item>` 앞**에서만 찾는다 — 항목 제목을 채널 제목으로 잘못 읽으면
     «없는 블로그»(빈 제목) 판정이 통째로 무너진다. */
  const head = body.split(/<item[\s>]/i)[0] ?? "";
  const ctRaw = head.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  const channelTitle = ctRaw === undefined ? null : (unxml(ctRaw) || null);
  for (const m of body.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const title = unxml(it.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const url = unxml(it.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const dRaw = unxml(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const d = dRaw ? new Date(dRaw) : null;
    items.push({ title, url, at: d && Number.isFinite(d.getTime()) ? d.toISOString() : null });
    if (items.length >= 120) break;
  }
  return { channelTitle, items };
}

/**
 * 🔴 판정(순수) — 위 판정표 그대로. `since` 는 «이 글을 올리려고 러너가 집어 간 시각»(모르면 null).
 *   ⚠️ `at` 이 null 인 항목은 **`found_before`** 다 — «시각을 모른다»를 «우리 것»으로 올려 읽지 않는다.
 *      올려 읽으면 남이 같은 제목으로 쓴 옛 글에 우리 piece 를 확정해 버리고, 그 글은 **영영 안 올라간다.**
 */
export function judgeFeed(
  parsed: { channelTitle: string | null; items: FeedItem[] },
  wantTitle: string,
  since: string | null,
  askedAt: string = new Date().toISOString(),
): AlreadyAsk {
  const base = { source: "rss" as const, askedAt };
  if (!parsed.channelTitle) return { ...base, verdict: "unknown", hit: null, scanned: 0, why: "blog_not_found" };
  if (!parsed.items.length) return { ...base, verdict: "unknown", hit: null, scanned: 0, why: "empty_feed" };
  const want = normTitle(wantTitle);
  const scanned = parsed.items.length;
  if (!want) return { ...base, verdict: "unknown", hit: null, scanned, why: "no_title" };
  const hits = parsed.items.filter((i) => normTitle(i.title) === want);
  if (!hits.length) return { ...base, verdict: "absent", hit: null, scanned };
  const sinceMs = since ? Date.parse(since) : NaN;
  /* 🔴 여럿이면 **가장 최근 것**을 든다 — «우리가 방금 올린 것»을 찾는 자리라 옛 동명 글에 매이면 안 된다. */
  const newest = hits.reduce((a, b) => ((Date.parse(b.at ?? "") || 0) > (Date.parse(a.at ?? "") || 0) ? b : a));
  const after = Number.isFinite(sinceMs) && newest.at !== null && Date.parse(newest.at) >= sinceMs;
  return { ...base, verdict: after ? "found_after" : "found_before", hit: newest, scanned };
}

/* ─────────────────────────── I/O 한 곳 ─────────────────────────── */

/**
 * 채널에 물어본다. 🔴 **실패는 전부 `unknown`** — 못 물어본 것을 «없다»로 바꾸지 않는다.
 *   타임아웃 8초(발행 경로에 끼는 자라 길게 잡지 않는다 · 못 물으면 그냥 간다).
 */
export async function askChannelForExisting(input: {
  channel: string; handle: string; title: string; since?: string | null; timeoutMs?: number;
}): Promise<AlreadyAsk> {
  const askedAt = new Date().toISOString();
  if (!String(input.handle ?? "").trim()) return { verdict: "unknown", source: null, hit: null, scanned: 0, why: "no_handle", askedAt };
  const url = feedUrlFor(input.channel, input.handle);
  if (!url) return { verdict: "unknown", source: null, hit: null, scanned: 0, why: "no_feed", askedAt };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(2000, input.timeoutMs ?? 8000));
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoCreate/1.0)" } });
    if (!r.ok) return { verdict: "unknown", source: "rss", hit: null, scanned: 0, why: `http_${r.status}`, askedAt };
    const xml = await r.text();
    return judgeFeed(parseFeed(xml), input.title, input.since ?? null, askedAt);
  } catch (e) {
    return { verdict: "unknown", source: "rss", hit: null, scanned: 0, why: `fetch_failed:${String((e as Error)?.name ?? "err").slice(0, 20)}`, askedAt };
  } finally { clearTimeout(t); }
}

/** 사람말 한 줄(§3 말투 — ①사실 ②어떻게 하면 되는지 ③우리가 대신 한 것 · 위협·책임 전가 0). 조용히 넘어갈 판정이면 null. */
export function alreadySay(a: AlreadyAsk, channelLabel?: string): string | null {
  const where = channelLabel ? `${channelLabel}에 ` : "";
  if (a.verdict === "found_after") {
    return `${where}이 글이 이미 올라가 있어요 — 앞서 올린 것이 기록에 안 남았던 거예요. 다시 올리지 않고 그 글로 이어 두었어요.`;
  }
  if (a.verdict === "found_before") {
    return `${where}같은 제목의 글이 이미 있어요. 그대로 올렸어요 — 겹치는 게 싫으시면 글을 내리거나 제목을 바꿔 주세요.`;
  }
  return null;   // absent·unknown 은 사람에게 말할 것이 없다(기록에는 남는다)
}

/* 🔴 **아직 못 묻는 채널과 그 사유**(§8 «조용한 축소 금지» — 지도에 남긴다)
 *   · `wordpress` — 사이트 주소가 `account_creds(kind 'app_password')` **암호문 안**에 있다. 여기서 풀면
 *     §4.7 «평문 표면 2곳» 이 세 곳이 된다. ⇒ 커넥터(`lib/publish/wordpress.ts`) 안이 맞는 자리다.
 *   · `blogger`   — blogId 는 OAuth 토큰 `extra.blogId` 에 있다. 물을 길은 있다(`blogger/v3/blogs/{id}/posts`)
 *     — 토큰 갱신이 딸린 호출이라 역시 커넥터 안이 맞는 자리다.
 *   🔴 둘 다 **API 채널**이라 이 사고(러너가 올리고 보고 전에 죽는다)의 경로가 아니다 — `publish()` 가 커넥터 응답을
 *      받은 **같은 호출 안**에서 `finalizePublish` 까지 간다. 남는 틈은 `publish_finalize_failed` 하나이고
 *      그건 이미 `retriable:false` + 감사 high 로 **재발행을 막아** 둔 자리다. 그래서 이번 판에서 뒤로 미뤘다.
 *   · 영상·SNS 채널(유튜브·릴스·스레드·X·틱톡·당근) — «제목»이 글처럼 고유하지 않아 제목 대조 자체가 틀린 자다.
 *     물으려면 각 API 의 «내 최근 게시물»이 필요하다. 이번 판 밖(지도에 남긴다).
 */
