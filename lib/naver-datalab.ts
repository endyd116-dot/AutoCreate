/**
 * lib/naver-datalab.ts — 네이버 데이터랩 검색어 트렌드 → growthPct(최근 4주 vs 직전 4주). AC 신규(2026-09-14).
 *   POST https://openapi.naver.com/v1/datalab/search  헤더 X-Naver-Client-Id / X-Naver-Client-Secret (NAVER_OPENAPI_*).
 *   body { startDate, endDate, timeUnit:"week", keywordGroups:[{ groupName, keywords:[…] }] } — 그룹 ≤5/호출 · 키워드 ≤20/그룹.
 *   응답 ratio 는 기간 내 최대=100 상대값 → 비율끼리의 변화율은 유효하다(절대 검색량은 키워드툴 몫).
 *   🔴 환각 0: 키 없음·실패·데이터 부족 → Map 에 키를 넣지 않는다(호출부는 growthPct 키 생략).
 */
const URL_ = "https://openapi.naver.com/v1/datalab/search";

function cfg(): { id: string; secret: string } | null {
  const id = String(process.env.NAVER_OPENAPI_CLIENT_ID ?? "").trim();
  const secret = String(process.env.NAVER_OPENAPI_CLIENT_SECRET ?? "").trim();
  return id && secret ? { id, secret } : null;
}
export function datalabConfigured(): boolean { return !!cfg(); }

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function datalabOnce(groups: { groupName: string; keywords: string[] }[], startDate: string, endDate: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const c = cfg(); if (!c || !groups.length) return out;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(URL_, { method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "X-Naver-Client-Id": c.id, "X-Naver-Client-Secret": c.secret },
      body: JSON.stringify({ startDate, endDate, timeUnit: "week", keywordGroups: groups.slice(0, 5) }) });
    if (!r.ok) { console.warn(`[naver-datalab] ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`); return out; }
    const j = (await r.json()) as { results?: { title: string; data?: { period: string; ratio: number }[] }[] };
    for (const g of j.results ?? []) out.set(g.title, (g.data ?? []).map((d) => Number(d.ratio) || 0));
  } catch (e) { console.warn("[naver-datalab] 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
  finally { clearTimeout(t); }
  return out;
}

/**
 * lookupGrowth — 키워드별 growthPct(최근 4주 합 vs 직전 4주 합 · 정수 %). 직전 4주 합이 0 이면 키 생략.
 *   groupName = 키워드 자신(≤5개씩 호출).
 */
export async function lookupGrowth(keywords: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!datalabConfigured()) return out;
  const uniq = [...new Set(keywords.map((k) => String(k || "").trim()).filter(Boolean))];
  if (!uniq.length) return out;
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 8 * 7);
  for (let i = 0; i < uniq.length; i += 5) {
    const groups = uniq.slice(i, i + 5).map((k) => ({ groupName: k, keywords: [k] }));
    const m = await datalabOnce(groups, ymd(start), ymd(end));
    for (const [k, series] of m) {
      if (series.length < 6) continue;
      const half = Math.floor(series.length / 2);
      const prev = series.slice(0, half).reduce((a, b) => a + b, 0);
      const recent = series.slice(half).reduce((a, b) => a + b, 0);
      if (prev <= 0) continue;
      out.set(k, Math.round(((recent - prev) / prev) * 100));
    }
    if (i + 5 < uniq.length) await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}
