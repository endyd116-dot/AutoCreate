-- 0026-r8-stock-cache.sql — [R8 §10 · B-1 2026-09-15] 스톡 사진 제공사 응답 **24시간 보관**(추가형 · 멱등)
--   🔴 왜 표가 필요한가 = **약관이다.** Pixabay API 문서가 «Requests must be **cached for 24 hours**» 를 요구한다
--      (https://pixabay.com/api/docs/). 함수 인스턴스 메모리는 콜드 스타트마다 비워져서 «24시간 캐시했다»가 우리 말만 그런 것이 된다.
--   🔴 표 하나가 일 셋을 한다 — ①약관이 요구한 보관 ②같은 검색어를 두 번 안 묻기(값)
--      ③**요청 상한 세기**(실제 호출만 행을 만드니 «최근 60초 행 수» = «최근 60초 호출 수» · Pixabay 100req/60s · Pexels 200/시간).
--      따로 카운터 표를 만들지 않았다.
--   🔴 tenant_id 가 없는 이유(CLAUDE §4.6 의 예외 — 잊은 것이 아니다): 담기는 것은 **제공사의 공개 검색 결과**이지
--      고객의 것이 아니다. 집마다 따로 담으면 ①약관이 요구한 캐시가 무의미해지고 ②상한에 집 수만큼 빨리 닿는다.
--      검색어 원문도 담는다 — 어차피 그 문자열을 제공사에게 보낸다(여기 담는다고 새로 드러나는 것이 없다).
--   보존: 만료된 행만 `lib/stock/cache.ts sweepStockCache()` 가 치운다. 지우는 것은 만료분뿐이다.

CREATE TABLE IF NOT EXISTS stock_cache (
  id          bigserial PRIMARY KEY,
  -- 'pixabay' | 'pexels'
  provider    varchar(16)  NOT NULL,
  -- 정규화한 검색어 + 장수 + 언어(`lib/stock/cache.ts queryKeyOf`). 같은 검색을 두 번 하지 않게 하는 열쇠.
  query_key   text         NOT NULL,
  -- 제공사 응답 원문 그대로(가공하지 않는다 — 나중에 파싱을 고쳐도 다시 부를 필요가 없다).
  payload     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  -- 🔴 «실제로 부른 시각» = 상한 세기의 기준. ON CONFLICT 로 다시 부르면 이 값도 갱신된다.
  created_at  timestamp    NOT NULL DEFAULT NOW(),
  expires_at  timestamp    NOT NULL
);

-- 같은 (제공사, 검색어)는 한 행 — `ON CONFLICT ... DO UPDATE` 가 이 제약에 기댄다.
CREATE UNIQUE INDEX IF NOT EXISTS stock_cache_provider_query_uk ON stock_cache (provider, query_key);
-- 상한 세기(최근 창 안 행 수) · 청소(만료분 찾기).
CREATE INDEX IF NOT EXISTS stock_cache_provider_created_idx ON stock_cache (provider, created_at);
CREATE INDEX IF NOT EXISTS stock_cache_expires_idx ON stock_cache (expires_at);
