/**
 * lib/revenue/youtube.ts — 유튜브 애널리틱스(YouTube Analytics API v2 `reports.query` · `yt-analytics-monetary.readonly`). 계약 §1.2.
 *   ids=channel==MINE · dimensions=day,video · metrics=estimatedRevenue · currency=KRW · sort=day.
 *   귀속: video id → `posts.channel_ref` → piece(+account). 매칭 안 되는 영상 수익은 소스 계정(accountId)으로 남긴다(버리지 않는다).
 *   ⚠️ 유튜브 수익은 «예상(estimated)»이고 며칠 뒤 확정된다 — CONFIRMED_SOURCES 밖(홈에서 «예상»으로 그린다) · 7일 되돌아 덮어쓴다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import type { OAuthToken } from "../oauth-providers";
import { classifyHttp, fail, httpJson, inRange, parseMoney, readCreds, toKstDay } from "./common";
import { ensureFresh } from "./google-oauth";
import type { RevenueRow, RevenueSourceRow, SyncResult } from "./types";

export type SyncResultWithCred = SyncResult & { credPatch?: OAuthToken };

export async function syncYoutube(tenantId: number, src: RevenueSourceRow, range: { from: string; to: string }): Promise<SyncResultWithCred> {
  const c = readCreds<OAuthToken>(src.credEnc);
  if (!c.ok) return c;
  const fr = await ensureFresh(c.creds);
  if (!fr.ok) return fail("auth", false, `구글 토큰 갱신 실패(${fr.reason}) — 다시 연결해 주세요.`);
  const token = fr.token;
  const channelId = String(src.config?.channelId ?? "");
  const p = new URLSearchParams({
    ids: channelId ? `channel==${channelId}` : "channel==MINE", startDate: range.from, endDate: range.to,
    metrics: "estimatedRevenue", dimensions: "day,video", currency: "KRW", sort: "day", maxResults: "500",
  });
  const r = await httpJson(`https://youtubeanalytics.googleapis.com/v2/reports?${p}`, { headers: { Authorization: `Bearer ${token.accessToken}` } }, 25_000);
  if (!r.ok) return { ...classifyHttp(r, "유튜브 애널리틱스"), ...(fr.changed ? { credPatch: token } : {}) };

  const cols: string[] = Array.isArray(r.json?.columnHeaders) ? r.json.columnHeaders.map((h: any) => String(h?.name ?? "")) : [];
  const iDay = cols.indexOf("day"), iVideo = cols.indexOf("video"), iRev = cols.indexOf("estimatedRevenue");
  if (iDay < 0 || iRev < 0) return fail("parse", false, `유튜브 응답 모양이 달라요(columns=${cols.join(",")})`);
  const rowsIn: any[] = Array.isArray(r.json?.rows) ? r.json.rows : [];

  const posts = await q(sql`SELECT piece_id, account_id, channel_ref FROM posts WHERE tenant_id = ${tenantId} AND channel = 'youtube_shorts' AND channel_ref IS NOT NULL ORDER BY id DESC LIMIT 2000`);
  const byVideo = new Map(posts.map((x) => [String(x.channel_ref), { pieceId: Number(x.piece_id), accountId: x.account_id ? Number(x.account_id) : undefined }]));

  const acc = new Map<string, RevenueRow & { amountRaw: number }>();
  let bad = 0;
  for (const row of rowsIn) {
    if (!Array.isArray(row)) { bad++; continue; }
    const day = toKstDay(row[iDay]); const amt = parseMoney(row[iRev]);
    if (!day || amt === null) { bad++; continue; }
    if (!inRange(day, range)) continue;
    const video = iVideo >= 0 ? String(row[iVideo] ?? "") : "";
    const hit = video ? byVideo.get(video) : undefined;
    const accountId = hit?.accountId ?? src.accountId ?? undefined;
    const pieceId = hit?.pieceId;
    const key = `${day}|${accountId ?? 0}|${pieceId ?? 0}`;
    const cur = acc.get(key) ?? { source: "youtube", day, amountKrw: 0, amountRaw: 0, currency: "KRW", ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}), raw: { channel: channelId || "MINE", videos: [] as string[] } };
    cur.amountRaw += amt;
    if (video && (cur.raw as any).videos.length < 5 && !(cur.raw as any).videos.includes(video)) (cur.raw as any).videos.push(video);
    acc.set(key, cur);
  }
  if (rowsIn.length && bad === rowsIn.length) return fail("parse", false, "유튜브 행을 하나도 읽지 못했어요.");
  const rows: RevenueRow[] = [...acc.values()].map(({ amountRaw, ...r }) => ({ ...r, amountKrw: Math.round(amountRaw) }));
  return { ok: true, rows, ...(fr.changed ? { credPatch: token } : {}) };
}
