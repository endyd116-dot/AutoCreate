# LICENSES — 우리가 만든 콘텐츠에 들어가는 남의 것(폰트 · 배경음악 · AI 모델)

> 작성 2026-09-15 · B3(P1R7 · 전수조사 §19 «법·약관» — 약관 `terms.html` 은 «회사가 확인한 것만 씁니다» 한 줄만 있고 **표가 없었다**).
> 정본 = 이 문서. 값의 출처는 전부 코드다(아래 «코드 자리» 열) — 코드를 고치면 **이 표를 같이 고치는 것까지가 수정**이다.
> 🔴 이 문서는 «법률 자문»이 아니라 **우리가 지금 무엇을 쓰고 있는지의 목록**이다. 약관·개인정보처리방침과 함께 법률 검토 대상(§19).

---

## 0. 한 줄

고객이 만든 글·영상에 실리는 남의 창작물은 **① 폰트 1종 ② 배경음악 12곡 ③ 생성 AI(글·이미지·영상·목소리)** 뿐이다.
전부 **상업 사용이 허용된 것만** 쓰고, 조건이 애매한 것은 **코드가 거부**한다(`BANNED_PROVIDERS`).

---

## 1. 폰트

| 쓰는 곳 | 폰트 | 라이선스 | 재배포 조건 | 코드 자리 |
|---|---|---|---|---|
| 앱·운영센터 화면 | Pretendard Variable (dynamic subset) | **SIL Open Font License 1.1** | 무료·상업 가 · **폰트 파일 자체를 팔지 않는 한** 임베드·재배포 가능 · 저작권 고지 유지 | `scripts/build-pages.mjs:7`(jsDelivr CDN) |
| 공유 카드 PNG(서버 렌더) | Pretendard Regular/Bold `.otf` **동봉** | OFL 1.1 | 위와 같음 — 우리가 파일을 함께 배포하므로 **OFL 고지를 유지**해야 한다(이 문서가 그 고지 자리) | `assets/fonts/Pretendard-{Regular,Bold}.otf` · `netlify.toml [functions."share-card"] included_files` |
| 영상 자막 번인(러너) | Pretendard(러너 PC 에 있으면) → 없으면 시스템 산세리프 | OFL 1.1 / OS 기본 폰트 | 러너는 **고객 PC 의 폰트를 쓴다** — 우리가 재배포하지 않는다 | `runner/channels/render-video.mjs:165` |

- ⚠️ 시스템 폰트 폴백(`Malgun Gothic`·`Apple SD Gothic Neo`)은 **OS 에 딸린 것**이라 우리가 배포하지 않는다. 영상에 번인될 때도 «그 PC 의 글꼴»이다.
- OFL 원문: https://openfontlicense.org · Pretendard: https://github.com/orioncactus/pretendard

## 2. 배경음악(영상)

| 항목 | 값 |
|---|---|
| 곡 수 | **12곡**(무드 4 × 3 — uplift·calm·focus·warm) |
| 라이선스 | **PD / CC0 1.0 퍼블릭 도메인 헌정** — 상업 사용 가 · 크레딧 불요 · 로열티 없음 |
| 원 카탈로그 | FreePD(Kevin MacLeod 외) · 🔴 원 배포처 `freepd.com` 은 **2026 폐쇄** |
| 실제 받는 곳 | archive.org 공식 미러 `https://archive.org/download/freepd/` (item `freepd`) |
| 우리 보관 | 시드 1회 → R2 `autocreate/bgm/<mood>-<n>.mp3` + `manifest.json`(라이선스 메타 동봉) — 외부 의존 0 |
| 게이트 | `BGM_LICENSE_VERIFIED=1` 이 **꺼져 있으면 무음**(`lib/video/bgm.ts resolveBgm` → null) · 스크립트가 스스로 켜지 않는다 |
| 코드 자리 | `scripts/seed-bgm.mjs` CATALOG/LICENSE · `lib/video/bgm.ts` |

곡 목록(무드 · 제목): uplift = City Sunshine · Funshine · Advertime / calm = Lovely Piano Song · Nostalgic Piano · Study and Relax / focus = Arpent · Meditating Beat · Backbeat / warm = Happy Whistling Ukulele · Be Chillin · Relaxing Ballad.
CC0 원문: https://creativecommons.org/publicdomain/zero/1.0/

