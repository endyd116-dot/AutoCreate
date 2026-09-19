# 🔴 영상 멈춤 스위치 — 손잡이를 달았다 (2026-09-20 · B)

> 브랜치 `audit/read-no-writer-2026-09-20` · **push 안 함** · 메인 승인 «바로 해라. 오늘 나온 것 중 제일 급하다»

## 1. 무엇이 고장이었나

`lib/video/cost.ts` 머리말이 이렇게 적어 뒀다:
> «kill switch = `feature_flags(key='video')` **(운영센터 AI 메뉴)** · 조회 실패(DB) = 차단(fail-closed · 돈 자원)»

그 메뉴는 **실제로 있다**(`ops-ai.ts` — 모델 체인·카나리·자동수동·원가 상한). **그 줄 하나만 없었다.**

| | 수 |
|---|---|
| 읽는 곳 | 1 — `videoKillSwitchActive` 가 원가 판정 **매번** 본다 |
| 운영센터 API | **0** |
| 운영센터 화면 | **0** |
| 쓰는 곳 | **0** (`scripts/verify-p1r5.mjs` 가 시험용으로 넣었다 지운다) |

🔴 그래서 **«끌 수는 없는데 고장 나면 잠기는»** 모양이었다 — 제일 나쁜 조합이다(메인 지적).
찾은 방법: 같은 날 세운 `scripts/verify-write-path-missing.mjs`. **«아무도 안 틀렸는데 기능이 없다»의 본보기**다.

## 2. 고친 것

### ① API — `POST /api/ops-ai-video-kill  { enabled, tenantId?, note? }`
- `ops-ai.ts` 안(이웃 `ops-ai-cost-cap` 과 같은 모양) · **super_admin 전용** · `tenant_id NULL` = 전 고객 · 숫자 = 그 고객만.
- 멱등 — `ON CONFLICT (key, COALESCE(tenant_id, 0))`(표의 유일 인덱스가 그 식이다). 두 번 눌러도 한 행.
- 🔴 **감사 `ops_ai_video_kill` · risk high**(메인 지시 — «돈을 멈추는 손이고 나중에 «누가 껐나»를 반드시 묻는다»). `detail: { enabled, scope, note }`.
- 🔴 **판정은 안 건드렸다** — 무엇을 막나는 `lib/video/cost.ts` 한 벌이다. 여기선 **칸만 쓴다**(두 번째 문 금지).
- `GET /api/ops-ai-models` 에 `video: { enabled, note, updatedAt, stoppedTenants[] }` 를 실었다 — 화면이 이걸 그려야 «손잡이»가 된다(§4.8).

### ② 화면 — 운영센터 AI 메뉴 맨 위 «영상 만들기»
정본은 `public/ops/_tpl.txt`(생성물은 `node scripts/build-pages.mjs`).
🔴 **끄기 전에 무슨 일이 일어나는지 말한다**(메인 요구 — «끄는 사람이 운영자라도 결과를 모르고 누르면 안 된다»). **읽고 확인한 사실만 적었다**:

| 묻는 것 | 화면이 말하는 것 | 근거(코드) |
|---|---|---|
| 지금 만들던 영상은? | 다음 장면 직전에 멈추고 «못 만들었어요»로 · **코인은 돌려드려요** | `gen.ts:252` → `failPiece` → `refundPieceDetailed` |
| 편성표에 잡힌 것은? | 만들기 전에 멈춘다 · **코인은 애초에 안 빠진다** · **자리는 그대로** | `director.ts:616` `precheckVideoBudget` 는 **코인 차감 전** |
| 글·사진은? | **안 멈춘다** — 이 스위치는 영상만 | `videoKillSwitchActive` 는 영상 경로에서만 불린다 |

다시 켤 때도 세 줄로 말한다(다음 편성부터 · 실패한 것은 고객이 «다시 만들기»(코인 추가 없음) · 따로 멈춘 고객은 그대로).
말투는 §3 — 이모지 없음 · 겁주는 말 없음 · «계약» 같은 내부 말 없음(`verify-people-words` 초록).

## 3. 실측 — 둘 다 **눌러 봤다**

