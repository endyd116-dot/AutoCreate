-- P1R5-B2 · 러너 렌더(§2.4) — 추가형·멱등. scripts/neon-migrate.mjs 로 적용.
-- ⚠️ 0008 이 둘: 이 파일 = B2 runner_devices.caps · `0008-r5-video.sql` = B-1 영상 표. 둘 다 적용 완료 · 다음 번호는 0009.
-- 🔴 파괴적 문장 0. schema.ts 선언은 B 몫(계약 §4 «db/schema.ts 는 B 만 · B2 는 SQL 만»).

-- ── runner_devices.caps: 러너가 하트비트로 알리는 «능력»(§2.4) ──
-- 지금은 { ffmpeg:boolean, ffmpegVersion?:string }. ffmpeg 가 없는 러너는 렌더 잡을 **집지 않으므로**,
-- 이 칸이 없으면 «왜 렌더가 안 도는지»를 화면이 설명할 수 없다(조용한 미처리 금지 · PITFALLS #7).
ALTER TABLE runner_devices ADD COLUMN IF NOT EXISTS caps jsonb;
