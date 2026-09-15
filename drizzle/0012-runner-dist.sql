-- 0012 · 러너 배포 / 묶기(계약 «러너 배포» ②) — B2 2026-09-15
--
-- 지금까지 러너 토큰은 **어디서 켜도 도는** 열쇠였다. 파일 하나를 복사해 열 명이 나눠 켜도
-- 서버는 같은 기기로 본다. 잡은 토큰의 테넌트 것만 가니 «남의 글이 올라가는» 일은 없지만,
-- 한 사람이 산 프로그램을 여럿이 돌리는 것은 막아야 한다.
--
-- 그래서 기기 **지문**(호스트명+MAC 의 해시 · 원본은 서버에 오지 않는다)을 처음 본 값으로 묶어 두고,
-- 다른 지문에서 같은 토큰이 오면 거절하고 고객에게 알린다. 완벽한 자물쇠가 아니라 **눈에 띄게** 하는 장치다.
--
-- 🔴 기존 기기는 fingerprint 가 NULL 이다 — 처음 오는 지문을 그대로 묶는다(«쓰던 사람이 갑자기 못 쓰는» 일이 없게).
-- 🔴 추가형 전용(IF NOT EXISTS · 멱등). 값 삭제·형 변경 없음.

ALTER TABLE runner_devices ADD COLUMN IF NOT EXISTS fingerprint varchar(64);
ALTER TABLE runner_devices ADD COLUMN IF NOT EXISTS fingerprint_at timestamp;
-- 지문이 어긋난 마지막 시각 — 운영·고객 화면이 «다른 PC 에서 켜졌어요» 를 몇 번째인지 함께 보여 줄 수 있게.
ALTER TABLE runner_devices ADD COLUMN IF NOT EXISTS fp_mismatch_at timestamp;
ALTER TABLE runner_devices ADD COLUMN IF NOT EXISTS fp_mismatch_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN runner_devices.fingerprint IS '기기 지문 해시(sha256 hex) — 호스트명+MAC 의 해시. 원본은 저장하지 않는다.';
COMMENT ON COLUMN runner_devices.fp_mismatch_count IS '다른 지문으로 접속을 시도한 횟수(복사본 탐지).';