## 3. 생성 AI — 출력물의 권리

| 쓰임 | 모델·서비스 | 상업 이용 | 우리 규칙 | 코드 자리 |
|---|---|---|---|---|
| 글·소재·심사 | Google **Gemini**(모델명은 한 파일에만) | 가 — 유료 API 출력물은 고객의 것 | 모델명 문자열은 `lib/ai-models.ts` 밖에 두지 않는다(CLAUDE §4.9) | `lib/ai-models.ts` |
| 이미지 | Gemini 이미지 체인(`CHAIN_IMAGE`) | 가 | **실존 인물·유명인 실사 금지 · 브랜드 로고 금지 · 이미지 안에 한글 굽지 않기**(오버레이로) | `lib/ai-image.ts:19` |
| 영상 컷 | Omni 1.1 Flash · Veo 3.1 Lite/Fast/Pro | 가(1st-party · 한국 공식 지원 · 가시 워터마크 없음 · SynthID 만) | 기본 = Omni + Veo Lite 폴백 | `lib/video/providers/registry.ts:28-31` |
| 영상 컷(선택) | Wan 2.2 / MiniMax Hailuo 02 (fal.ai) | Wan = **Apache 2.0**(무제한 상업·출력 소유) · Hailuo = 상업 허용·초당 과금 | `FAL_KEY` 있을 때만 | 같은 파일 :32-33 |
| 영상 컷(제한) | Kling 2.6 Pro | ⚠️ **자기재사용 조항** — 기본 선택에서 뺐다 | **명시 지정할 때만** 쓴다 | 같은 파일 :34 |
| 목소리(TTS) | 타입캐스트(기본) · Gemini TTS(폴백) | 가 | **프리빌트 보이스만** — 실존 인물 목소리 모사 0 | `lib/video/tts.ts:107` · `tts-typecast.ts` |
| 🔴 쓰지 않는 것 | OpenAI Sora/영상 API · Tencent Hunyuan Video · LTX | — | 코드가 **거부**한다 — Sora = API 종료·인물 입력 거부 · **Hunyuan = 모델 라이선스가 대한민국을 제외**(한국 제품에서 법적 사용 불가) | `registry.ts BANNED_PROVIDERS` |

- **유튜브 합성 콘텐츠 표시**: 영상 업로드는 `status.containsSyntheticMedia = true` 로 보낸다(`lib/publish/youtube.ts`) — AI 생성 사실을 플랫폼에 정직하게 알린다(§16B.3).
- **생성물의 권리**: 이용약관 §«생성물의 권리» — 고객이 만든 글·영상의 권리는 **고객**, 회사는 서비스 제공 목적의 이용권만(`public/terms.html`).

## 4. 그 밖에 배포에 실리는 것

| 항목 | 라이선스 | 비고 |
|---|---|---|
| ffmpeg(러너 렌더) | LGPL/GPL(빌드마다 다름) | 🔴 **우리가 배포하지 않는다** — 고객 PC 에 설치된 것을 찾아 쓴다(`FFMPEG_PATH` → PATH → winget → 표준 경로). 러너 zip 에 ffmpeg 바이너리를 넣게 되면 **그 빌드의 라이선스를 이 표에 먼저 적는다**. |
| Playwright / Chromium(러너) | Apache 2.0 / BSD | 러너 설치 시 `playwright install chromium` 으로 고객 PC 에 받는다 |
| npm 의존성(서버·러너) | MIT/Apache 2.0 계열 | `package.json` · 새 의존성이 카피레프트면 이 표에 적고 검토 |

## 5. 언제 이 문서를 고치나

- `scripts/seed-bgm.mjs` CATALOG 에 곡을 더하거나 뺄 때 · 미러 주소가 바뀔 때
- `lib/video/providers/registry.ts` 에 provider 를 더하거나 `BANNED_PROVIDERS` 를 바꿀 때
- 폰트를 바꾸거나 **러너 zip 에 폰트·ffmpeg 를 동봉**하기로 할 때(재배포 조건이 생긴다)
- 분기 1회 «정책 재확인»(§16B.4) 때 이 표도 같이 본다
