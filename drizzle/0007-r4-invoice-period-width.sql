-- P1R4-C · invoices.period 폭 확장(추가형 · 데이터 무손실) — 2026-09-14 C 검증 실측.
-- 코인 영수증은 period = 주문번호(`AC-COIN-{tid}-{pack}-{base36ms}` · 22자+ · tid 가 커지면 더)인데 칸이 varchar(20)이었다.
-- 첫 실결제에서 INSERT 가 22001(string too long)로 죽어 «돈은 받았는데 영수증·인보이스가 없는» 사고가 된다(AC-21 · ::varchar 캐스트가 아니라 정직하게 터지는 쪽).
-- order_no(varchar 60)와 같은 폭으로. 구독 period('YYYY-MM' · 'YYYY-MM:up-agency')는 영향 없음.
ALTER TABLE invoices ALTER COLUMN period TYPE varchar(60);
