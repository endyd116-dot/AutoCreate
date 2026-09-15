-- 0029-r8-channels-phase2.sql — [P1R8 §3.4 · B2] 다음 Phase 채널 6행 + 개통된 2행의 표시값 정정
--   번호: 메인 배정(0028 은 B-1 stock-cache 가 가져갔다 · 오늘 여덟 번째 충돌이 될 뻔했다 · AC-49)
--
--   🔴 전부 **추가형**이다: INSERT … ON CONFLICT DO NOTHING + 두 행의 UPDATE. DROP·DELETE·RENAME 0.
--
--   ══ 왜 status 가 전부 'planned' 인가 ══
--     `channel_registry.status` 는 «우리가 문을 열었나»이고, 그 문을 여는 것은 **앱 키가 온 뒤**다(§7.5).
--     코드는 다 섰지만(`lib/publish/{facebook,x,tiktok,instagram,youtube}.ts`) 키가 없으면 고객은
--     눌러도 아무 일이 안 난다 — 라이브에서 `blogger` 가 실제로 그랬다. 그래서 켜지 않고 «곧 연결할 수 있어요»로 둔다.
--
--   ══ 🔴 brunch · naver_clip_post 의 publish_via 가 'manual' 인 이유 ══
--     이 칸은 **화면에 보여 주는 값**이다. 코드의 발행 경로(`lib/channel-registry.ts publishVia`)는 둘 다 **null** 이고,
--     그 이유는 «러너로 올릴 셀렉터를 한 번도 재 본 적이 없어서»다(그 파일의 «못 채운 칸» 주석).
--     여기에 'runner' 라고 적으면 **화면이 «러너가 올려 준다»고 말하는데 실제로는 아무 데도 못 누른다** —
--     지금 사실에 맞는 말은 'manual'(사람이 올린다)이다. 재 보고 나서 'runner' 로 고친다.
--
--   ══ best_hours 가 빈 배열인 이유 ══
--     이 채널들의 «잘 되는 시각»을 **잰 적이 없다**. 기존 행의 숫자는 조사에서 온 값이고, 새 채널엔 그런 근거가 없다.
--     🔴 그럴듯한 숫자를 지어 넣으면 편성이 **근거 없는 시각**을 «최적»이라고 말하게 된다(AC-9 «모른다»를 «값»으로 바꾸지 않는다).
--     운영센터 «채널»에서 사람이 넣을 수 있고, 학습(`bestHoursFor`)이 계정별로 따로 배운다.
--
--   ══ sort 가 20번대인 이유 ══
--     기존 행의 sort(1~13)를 **건드리지 않으려고** 뒤에 붙였다. 기존 행을 다시 매기면 그건 추가형이 아니다.

INSERT INTO channel_registry (key, label, category, publish_via, status, best_hours, monetize, sort) VALUES
  ('facebook',         '페이스북',    'text',  'api',    'planned', '[]', '["affiliate"]',                      20),
  ('x',                '엑스',        'text',  'api',    'planned', '[]', '["affiliate"]',                      21),
  ('brunch',           '브런치',      'text',  'manual', 'planned', '[]', '["affiliate"]',                      22),
  ('naver_clip_post',  '클립 게시물', 'text',  'manual', 'planned', '[]', '["clip_incentive","shoppingconnect"]', 23),
  ('youtube_long',     '유튜브 영상', 'video', 'api',    'planned', '[]', '["ypp","affiliate"]',                 24),
  ('facebook_reels',   '페북 릴스',   'video', 'api',    'planned', '[]', '["affiliate"]',                       25)
ON CONFLICT (key) DO NOTHING;

-- 🔴 instagram·tiktok 은 **커넥터가 생겼다** — 표시용 publish_via 가 여태 코드와 어긋나 있었다.
--    (`lib/channel-registry.ts` 의 publishVia 는 이번에 'api' 로 채웠다 — 올릴 코드를 쓴 **뒤에** 채웠다.)
--    status 는 건드리지 않는다(키가 와야 켠다).
UPDATE channel_registry SET publish_via = 'api' WHERE key IN ('instagram', 'tiktok') AND publish_via <> 'api';

COMMENT ON COLUMN channel_registry.publish_via IS
  '화면에 보여 주는 발행 경로 표시값(api|runner|manual). 🔴 판정의 정본은 코드 `lib/channel-registry.ts CHANNELS[].publishVia` 이고, 그쪽이 null 이면 발행은 정직하게 막힌다. 두 값이 어긋나면 화면만 거짓말을 한다 — 채널을 켤 때 둘을 같이 본다.';
