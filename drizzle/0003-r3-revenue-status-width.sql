-- P1R3-B · revenue_sources.status 폭 확장 — 계약 §1.4 의 status 어휘에 'not_configured'(14자)가 있는데 칸이 varchar(12)였다.
-- 2026-09-14 스모크 실측: connect aliexpress/linkprice 가 22001(string too long) 로 500. ::varchar(n) 캐스트가 아니라 INSERT 라 정직하게 터졌다(PITFALLS #2 의 반대 경우).
-- 추가형(폭 넓힘 · 데이터 무손실). 비교: last_error_kind 는 처음부터 varchar(16).
ALTER TABLE revenue_sources ALTER COLUMN status TYPE varchar(16);