### 서버 (`scripts/_smoke/video-kill-smoke.mts` · 🔴 **시험 테넌트 761 로만** · 전역은 안 눌렀다)
```
시작: feature_flags(video) 0행
① 멈추기(761) → {"ok":true,"enabled":false,"tenantId":761}
   DB: {"tenant_id":"761","enabled":false,"note":"스모크: 공급자 장애 가정","updated_by":"1"}
② videoKillSwitchActive(761) = true   (다른 고객 764 = false)
   🔴 checkVideoBudget(761) → allowed=false reason=killed     ← 판정까지 실제로 닿는다
③ 두 번 눌렀을 때 행 수 = 1                                    ← 멱등
④ 감사 2행 · risk_level=high · detail {scope:"tenant",enabled:false}
⑤ GET ops-ai-models.video = {"enabled":true,...,"stoppedTenants":[761]}
⑥ operator 로 누르면 → 403
⑦ 다시 켜기 → enabled=true · 정리 뒤 0행 — 시작과 같다        ← 🔴 흔적 0
```

### 화면 (`scripts/_smoke/video-kill-screen-smoke.mjs` · 🔴 **모의 모드** — 전역 스위치를 라이브로 누르면 전 고객이 멈춘다)
```
✓ AI 화면에 «영상 만들기» 칸 · 단추 «영상 만들기 멈추기»
✓ 끄기 전에 코인 · 편성표 · 글 셋 다 말한다
✓ «전 고객의 영상 만들기를 멈출까요?» 확인 한 번
✓ 누르면 «멈춰 있어요»로 바뀐다 · toast «영상 만들기를 멈췄어요»
✓ pageerror 0
```
모의 층(`public/js/mock-ops.js`)도 같은 커밋에서 맞췄다 — **서버만 고치고 사본이 옛말**이 되는 자리다(AC-52).

## 4. 자 — 새로 안 냈다. **이미 있는 자가 이 수리의 자다**
`verify-write-path-missing` 이 이 고장을 찾았고, 고치니 **3칸 → 1칸**(남은 하나는 `opened_at` · A+B 한 판).
🔴 회귀 방지는 **변이 M12** 로 못 박았다 — 운영센터 라우트의 `INSERT INTO feature_flags` 를 들어내면 **다시 운다**.
- 변이 **12/12** (M3 의 과녁은 **내 수리가 없애 버려서** 제품 밖 임시 DDL 칸으로 옮겼다 — 10/11 로 떨어진 것을 보고 고쳤다)
- 🔴 하니스의 기준값을 **숫자로 박아 뒀던 것**도 고쳤다(«3개»가 «1개»가 되자 «되돌리기 실패»로 헛 울었다). 기준은 **잰 값**으로 잡는다.
- `pending-red.json` — 그 줄에서 `feature_flags` 를 **빼고** «이미 고친 것»에 옮겨 적었다. 남은 것은 `opened_at` 하나.

## 5. 🔴 다음 판 재료 — **같은 병의 반대쪽**(안 고쳤다 · 메인이 나눌 몫)

`verify-write-path-missing` 이 «서버에 길이 없다»를 잡는다면, 반대쪽은 «**서버엔 길이 있는데 화면에 손잡이가 없다**»다.
재 봤다:

```
ops 라우트 70개 · 운영 화면이 부르는 것 57 · 🔴 안 부르는 것 13
  ops-takedowns · ops-takedown · ops-takedown-action     ← 🔴 내리기 콘솔이 통째로 화면 0
  ops-proxies · ops-proxy-assign                          ← 🔴 프록시 콘솔이 통째로 화면 0
  ops-ticket-claim · ops-ticket-create · ops-ticket-update
  ops-features(«기능 스위치» — byoAiKey) · ops-audit · ops-ai-sync · ops-backup-status · ops-price-event-cancel
```
- `verify-api-surface` 가 이미 «안 부르는 API 44종»을 세는데 **△ 알림이라 아무도 안 본다** — 그래서 킬 스위치도 안 걸렸다.
- 🔴 `ops-*` **POST** 는 크론이 안 부른다(운영자가 손으로 누르는 것뿐) — 그래서 **이 표는 게이트로 만들 수 있다.** 다만 13개 중 무엇이 «아직»이고 무엇이 «일부러»인지는 **내가 혼자 정할 것이 아니다**(통째 콘솔이 둘이다).
- 🔴 `ops-features` 는 **내 라우트와 다른 표**다(`ops_settings.features` ↔ `feature_flags`) — 두 번째 문이 아니다. 확인했다.

## 6. 안 한 것
- 🔴 **전역 스위치를 라이브로 누르지 않았다** — 761 로만 눌렀고 끝나고 지웠다(`feature_flags` 0행, 시작과 같다).
- DDL 안 썼다(표는 `0008` 에 이미 있다) — 내 칸 `0084~0089` 는 **그대로 남는다**.
- 위 §5 의 13개는 **안 고쳤다**(메인이 나눈다).
