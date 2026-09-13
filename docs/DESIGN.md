# AutoCreate 시스템 설계서 v1

> 작성 2026-09-14 · 상태 **초안(사장님 검토 대기)** · 정본 위치 `docs/DESIGN.md`
> 출처: AutoMarketing(AM) 코드 실측(`../AutoMarketing/lib`·`scripts`·`db/schema.ts`), 싸이렌MIS SSO 실측(`../tbfa-mis/netlify/functions/sso-marketing.ts`), 외부 채널 정책 조사(2026-09).

---

## 0. 한 줄 정의

**AutoCreate(AC)** = 부수입을 원하는 개인이 **여러 계정**으로 **글**과 **영상**을 AI로 만들어 **자동 발행**하고, 거기서 나온 **광고·제휴 수익을 한 곳에서 보는** 토스형 SaaS.

AM이 "회사의 마케팅 직원"이라면 AC는 "**개인의 수익 공장**"이다. 엔진(소재·디렉터·글·이미지·쇼츠·러너·코인·SSO)은 AM에서 떼어 오고, **겉(제품 정의·화면·계정 모델·수익 집계)은 새로 짠다.**

### 설계 원칙 6가지

| # | 원칙 | 뜻 |
|---|---|---|
| 1 | **디렉터가 앞에 선다** | 소재를 받으면 «어느 채널·어느 계정에·어떤 감성·어떤 구성으로·언제»를 디렉터가 먼저 정한다. 사람은 그 지시서를 «이대로» 또는 «손보기»만 한다. |
| 2 | **채널 감성 자동 적응** | 같은 소재도 네이버 블로그·티스토리·쇼츠·클립은 다른 글이다. 채널별 톤·구성 계약(AM `content-tone`)이 정본. |
| 3 | **API 있으면 API, 없으면 러너** | 발행 경로는 채널 레지스트리 한 곳이 결정한다. 화면·큐·상태기계는 경로를 모른다. |
| 4 | **계정은 소모품, 수익은 계속** | 한 계정 정지 → 같은 채널의 다음 건강한 계정으로 자동 승계. 계정 간 글 중복 0. |
| 5 | **한 화면 한 목적(토스형)** | 큰 숫자 하나·CTA 하나·설명 한 문장. 옵션은 바텀시트로 숨긴다. |
| 6 | **AI 이름은 한 파일** | 모델명은 `lib/ai-models.ts`에만 산다. 업데이트는 자동 검증→(자동/수동) 승격→롤백 가능. |

### 이 설계에서 확인이 필요한 것 (사장님 결정)

| # | 질문 | 이 문서의 가정 |
|---|---|---|
| Q1 | "S스토리"는 **티스토리**가 맞는가? | 티스토리로 가정(애드센스 대표 채널). |
| Q2 | 구독 가격 (§12 3안) | Starter 19,000 · Pro 49,000 · Agency 149,000 /월 |
| Q3 | **관리형 러너**(우리 서버가 대신 브라우저 발행) 제공 여부 | Pro 옵션·Agency 포함으로 가정. 원가(서버 1대/러너 30~50계정) 별도 산정 필요. |
| Q4 | 유튜브·틱톡 API 앱 심사를 **우리 앱 하나**로 받고 고객이 OAuth로 붙는 방식 동의 여부 | 동의 가정(고객이 각자 앱을 만드는 건 비현실적). |
| Q5 | 계정별 **프록시(IP 분리)** 제공 여부 | 기본 미제공·«내 프록시 등록» 필드만 제공으로 가정. |
| Q6 | 브랜드 컬러·로고 | **잉크 블랙 액센트**(v3 · 블루 제거). 별도 브랜드색은 토큰 `--brand` 하나로 교체 가능. |

---

## 1. 제품 범위

### 1.1 사용자
- **주 사용자**: 부수입 목적의 개인(직장인·주부·프리랜서). 계정 2~30개. 하루 5~15분만 쓰고 싶어 한다.
- **부 사용자**: 소규모 대행/스튜디오(Agency 플랜·팀 시트).
- **운영자**: 우리(싸이렌MIS에서 SSO 진입 · super_admin/admin/operator).

### 1.2 두 축 × 여섯 단계

```
        소재(AI 트렌드) → 디렉터(구성·배치) → 제작 → 검수 → 발행(자동/예약) → 수익 집계
 글  축 ──────────────────────────────────────────────────────────────────────▶
 영상 축 ──────────────────────────────────────────────────────────────────────▶
```

### 1.3 비범위(v1에서 안 한다)
- 광고 집행(AM의 광고 엔진 전체) — AC는 **무료 채널 오가닉**만.
- 리드·너처링·CRM — 없음.
- 라이브 스트리밍(치지직·SOOP), 롱폼 유튜브 편집.

---

## 2. 채널 매트릭스 (조사 2026-09 · 코드 정본 = `lib/channel-registry.ts`)

### 2.1 글 채널

| 채널 | 붙일 수 있는 수익 | 발행 방식 | AM 자산 | 우선순위 |
|---|---|---|---|---|
| **네이버 블로그** | 애드포스트 · 쿠팡파트너스 · 네이버 쇼핑커넥트 · 제휴링크 | **러너**(글쓰기 API 없음·스마트에디터 ONE) | `scripts/naver-blog-runner.mjs` · `content-runner-core.mjs` 이식 | P1 |
| **티스토리** | 애드센스 · 카카오 애드핏 · 제휴 | **러너**(Open API 2024-02 종료) | 러너 코어 재사용·에디터 셀렉터 신규 | P1 |
| **구글 블로거(Blogspot)** | 애드센스 | **API**(Blogger API v3·OAuth) | 신규 커넥터 | P1 |
| **워드프레스**(자체호스팅·WP.com) | 애드센스 · Ezoic · 제휴 | **API**(REST + Application Password / WP.com OAuth) | 신규 커넥터 | P2 |
| **네이버 클립 «게시물형»**(텍스트+이미지) | 클립 인센티브(2026 게시물형 확대) | 러너(모바일 중심 → 검증 필요) | — | P3 |
| 쓰레드 | 직접 수익 없음 · 유입/제휴 | API | `publish-threads.ts` | P2(보조 배포) |
| 인스타 피드·카드뉴스 | 제휴 | API | `publish-instagram.ts` | P2(보조) |
| 페이스북 페이지 | 인스트림·제휴 | API | `publish-facebook.ts` | P3 |
| X(트위터) | 프리미엄 광고수익 공유 | API(유료) | — | P4 선택 |
| 브런치스토리 | 광고 불가(구독·제휴 유도) | 러너(작가 승인 필요) | — | P4 |
| 미디엄·서브스택 | 파트너 KR 미지원 / 유료구독 | API 제한·없음 | — | 보류 |

### 2.2 영상 채널

| 채널 | 붙일 수 있는 수익 | 발행 방식 | 제약 | 우선순위 |
|---|---|---|---|---|
| **유튜브 쇼츠** | YPP 쇼츠 광고수익(애드센스) · 유튜브 쇼핑 제휴 · 설명란 쿠팡 | **API**(Data API v3 `videos.insert`) | **앱 심사 전 업로드는 비공개 고정** · 일 쿼터 10,000u(업로드 1,600u ≈ 6건/일/프로젝트 → 쿼터 증설 신청) | P1 |
| **네이버 클립** | 광고 인센티브(정식) · 피드형 보상(시범→정식) · 쇼핑커넥트 | **러너**(API 없음) | PC 업로드 경로 검증 필요 → 실패 시 Android 에뮬 자동화 | P1 |
| **인스타 릴스** | 직접 수익 없음(초대제 보너스) · 제휴 | API(REELS 컨테이너·폴링) | `publish-instagram.ts` REELS 로직 이식 | P2 |
| **쓰레드 영상** | 없음 · 유입 | API | `publish-threads.ts` 확장(VIDEO) | P2 |
| **틱톡** | 크리에이터 리워드 **KR 미지원(확인 필요)** · 제휴 | API(Content Posting) | 심사 전 «본인만 보기» 고정 | P3 |
| 페이스북 릴스 | 인스트림(초대) | API | — | P3 |
| 유튜브 롱폼 · X 영상 | YPP / 프리미엄 | API | — | P4 |

### 2.3 수익 매체(광고·제휴)와 «집계» 가능성

| 수익 매체 | 성격 | 수익 데이터 회수 | 글 단위 귀속 |
|---|---|---|---|
| 구글 **애드센스** | 광고 | **API**(AdSense Management API·OAuth·일별 리포트) | 사이트/채널 단위(URL 채널 설정 시 페이지 단위 가능) |
| 네이버 **애드포스트** | 광고 | API 없음 → **러너 스크랩**(adpost.naver.com 리포트) | 미디어(블로그) 단위 |
| 카카오 **애드핏** | 광고 | API 없음 → 러너 스크랩 / 수동 | 매체 단위 |
| **유튜브 파트너**(YPP) | 광고 | **API**(YouTube Analytics `estimatedRevenue`·monetary 스코프) | 영상 단위 ✔ |
| **네이버 클립 인센티브** | 플랫폼 보상 | 러너 스크랩(크리에이터 센터) | 클립 단위 |
| **쿠팡 파트너스** | 제휴(CPS) | **API**(Reports/commission·익일 12:30 이후) | **subId = piece id → 글 단위 ✔** |
| 알리익스프레스 어필리에이트 | 제휴 | API | 트래킹ID → 글 단위 ✔ |
| 링크프라이스 · 텐핑 · 애드픽 | 제휴 | API(링크프라이스) / 수동 | 부분 |
| 네이버 쇼핑커넥트 | 제휴 | 러너/수동 | 부분 |
| 메타 보너스 · 틱톡 리워드 · X 프리미엄 | 플랫폼 보상 | 수동 입력 | — |

> **집계 설계 결론**: 소스별 «자동(API) / 반자동(러너) / 수동(입력)» 3등급을 두고, 화면은 등급을 숨기지 않는다(«어제 12:30 기준 · 러너 회수»처럼 신선도를 표기). 제휴 링크는 **전부 piece id를 subId로 심어** 글/영상 단위 수익을 잡는다.

---

## 3. 아키텍처

### 3.1 스택 (AM·MIS와 동일 — 엔진을 «파일째» 옮기기 위함)

| 영역 | 기술 | 이유 |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS **모바일 퍼스트 PWA** + 새 디자인 시스템(`public/css/ac.css`) | AM `shell.js`·컴포넌트 관례 재사용. 토스형은 프레임워크가 아니라 규율의 문제. |
| Backend | Netlify Functions v2(Node 20) · TypeScript | AM `lib/*.ts` 무수정 이식 가능 |
| DB | Neon PostgreSQL + Drizzle (신규 인스턴스 `autocreate`) | AM 스키마 패턴·`scripts/neon-migrate.mjs` 그대로 |
| AI | Gemini(`lib/ai-models.ts` 단일 출처) · 이미지 `CHAIN_IMAGE` · TTS · 영상 provider 레지스트리(`video-providers`) | AM 실측 체인 |
| 러너 | Node + Playwright(크로미움) + ffmpeg · Windows 런처 → 트레이 앱 | AM `content-runner-core.mjs`·`creative-render.ts` |
| 스토리지 | Cloudflare R2(이미지·영상·프레임) | AM presigned PUT 관례 |
| 결제 | KICC(`lib/kicc.ts`·`billing.ts`·`coin-purchase.ts`) | AM 라이브 코드 |
| Cron | Netlify Scheduled + GitHub Actions 보조 | AM 관례 |
| 배포 | GitHub `endyd116-dot/AutoCreate` → Netlify `autocreate-endyd` (연동 완료) | |

### 3.2 구성도

```mermaid
flowchart LR
  subgraph Client[고객 화면 · PWA]
    UI[홈 / 만들기 / 발행함 / 수익 / 내 계정]
  end
  subgraph Edge[Netlify Functions]
    API[/api/* 핸들러]
    DIR[디렉터 엔진]
    GEN[글·이미지·쇼츠 생성]
    PUB[발행 디스패처]
    REV[수익 수집기]
    CRON[크론: 소재 리필·예약 발행·수익 동기화·AI 모델 감시]
  end
  DB[(Neon PostgreSQL)]
  R2[(R2 스토리지)]
  subgraph Runner[AutoCreate 러너 · 고객 PC 또는 관리형]
    RQ[큐 소비: 발행·렌더·세션·수익 스크랩]
    BR[계정별 브라우저 프로필]
  end
  subgraph Ext[외부]
    APIC[API 채널: 블로거·WP·유튜브·인스타·쓰레드·틱톡]
    RUNC[러너 채널: 네이버 블로그·티스토리·클립]
    ADS[수익 API: 애드센스·유튜브 애널리틱스·쿠팡·알리]
  end
  MIS[싸이렌 MIS 허브 SSO]
  UI --> API --> DB
  API --> DIR --> GEN --> R2
  CRON --> PUB
  PUB -->|API 채널| APIC
  PUB -->|러너 채널| RQ --> BR --> RUNC
  REV --> ADS
  RQ -->|애드포스트·클립 스크랩| REV
  MIS -->|60초 토큰| API
```

### 3.3 AM 재사용 맵

| AC 모듈 | AM 원본 | 처리 |
|---|---|---|
| 인증·세션·운영자 | `lib/auth.ts` · `admin-guard.ts` · `sso-role.ts` · `sso-enter.ts` | **그대로**(aud만 `autocreate`) |
| 테넌트·플랜 게이트 | `plan-gate.ts` · `ops-tenants.ts` | 플랜 표만 교체 |
| 코인 | `coin-ledger.ts` · `coin-purchase.ts` · `coin-invoice.ts` · `coin-refund.ts` · `coin-reconcile.ts` | **그대로**(구간표 동일) |
| 결제 | `kicc.ts` · `billing.ts` · `billing-math.ts` | 그대로 |
| AI 호출·캐시·미터 | `ai.ts` · `ai-models.ts` · `ai-cache.ts` · `ai-meter.ts` · `ai-cost.ts` · `ai-key.ts` | 그대로 + §10 오버레이 |
| 소재 | `content-topics.ts`(스코어링·퍼널) · `shorts-topics.ts`(뱅크·30일 중복) · 네이버 검색량(`naver-keyword-acquire`의 조회 프리미티브) | **일반화**: 세그먼트→«수익 니치» 입력으로 |
| 디렉터 | `content-director.ts`(사실수집·컨셉·장면·채널문법·AI티 검사) · `content-tone.ts`(채널 톤·구성 5종 로테이션) | **확장**: 다채널 배치·계정 배정·감성 프로파일 |
| 글 생성 | `content-gen.ts` · `content-image.ts`/`content-images.ts` · `content-thumbnail.ts` · `content-tags.ts` | 그대로 |
| 쇼츠 공장 | `shorts-script.ts`(팩트체크 대본) · `shorts-scenes.ts` · `creative-render.ts` · `creative-tts.ts` · `shorts-captions.ts` · `video-render.ts`(BGM) · `video-providers/*` · `shorts-loop.ts` | 이식 + 디벨롭(§6) |
| 발행 커넥터 | `publish-threads/instagram/facebook.ts` · `naver-publish-verify.ts` | 그대로 + 신규(블로거·WP·유튜브·틱톡) |
| 러너 | `content-runner.ts`(큐 상태기계) · `runner-jobs.ts` · `runner-block.ts`(차단 사유 분류) · `scripts/content-runner-core.mjs` · `naver-blog-runner.mjs` · `runner-start.bat` | 이식 + 다계정 프로필(§8) |
| 채널 자격 | `channel-creds.ts`(AES-256-GCM) · `channel-accounts.ts`(연결 상태 판정) | **핵심 변경**: 테넌트당 1연결 → **계정 N개** |
| 품질 게이트 | `ad-law-banned.ts`(광고법 금칙어) · `ad-copy-similarity.ts`(유사도) · `content-link-verify.ts` | 그대로(계정 간 중복 검사에 재사용) |
| 알림·감사 | `audit.ts` · notifications 계열 | 그대로 |

**안 가져오는 것**: 광고 집행(`ad-*`, `ads-*`, `adgroup-*`, `bid-*`, `budget-*`) · 리드/너처링 · 랜딩 · 제안서 · 두뇌(brain) · 챗 에이전트.

---

## 4. 핵심 파이프라인 · 상태기계

### 4.1 객체 4개

| 객체 | 뜻 | 상태 |
|---|---|---|
| **topic**(소재) | «무엇에 대해» — 주제·앵글·검색량·수익 태그 | `candidate → picked → used / expired(7일)` |
| **brief**(제작 지시서) | 디렉터의 결정 — 채널×계정×감성×구성×일정 | `proposed → confirmed(자동 or 사람) → producing → done` |
| **piece**(산출물) | 글/영상 1건 = 채널 1개·계정 1개 | `generating → draft → in_review → approved → scheduled → publishing → published` / `awaiting_manual` / `failed` / `rejected` |
| **post**(발행 결과) | 외부 URL·채널 ref·발행 시각·회수 통계 | 불변 이력 |

한 brief는 piece를 N개 낳는다(예: 소재 1개 → 네이버 블로그 계정A 경험담 + 티스토리 계정B 정보형 + 쇼츠 계정C 60초).

### 4.2 흐름

```mermaid
stateDiagram-v2
  [*] --> 소재후보: 크론 리필 / 사용자 «소재 뽑기»
  소재후보 --> 지시서제안: 디렉터(자동)
  지시서제안 --> 지시서확정: «이대로» / 손보기 / 자동모드
  지시서확정 --> 생성중: 코인 선차감(멱등 ref=piece)
  생성중 --> 초안: 글·이미지·영상 완성
  초안 --> 검수대기: 코드 게이트(금칙어·AI티·유사도·링크)
  검수대기 --> 승인: 사용자 승인 / 자동승인(신뢰 계정)
  검수대기 --> 반려: 재생성(무료·1회) 또는 폐기
  승인 --> 예약: 디렉터 슬롯(계정별 캐던스 준수)
  예약 --> 발행중: 크론 due → API 즉시 / 러너 claim
  발행중 --> 발행완료: URL 회수
  발행중 --> 수동대기: 러너 실패(캡차·정지) + 알림
  발행중 --> 예약: 러너 셋업 실패(release·재시도)
  발행완료 --> 수익매칭: 애드센스/쿠팡/유튜브 동기화
```

### 4.3 불변식
- **코인은 piece 단위 1회**(AM `consumeCoins` 멱등 ref). 재생성·수리·재시도 무료.
- **발행 멱등**: `channel_ref` 또는 `external_url` 있으면 재게시 금지.
- **계정 캐던스**: 계정별 `daily_cap`·`min_gap_min`을 예약 슬롯이 넘지 못한다(정지 예방).
- **계정 간 중복 0**: 같은 brief의 piece끼리 본문 유사도 > 임계면 디렉터가 앵글을 바꿔 다시 쓴다(`ad-copy-similarity`).
- **광고 표시 의무 자동 삽입**: 제휴 링크 포함 piece는 채널별 고지 문구(«쿠팡 파트너스 활동의 일환으로…»)를 코드가 넣는다. 사람이 지워도 발행 직전 다시 검사.

---

## 5. 디렉터 (모든 기능의 앞)

### 5.1 정의
디렉터 = **소재 1개 + 계정 풀 + 목표(수익 매체)**를 입력받아 **제작 지시서(brief)**를 내는 결정 계층. 글쓰기·영상 엔진은 지시서만 본다(AM `content-director`의 «앞뒤만 한다» 원칙 유지 — 두뇌를 하나 더 만들지 않는다).

### 5.2 지시서 스키마

```ts
interface ProductionBrief {
  id: string; tenantId: number; topicId: string;
  goal: "adsense" | "adpost" | "affiliate" | "ypp" | "clip_incentive" | "mixed";
  pieces: Array<{
    channel: ChannelKey;            // naver_blog | tistory | blogger | wordpress | youtube_shorts | naver_clip | reels | threads | tiktok ...
    accountId: number;              // 계정 풀에서 배정(건강도·캐던스·페르소나 적합도)
    format: "longform" | "listicle" | "qna" | "compare" | "story" | "cardnews" | "shorts_graphic" | "shorts_talk" | "clip_life";
    emotion: EmotionProfile;        // §5.4
    composition: CompositionKey;    // AM 구성 5종 + 신규(수익형: 비교표·체크리스트·후기모음)
    lengthHint: { words?: number; seconds?: 15|30|60 };
    images: { count: number; style: "photo"|"illust"|"infographic"; heroNeeded: boolean };
    monetize: { affiliate?: { provider: "coupang"|"ali"|"linkprice"; productQuery: string; slot: "mid"|"end"|"both" }; adDisclosure: boolean };
    schedule: { at: string; slotReason: string };   // 계정 캐던스·채널 골든타임
    coinCost: number;               // 표시용(정본은 coin-ledger)
  }>;
  reasons: string[];                // «왜 이 배치인가» 사람말 3줄
  mode: "auto" | "reviewed";
}
```

### 5.3 자동 디렉터 결정 규칙(결정론 우선 · LLM은 앵글/감성만)
1. **채널 선택**: 소재의 `channel_hint`(AM `inferChannelHint`) × 사용자가 켠 채널 × 목표 매체. 예: `goal=adsense` → 티스토리/블로거 우선, `adpost` → 네이버 블로그.
2. **계정 배정**: 채널 내 계정 중 `status=active` · 오늘 발행 < `daily_cap` · `health_score` 높은 순 · 페르소나-소재 적합도(LLM 1콜). 같은 소재를 두 계정에 낼 땐 **앵글을 갈라** 배정.
3. **구성 로테이션**: 그 계정의 **직전 글과 같은 구성 금지**(AM `content-tone` 로테이션).
4. **일정**: 채널 골든타임 표 × 계정 `min_gap` × 하루 분산.
5. **수익 슬롯**: 소재의 «상업 의도 점수» ≥ 임계면 제휴 상품 슬롯 배정(쿠팡 검색 API로 상품 후보 3개).
6. **코인 미리보기**: piece별 `coinCostOf(item)` 합계를 지시서에 표기 — 확정 전 총액을 본다.

### 5.4 감성 프로파일(채널 감성 자동 적응)

| 채널 | 기본 감성 | 톤 계약(AM `CHANNEL_TONE` 확장) |
|---|---|---|
| 네이버 블로그 | 경험담·친근 | 구어 «~했어요/~더라고요» · 사진 6~10장 · 소제목 인용구 · 해시태그 |
| 티스토리 | 정보·정리 | 소제목 H2/H3 · 표·체크리스트 · 서론-본론-결론 · 애드센스 삽입 자리(중간/끝) |
| 블로거·WP | SEO 정보 | 메타 설명 · FAQ(AEO) · 1,200~1,800자 |
| 쓰레드 | 훅·짧게 | 첫 줄 훅 · 3~5줄 · 댓글에 링크 |
| 유튜브 쇼츠 | 3초 훅·자막 본체 | 문장 4~10 · 반전/문제해결 · 무음 시청 전제(AM `creative-tts` 원칙) |
| 네이버 클립 | 생활밀착·네이버 톤 | 15~30초 · 상단 자막 크게 · 쇼핑커넥트 태그 |
| 릴스 | 감성 b-roll | 텍스트 오버레이 · BGM 무드 |

프로파일은 **DB 표(`emotion_profiles`) + 코드 기본값**. 운영자가 화면에서 조정 가능(코드 재배포 0).

### 5.5 디렉터 화면(토스형)
- 자동안을 **카드 한 장**으로 보여준다: «네이버 블로그(계정 @a) 경험담 · 티스토리(@b) 비교표 · 쇼츠(@c) 60초 — 총 30코인 · 내일 09:00/12:00/19:00».
- CTA 두 개뿐: **«이대로 만들기»** / «손보기». 손보기 = 바텀시트(채널 토글·계정 선택·감성 칩·구성 칩·이미지 수·제휴 상품·시각).
- «디렉터에게 맡기기» 스위치 ON이면 이 화면을 건너뛴다(자동모드·신뢰 계정만 자동승인).

---

## 5B. 편성표 — 자동 스케줄러 (사장님 요청 2026-09-14)

### 5B.0 한 줄
**규칙 한 번 → 소재는 편성자가 → 발행 D-3에 자동 제작 → 3일 검수창 → 당일 채널별 최적 시간에 자동 발행.** 작게는 1주, 많게는 한 달치가 스스로 굴러간다.

### 5B.1 메뉴 이름 — 추천 **«편성표»**
- 방송국 용어라 «디렉터»와 짝이 맞고, 사람말이며 두 글자다. 「자동화 스케줄링」은 시스템 용어(헌장 금지).
- **하단 탭 «발행함» → «편성표»로 교체**한다(탭 5개 유지). 발행 결과도 편성표 달력의 «발행됨» 칩으로 보이므로 발행함이 따로 필요 없다.
- 켜는 동작의 이름: **«자동 편성 켜기»**. 홈의 «디렉터에게 맡기기» 토글은 이 기능의 별칭이 된다(둘이 같은 설정을 가리킨다 — 정본은 편성표).
- 차선: «루틴», «달력». 비추: «오토파일럿»(AM 용어·고객에겐 낯설다).

### 5B.2 흐름(시간축)

```
D-∞  규칙 설정(1회)   채널 × 계정 × 종류 × 빈도(일/주/월) × 선호 시간 → cadence_rules
D-7  소재 편성        편성자(AM editorial-board)가 다음 1주(또는 2주·4주) 슬롯마다 소재·앵글 배정 → 알림 «다음 주 소재 12개 정했어요»
D-3  자동 제작        (produceLeadDays 기본 3·1~7) 디렉터 → 글·이미지·영상 생성 → 코인 차감 → in_review
D-3 ~ D-0  검수창     사람이 수정·교체·건너뛰기·컨펌. 조용하면 자동 승인(reviewPolicy 기본)
D-0  발행             채널별 최적 시간(bestTime 기본표 + 실측 학습 + 사용자 고정값) → API/러너 발행 → «발행됨»
D+1  수익 매칭        revenue_daily → 슬롯에 «이 글 ₩N» 되먹임 → 편성자 성과 팩터
```

### 5B.3 규칙(cadence_rules) — 사용자가 정하는 것

| 필드 | 뜻 | 기본 |
|---|---|---|
| `channel` | 채널 | — |
| `kind` | 글 · 쇼츠 · 카드뉴스 | 채널에 맞는 것 |
| `account_mode` | 고정 계정 / **자동 로테이션**(그룹 내 건강도 순) | 자동 |
| `every` | 주 N회 / 월 N회 / 매일 | 주 3회 |
| `weekdays[]` | 요일(비우면 자동 분산) | 자동 |
| `preferred_hour` | 고정 시각(KST) — 비우면 채널 최적 시간 | 자동 |
| `format_hint` | 경험담·정보·비교… (비우면 디렉터 로테이션) | 자동 |
| `active` | 켜짐/꺼짐 | 켜짐 |

예) «네이버 블로그 · 글 · 주 3회 · 계정 자동» + «유튜브 쇼츠 · 매일 · @short_c» + «티스토리 · 글 · 주 2회 · 토·일».

### 5B.4 변수(settings.schedule) — 사장님이 «변수로»라고 한 것들

| 변수 | 기본 | 범위 | 뜻 |
|---|---|---|---|
| `horizonDays` | 14 | 7 · 14 · 30 | 달력을 얼마나 앞서 채워 두나(1주~한 달치) |
| `topicLeadDays` | 7 | 3~14 | 발행 며칠 전에 소재를 배정하나 |
| `produceLeadDays` | **3** | 1~7 | 발행 며칠 전에 제작하나(검수창 길이) |
| `produceHour` | 06:00 | — | 제작 실행 시각(밤새 만들어 아침에 보게) |
| `reviewPolicy` | `silence_approves` | `silence_approves` · `require_confirm` | 조용하면 자동 승인 / 반드시 컨펌 |
| `bestTimeMode` | `auto` | `auto` · `fixed` | 채널 최적 시간 자동 / 규칙의 고정 시각만 |
| `weeklyCoinCap` | 플랜 포함분 | 숫자 | 한 주 자동 소비 상한(넘으면 슬롯 «코인 부족» 표시·제작 보류) |
| `quietDays[]` | 없음 | 날짜 | 쉬는 날(명절·휴가) — 슬롯을 만들지 않는다 |

### 5B.5 채널별 최적 시간 기본표(`lib/best-time.ts` · 실측으로 갱신)

| 채널 | 기본 후보(KST) | 학습 |
|---|---|---|
| 네이버 블로그 | 07:30 · 12:00 · 21:00 | 발행 후 24h 조회(러너 회수)로 계정별 갱신 |
| 티스토리 | 08:00 · 13:00 | 애드센스 페이지뷰 |
| 블로거·WP | 09:00 | 애드센스 |
| 유튜브 쇼츠 | 18:00 · 21:00 | 애널리틱스 조회·시청시간 |
| 네이버 클립 | 19:00 · 22:00 | 러너 회수 |
| 릴스 | 12:00 · 19:00 | 인사이트 API |
| 쓰레드 | 08:00 · 22:00 | — |

- 같은 채널의 여러 계정은 **같은 시각에 몰지 않는다**(계정 간 최소 간격 30분·§7.3).
- `auto`는 «후보 중 그 계정의 최근 30일 성과가 가장 좋은 시각». 데이터가 없으면 첫 후보.

### 5B.6 슬롯 상태기계(`slots` = AM `topic_slots` 확장)

```
planned ──(D-7 편성자)──▶ topic_assigned ──(D-3 06:00)──▶ producing ──▶ in_review
   │                           │                                          │
   │ skipped(사용자·휴일)      │ no_topic → 소재 뱅크 필러 · 알림          ├─ approved(컨펌 or 조용)
   │                           │                                          ├─ edited(수정 후 재검사·코인 0)
   │                           │ coin_short → 보류 · D-3 알림             └─ rejected → 재생성 1회(무료) / skip
   ▼                                                                      ▼
                                                            scheduled ──(D-0 최적시각)──▶ publishing ──▶ published
                                                                                              ├─ awaiting_manual(러너 실패·알림)
                                                                                              ├─ awaiting_runner(러너 오프라인 30분+)
                                                                                              └─ reassigned(계정 정지 → 그룹 다음 계정·§7.2)
```

- **정본은 슬롯 하나**: piece·brief·post는 슬롯을 가리킨다. 슬롯 없는 자동 생성은 게이트가 거부하고 감사에 남긴다(AM `content-slot-gate` 그대로 — «주 0회로 뒀는데 계속 만들어지는» 사고 방지).
- 수동 «만들기»(홈 탭)는 슬롯 없이도 되지만, 만든 글을 편성표에 **끼워 넣으면** 그날 자동 슬롯 하나를 대체한다(중복 발행 방지).

### 5B.7 크론(전부 `cron-tick-*` 우산 아래 스텝)

| 스텝 | 주기 | 하는 일 |
|---|---|---|
| `slots.roll` | 매일 00:10 | `horizonDays`까지 규칙대로 슬롯 생성(quietDays 제외·멱등) |
| `slots.assign_topics` | 매일 00:20 | `topicLeadDays` 안에 든 `planned` 슬롯에 편성자가 소재 배정 |
| `slots.produce` | 매일 `produceHour` | `produceLeadDays` 안의 `topic_assigned` → 디렉터·생성(코인 캡 확인) |
| `slots.review_deadline` | 매시 | `silence_approves`면 D-0 02:00까지 미반려 → approved |
| `publisher` | 5분 | due `scheduled` → API 즉시 / 러너 claim |
| `slots.learn` | 매일 | 발행 성과 → best-time·편성자 팩터 갱신 |

### 5B.8 화면(편성표 탭 · 토스형)

- **첫 진입(규칙 없음)**: 빈 상태 한 문장 «규칙 하나면 한 달치가 알아서 나가요» + CTA «자동 편성 켜기» → 3스텝 시트 ① 얼마나 자주(채널 행마다 «주 N회» 선택) ② 어느 계정(자동 로테이션 기본) ③ 검수 방식(«3일 전에 만들어 두고, 조용하면 발행» 기본) → 끝에 «이 편성이면 주 84코인 · 포함분 150 안» 코인 미리보기.
- **평소**: 상단 세그먼트 «주 / 월». 주 보기 = 날짜별 리스트(행 = 슬롯: 채널·계정·제목·상태 칩·시각). 월 보기 = 달력 점(채널 색 아님·상태 색만).
- **슬롯 탭 → 바텀시트**: 미리보기 · 소재 바꾸기 · 시각 바꾸기 · 지금 만들기 · 건너뛰기. 검수창 슬롯은 «수정하기 / 이대로 발행» 두 버튼.
- **홈과의 연결**: 홈 «해야 할 일»에 «검수 기다리는 글 N건(내일 발행)»이 뜬다. 편성표는 계획, 홈은 오늘 할 일.
- 데스크톱: 좌 640px 주간 리스트 + 우 300px 패널(선택 슬롯 미리보기·수정).

### 5B.9 코인·플랜
- 코인은 **제작 시점(D-3)** 에 piece 단위로 1회 차감(§4.3). 수정·재생성·승계는 무료.
- `weeklyCoinCap` 초과분은 슬롯을 «코인 부족»으로 두고 D-3 알림 → 충전하면 다음 `produce` 스텝에서 만든다.
- 플랜: Starter = 규칙 3개·horizon 7일 · Pro = 규칙 무제한·30일·자동 승인 · Agency = + 팀 컨펌 흐름.

### 5B.10 AM 재사용
`editorial-board.ts`/`editorial-board-slots.ts`(편성자·슬롯 원장) · `content-planner.buildProductionPlan`(슬롯→생성 항목·KST→UTC 단일 지점) · `content-slot-gate.ts` · `content-approve.ts`(원클릭 승인·금칙어 재검사) · `content-autopilot.ts`(토글) · `cron-tick-5m/hourly` · `organic-cadence.ts`(주 N회 캡). 신규: `cadence_rules` 표 · `best-time.ts` · 검수창 정책 · 코인 캡.

---

## 6. 쇼츠 공장 (AM SHORTS1 이식 + 디벨롭)

### 6.1 이식하는 체인
`shorts-topics`(소재 뱅크) → `shorts-script`(대본 + **Google 검색 팩트체크 왕복** + 광고법 게이트) → `shorts-scenes`(컷 계획·충돌 점검) → 이미지/클립 생성(`video-providers` i2v·`CHAIN_IMAGE`) → `creative-tts`(자막 본체·나레이션 보조·읽기 전처리) → `creative-render`(러너 크롬 프레임 캡처 + ffmpeg 1080×1920) → 8축 심사 → `shorts-loop`(주 N편 무개입 편성).

### 6.2 디벨롭 항목

| 항목 | AM 현재 | AC |
|---|---|---|
| 포맷 | graphic_story 1종 중심 | **3종**: 그래픽 스토리 · 토킹(TTS+자막+B-roll) · 클립형(15~30초 생활밀착) |
| 채널 규격 | 릴스 중심 | 채널별 프리셋: 쇼츠 60초 이하·클립 15~30·릴스 90 · 세이프존(상하 UI 가림) |
| 수익 슬롯 | 없음 | 엔드카드 «설명란 링크» 컷 · 쇼핑 태그 메타 · 설명란 쿠팡 링크 + 고지 |
| 다계정 | 없음 | 같은 대본을 계정별 **다른 훅·다른 색 팔레트·다른 보이스**로 변주(중복 업로드 판정 회피) |
| 렌더 | 러너 필수 | 동일(서버리스 불가). 관리형 러너 팜에서 병렬 |
| 저작권 | BGM 게이트 `BGM_LICENSE_VERIFIED` | 그대로 + FreePD 라이브러리 R2 시드 이식 |

### 6.3 코인
`video_15=6` · `video_30=12` · `video_60=28`(AM 확정치·원가 $5~7 커버) · 재렌더 무료.

---

## 7. 다계정 모델

### 7.1 데이터

```
accounts
  id · tenant_id · channel · handle · display_name · avatar
  auth_method: oauth | session | api_key | app_password
  cred_id → account_creds(AES-256-GCM · CREDS_ENC_KEY · 평문 노출 표면 2곳 규칙 유지)
  persona_id → personas(말투·관심사·금지어·서명)
  status: active | cooldown | limited | suspended | disconnected | pending_login
  health_score(0~100) · last_error_kind · last_post_at · posts_today
  daily_cap · min_gap_min · golden_hours(jsonb)
  browser_profile_key(러너 프로필 폴더) · proxy_url(선택)
  monetize: { adsense_pub?, adpost_media_id?, coupang_subid_prefix?, ... }
account_groups (같은 채널·같은 니치 묶음 → 페일오버 단위)
```

### 7.2 상태 전이(정지 감지 → 승계)
- 러너/커넥터 실패는 AM `runner-block.classifyRunnerBlock`으로 분류: `login_fail · captcha · rate_limited · suspended · selector_changed · network`.
- `suspended` → 계정 `suspended` + 해당 계정의 `scheduled` piece 전부 **같은 그룹 다음 계정으로 재배정**(디렉터가 앵글 재변주·코인 무료).
- `captcha/login_fail` → `pending_login` + 사용자 푸시 «@a 계정 다시 로그인이 필요해요»(러너 화면에서 헤드풀 브라우저 로그인 → 세션 재보관).
- `rate_limited` → `cooldown` 24h · `daily_cap` 자동 -1.
- health_score = 최근 30일 성공률·경고 횟수·발행 후 삭제 여부(러너 `naver-publish-verify` 재사용)로 산출.

### 7.3 격리(정지 연쇄 방지)
- 러너는 **계정마다 영구 브라우저 프로필**(쿠키·지문 분리). 세션 섞임 0(AM B3 원칙).
- 계정별 `proxy_url`이 있으면 컨텍스트에 적용(Q5).
- 같은 시각 다계정 동시 발행 금지 — 슬롯 스케줄러가 계정 간 최소 간격 강제.
- 본문 유사도 게이트(계정 간).

---

## 8. 러너

### 8.1 형태

| 구분 | 누가 돌리나 | 플랜 |
|---|---|---|
| **내 PC 러너** | 고객 PC(Windows 런처 `runner-start.bat` → v2 트레이 앱) | 전 플랜 |
| **관리형 러너** | 우리 서버(러너 팜·계정 프로필 격리) | Pro 옵션 / Agency 포함 (Q3) |

### 8.2 잡 종류(`runner_jobs.kind`)
`publish.naver_blog` · `publish.tistory` · `publish.naver_clip` · `publish.brunch` · `render.video` · `session.login`(헤드풀 재로그인) · `session.verify` · `revenue.adpost` · `revenue.adfit` · `revenue.clip` · `verify.post_alive`

### 8.3 계약(AM 그대로)
- 큐·상태기계는 **서버 단일 출처**(`/api/runner/queue` claim/report/release · 러너 토큰은 테넌트 스코프).
- claim 시 계정 세션·프로필 키·본문 패키지(`RunnerPiecePackage`)를 내려준다. 러너는 «받은 것만 게시·결과 필보고».
- report는 러너 주장을 믿지 않는다 — URL HEAD/본문 확인 후 `published`.
- 우선순위: 발행 > 세션 > 수익 스크랩 > 렌더.
- 하트비트 60초 → 앱 «러너 온라인/오프라인» 칩. 오프라인 30분이면 due 발행은 `awaiting_runner`로 표기(침묵 금지).

---

## 9. 수익 통합 창구

### 9.0 수익 매체 «신청»은 누가 하나 — 개인이 한다, 우리는 «연동·삽입·추적»을 한다 (사장님 질문 2026-09-14)

애드포스트·애드센스·YPP·쿠팡파트너스는 **본인 명의(신분·세금·계좌) 심사**라 우리가 대신 가입할 수 없다(약관·대리 불가). 우리가 할 수 있는 것은 세 가지다.

| 매체 | 개인이 하는 것 | AC가 하는 것 |
|---|---|---|
| 네이버 애드포스트 | 애드포스트 가입 → 블로그를 «미디어»로 등록 → 심사 통과(글 수·방문 기준) | 계정 상태에 «애드포스트 미등록/심사중/승인» 표시 · **신청 가능 조건 충족 시 알림**(글 N편·방문 N) · 승인 후 광고는 네이버가 자동 삽입(우리가 넣을 코드 없음) · 수익은 러너가 회수 |
| 구글 애드센스 | 애드센스 가입 → 사이트(티스토리/블로거/WP) 추가 → 심사 | **티스토리: 러너가 «수익 설정»에 애드센스 연동/광고 위치 설정** · **블로거·WP: API/템플릿으로 광고 코드 자동 삽입** · 글 본문 «애드센스 자리»는 디렉터가 미리 비워둠 · 수익은 API로 자동 회수 |
| 유튜브 YPP(쇼츠) | 구독 1,000 + 쇼츠 조회 1,000만/90일(또는 시청 4,000h) 충족 후 신청 | 채널 OAuth로 **진행률 게이지**(구독·조회) 표시 → 충족 시 «신청하러 가기» 딥링크 · 승인 후 수익 API 회수 |
| 네이버 클립 인센티브 | 클립 크리에이터 프로그램 지원(기간 모집) | 모집 일정 알림 · 조건 게이지 · 수익 러너 회수 |
| 쿠팡 파트너스 | 가입 → 최종 승인(첫 실적 필요) → API 키 발급 | 계정별 API 키 등록 → **링크 자동 생성(subId=piece)** · 고지 문구 자동 삽입 · 수익 API 회수 |
| 알리·링크프라이스·텐핑 | 가입·키 발급 | 키 등록 → 링크 생성·회수 |

- 온보딩과 «내 계정 → 수익 매체» 화면은 **매체별 «한 화면 한 단계» 가이드**(토스 패턴 사전)로 신청 절차를 안내한다 — 외부 창을 열어주되, 버튼 하나로 «가입 완료했어요» 체크.
- Agency 플랜(관리형)에서는 운영자가 **원격접속(impersonation)으로 셋업을 대행**할 수 있다(가입 자체는 여전히 본인 명의).

### 9.1 소스 커넥터

| 소스 | 방식 | 주기 | 스코프/키 |
|---|---|---|---|
| 애드센스 | API(OAuth `adsense.readonly`) | 일 1회 | 사용자 구글 계정 연결 |
| 유튜브 애널리틱스 | API(`yt-analytics-monetary.readonly`) | 일 1회 | 채널 OAuth(업로드 스코프와 같이 받음) |
| 쿠팡 파트너스 | API(access/secret key 등록) | 일 1회 13:00 | 계정별 키 · subId=piece |
| 알리 어필리에이트 | API | 일 1회 | 앱키 |
| 링크프라이스 | API | 일 1회 | 머천트 키 |
| 애드포스트 · 애드핏 · 클립 | 러너 스크랩 | 일 1회 | 계정 세션 |
| 기타(메타·틱톡·X·스폰서) | 수동 입력 | — | — |

### 9.2 모델
`revenue_daily(tenant_id, source, account_id?, piece_id?, date, amount_krw, currency, fx_rate, freshness: api|runner|manual, raw jsonb)` · 유니크 `(tenant, source, account, piece, date)`.

### 9.3 화면
- 홈 큰 숫자 = **오늘 확정 수익**(어제까지 확정 + 오늘 추정은 회색 «예상»).
- 수익 탭: 이번달 총합 → 소스별 → 계정별 → **글/영상별 TOP 5**(«이 글이 이번 달 38,200원»). 신선도 배지.
- «수익 나는 소재 학습»: piece 수익을 topic factor로 되먹임(AM `performance` 팩터 자리).

---

## 10. AI 버전 관리 (한 파일 + 자동/수동 업데이트)

### 10.1 원칙(AM 2026-09-11 규율 계승)
- 모델 이름 문자열은 **`lib/ai-models.ts`에만**. 다른 파일은 import.
- 목록에 있다고 쓰지 않는다 — **우리 키로 불러 보고** 넣는다(`scripts/verify-ai-models.mjs`).

### 10.2 업데이트 메커니즘

```
lib/ai-models.ts (코드 기본값·정본)
   └─ ai_model_overrides (DB 오버레이 · role → chain[] · applied_by · applied_at · canary_pct)
cron-ai-model-watch (주 1회)
   ① models.list 조회 → 선언 목록과 diff(신규·폐기 예정)
   ② 신규 후보 실측 4종(text / json강제 / googleSearch / image or tts) — 통과만 후보
   ③ 후보 생성 → 운영자 알림(«gemini-3.9-flash 사용 가능 · 4/4 통과»)
   ④ 정책 aiUpdateMode:
        manual → 운영 콘솔 «적용» 버튼(즉시/카나리 10%)
        auto   → 카나리 10% 24h → 실패율·비용 이상 없으면 100% 승격 → 감사 기록
   ⑤ 롤백 버튼 = 오버레이 삭제(코드 기본값 복귀)
```

- 화면: 운영 콘솔 «AI 엔진» 한 페이지 — 역할별 현재 모델·후보·카나리 상태·롤백. 고객에겐 보이지 않는다.
- 배포 없이 갱신되지만 **파일이 정본**이라는 사실은 유지 — 분기마다 오버레이를 파일에 굽는다(«정본 동기화» 버튼이 PR 생성).

---

## 11. SaaS · 테넌시 · 권한 · SSO

### 11.1 테넌시
- `tenants`(워크스페이스) — 고객 1명 = 테넌트 1. 모든 도메인 테이블 `tenant_id`(AM §4.6).
- `users` + `tenant_members(role: owner|member)` — 팀 시트는 플랜 한도.
- `operators`(플랫폼 운영진 · `tid=null`) — MIS SSO 또는 로컬 로그인.

### 11.2 SSO(싸이렌MIS → AutoCreate)
- MIS 쪽 신규 `netlify/functions/sso-autocreate.ts`(= `sso-marketing.ts` 복제·시크릿 `AUTOCREATE_SSO_SECRET`·aud `autocreate`·대상 `AUTOCREATE_URL`) + `admin-hub.html` 카드 1장.
- AC 쪽 `sso-enter.ts` 이식(iss `siren-hub`·aud `autocreate`·60초·role claim → `sso-role.ts` 상향만 자동).
- 진입 후 `/ops/`(운영 콘솔) — 테넌트 목록·플랜·코인 지급·러너 팜·AI 엔진·감사.
- 원격접속(impersonation) AM 배관 그대로 → 고객 화면을 운영자가 그대로 본다(결제 차단·배너).

### 11.3 셀프 가입
AM Phase 10 R1(`auth-register/verify/forgot/reset`) 그대로 + 온보딩 3스텝.

---

## 12. 가격 (구독 + 코인 · 코인은 AM과 동일)

### 12.1 코인(정본 = AM `coin-ledger.ts` · 변경 0)
- **1코인 = ₩500** · 포함분 월 리셋·이월 없음 · 충전분 1년 유효 · 자동 생성은 포함분만(옵트인 시 충전분).
- 구간표(AC에서 쓰는 항목): 블로그 글 1 · SNS 글 1 · 이미지 1 · 이미지 재생성 1 · 카드뉴스 3 · 영상 15초 6 · 30초 12 · 60초 28 · 새 페르소나 15.
- 충전 팩: ₩50,000=100 · ₩100,000=220(+10%) · ₩300,000=720(+20%).

### 12.2 구독 3안(Q2 · 연납 2개월 무료)

| | **Starter** | **Pro** ⭐ | **Agency** |
|---|---|---|---|
| 월 | ₩19,000 | ₩49,000 | ₩149,000 |
| 계정 수 | 3 | 15 | 50 |
| 포함 코인/월 | 40 | 150 | 500 |
| 채널 | 글 전부 + 쇼츠 | 전부 | 전부 |
| 디렉터 | 자동만 | 자동 + 손보기 + 자동모드 | + 팀 승인 흐름 |
| 다계정 페일오버 | ✕ | ✔ | ✔ |
| 러너 | 내 PC 1대 | 내 PC 2대 · 관리형 옵션(+₩30,000) | 관리형 포함(계정 50) |
| 수익 통합 | API 소스 | + 러너 스크랩 | + 리포트 내보내기 |
| 팀 시트 | 1 | 2 | 5 |
| 체험 | 7일 · 20코인 | | |

> 근거: 코인 원가(글 ~₩60·이미지 ~₩30·60초 영상 ~₩8,000) 대비 포함분이 마진 안에 있고, 사용자의 «계정 수»가 자연스러운 업셀 축이다.

---

## 13. UI / UX — 토스형

### 13.0 헌장 — «깔끔 · 세련 · 심플»을 규칙으로 (사장님 지시 2026-09-14)

세 단어는 취향이 아니라 **측정 가능한 규칙**으로 둔다. 화면 리뷰는 아래 표로 한다.

| 단어 | 뜻(우리 정의) | 규칙(어기면 반려) |
|---|---|---|
| **깔끔** | 정보 밀도를 통제한다 | 화면당 색 **3개**(잉크·브랜드 1·의미색 1) · 카드는 기본 **없음**(구분은 여백과 헤어라인 1px) · 그림자는 바텀시트에만 · 첫 화면에 보이는 숫자 **1개**, 항목 **7개 이하** |
| **세련** | 타이포·여백·모션이 정확하다 | 8px 그리드 엄수 · 타입 스케일 7단만 사용 · 큰 숫자는 `tabular-nums` + 자간 -2% · 모션 160~240ms **한 방향**(아래→위 시트, 우→좌 푸시) · 아이콘 1세트(선형 1.5px) · 사진·일러스트 장식 0 |
| **심플** | 선택지를 없앤다 | 화면당 Primary 버튼 **1개** · 옵션은 바텀시트 뒤로 · 설명은 **한 문장** · 온보딩 3스텝 이내 · 빈 상태 = 한 문장 + CTA 하나 · «고급 설정»은 설정 탭 깊이 2 안에 |

**금지 목록**: 이모지 아이콘 · 그라데이션/일러스트 히어로 · 다색 차트(단색 + 강조 1색만) · 팝업 모달(→ 바텀시트) · 툴팁으로 설명하기 · 배지 남발 · 3단 이상 메뉴 · 대시보드식 위젯 격자 · 시스템 용어(«테넌트» «러너 잡» «piece»).

**컴포넌트는 12개로 끝낸다**(`public/css/ac.css`·`public/js/ui.js`): `AppBar` · `BigNumber` · `ListRow`(56px·좌 텍스트 우 값/칩) · `StatusChip` · `BottomSheet` · `PrimaryCTA`(하단 고정·56px) · `StepBar` · `Skeleton` · `EmptyState` · `Toast` · `Toggle` · `SegmentedTabs`. 새 컴포넌트는 이 12개로 못 만들 때만 추가하고 사유를 적는다.

**접근성 하한**: 터치 44px · 본문 명도 대비 4.5:1 · 포커스 링 표시 · reduced-motion 시 모션 0.

### 13.0b 토스 패턴 사전 — 기능마다 «토스의 어느 화면처럼» (사장님 지시 2026-09-14 «기능은 전적으로 토스형»)

기능을 새로 발명하지 않는다. **모든 기능은 아래 토스 패턴 중 하나로 만든다.** 표에 없는 패턴이 필요하면 먼저 표에 추가하고 사유를 적는다. 시안 정본 = `docs/screens-v3.html`(v2는 이력).

| 우리 기능 | 토스 패턴 | 구체 형태 |
|---|---|---|
| 온보딩 | **한 화면 한 질문** | 상단 진행선 3칸 · 좌상단 큰 질문(«어떤 걸로 벌고 싶어요?») · 큰 선택 타일 · 하단 «다음». 뒤로 가기만 있고 건너뛰기 없음 |
| 홈 | **문장형 헤드라인 + 그룹 섹션** | «오늘 12,400원 벌었어요» · 첫 섹션 = 해야 할 일(아이콘 마크+문장) · 오늘 편성 · 자동 편성 토글 |
| 계정 연결 | **계좌 연결** | 채널 마크 그리드(연결 수 표기) → 선택 → 채널별 로그인(OAuth 창 / 러너 헤드풀 로그인 안내) → 풀스크린 완료 체크 |
| 내 계정 | **내 자산 목록** | 채널별 그룹 섹션 · 행 = 마크 + 핸들 + 한 줄 상태 + 상태 알약 · 행 탭 → 상세(건강도·오늘 발행·페르소나) |
| 소재 고르기 | **추천 카드 스와이프** | 소재 카드(검색량·상승률·경쟁) 좌우 스와이프: 오른쪽 = 디렉터에게 · 왼쪽 = 넘김 · 위 = 나중에 |
| 디렉터 확인 | **송금 확인** | 질문 한 줄(«3곳에 만들까요?») · 대상 행 3개 · 키-값 표(쓰는 코인·남는 코인·검수) · 하단 «손보기 / 만들기» |
| 손보기 | **바텀시트 편집** | 드래그 핸들 · 큰 제목 · 옵션은 칩/세그먼트/토글만 · 하단 «적용». 입력창 최소 |
| 만드는 중 | **처리 중 화면** | 스켈레톤 + 스텝 텍스트(«글 쓰는 중 → 사진 만드는 중 → 검사 중») + 예상 시간. 완료 시 체크 애니메이션 |
| 검수 | **알림 → 상세 → 하단 2버튼** | 홈 «봐주세요» 행 탭 → 채널 렌더 그대로 미리보기 → «수정하기 / 이대로 발행». 수정은 인라인 편집 시트 |
| 편성표 | **소비 캘린더** | 월 달력(날짜 아래 상태 점 ≤3) → 날짜 탭 → 그날 목록 그룹 · 우상단 설정 → 규칙 시트 |
| 편성 규칙 만들기 | **한 화면 한 질문(3스텝)** | ① 채널 행마다 «주 N회» 스테퍼 ② 계정 «자동 / 고르기» ③ «3일 전 만들고 조용하면 발행» 확인 → 코인 미리보기 → «켜기» |
| 수익 | **내 소비** | «9월에 284,100원 벌었어요» · «지난달보다 67,300원 더» · 마크 달린 단색 막대(1등만 블루) · 잘 번 글 목록 |
| 코인 충전 | **충전하기** | 금액 프리셋 타일(5만·10만·30만 + 보너스 표기) → 결제수단 행 → «충전하기» → 완료 체크 |
| 구독 변경 | **요금제 비교** | 3열 비교표 대신 **세로 카드 3장 스와이프**, 현재 플랜 표시, 하단 «이 플랜으로» |
| 러너 | **연결 기기** | 상태 행(온라인·마지막 응답) · 설치 안내는 한 화면 한 단계 · 오프라인이면 홈 «해야 할 일»에 뜸 |
| 알림 | **알림함 + 푸시 딥링크** | 우상단 종 · 항목 탭 → 해당 화면 바로. 푸시 문구도 문장형(«@blog_b 로그인이 풀렸어요») |
| 설정 | **그룹 리스트 + 토글** | 섹션: 자동 편성 변수 · 알림 · 플랜/코인 · 계정 · 앱 정보. 깊이 2 이하 |
| 오류·빈 상태 | **토스트 + 한 문장 빈 상태** | 하단 토스트(원인+할 일 한 문장, «다시 시도») · 빈 상태 = 문장 하나 + 버튼 하나 |
| 운영 콘솔(우리) | **예외** | 고객 화면 규칙을 따르되 밀도만 높인다(표 허용). 별도 디자인 언어 만들지 않음 |

**마이크로 인터랙션(전 화면 공통)**: 숫자 카운트업 600ms · 스프링 바텀시트(드래그로 닫기) · 눌림 스케일 0.97 + 눌림색 · 완료 체크 400ms 후 자동 닫힘 · 스켈레톤(스피너 금지) · 당겨서 새로고침 · 확정 동작에 짧은 햅틱 · reduced-motion이면 전부 즉시 전환.

**v3 토큰(13.4를 대체 · 사장님 2026-09-14 «파란 배경 촌스럽다» → 블루 제거)**: 바탕 `#F2F4F6` · 섹션 흰색 R20(테두리·그림자 0) · 잉크 `#191F28` · 보조 `#4E5968` · 흐림 `#8B95A1` · **액센트 = 잉크 블랙**(버튼·선택 테두리·오늘·1등 막대 · 다크에선 반전) · 수익 초록 `#1FA97A`(«번 돈»·토글·정상 상태에만) · **컬러는 채널 마크에만** · 행 56px · 채널 마크 38px R12 · CTA 54px R16 · 헤드라인 30px/800 · 다크: 바탕 `#17171C` 섹션 `#202027`. 채널 마크 색은 각 서비스 대표색 인용(실제 로고는 상표 지침 확인 후).

### 13.1 규율
1. **한 화면 한 목적**. 상단 제목 한 줄 + 큰 숫자 하나 + 하단 고정 CTA 하나.
2. **선택은 바텀시트**, 설정은 뒤로. 첫 화면에 옵션을 펼치지 않는다.
3. **진행은 스텝 바**(글쓰기 → 이미지 → 검수 → 예약). 기다림에는 스켈레톤 + 예상 시간.
4. **말은 사람말**: «발행함», «내 계정», «오늘 번 돈». 시스템 용어 금지.
5. **상태는 칩**: 정상(초록)·주의(주황)·정지(빨강)·오프라인(회색). 칩 색이 화면의 «의미색 1개»다.
6. 모바일 퍼스트(400px) → 데스크톱은 720px 중앙 컬럼 + 좌측 탭.
7. **시안 정본**: `docs/screens-v3.html`(토스 패턴 6화면·잉크 액센트) — 구현은 이 픽셀을 따른다. v1·v2는 이력.

### 13.2 정보 구조(하단 탭 5)
`홈` · `만들기` · `편성표`(§5B) · `수익` · `내 계정`

### 13.3 핵심 화면

```
┌ 홈 ──────────────────────────┐   ┌ 만들기 · 디렉터 ───────────┐
│ 오늘 번 돈                    │   │ «에어프라이어 청소법»       │
│ ₩ 12,400  (어제 확정 +예상)    │   │ 검색 32,000 ↑18% · 경쟁 낮음│
│ 이번달 ₩ 284,100  ▁▃▅▆▇       │   │─────────────────────────────│
│──────────────────────────────│   │ 네이버 블로그 @cook_a 경험담 │
│ 오늘 발행 4건 · 대기 2건       │   │ 티스토리 @tips_b 비교표     │
│ [해야 할 일 2]                 │   │ 쇼츠 @short_c 60초 그래픽   │
│  • @blog_b 다시 로그인 필요    │   │ 내일 09:00 / 12:00 / 19:00  │
│  • 검수 대기 1건               │   │ 총 30코인 (잔여 118)        │
│──────────────────────────────│   │─────────────────────────────│
│ 디렉터에게 맡기기   [  ON ]    │   │ [ 손보기 ]  [ 이대로 만들기 ]│
└──────────────────────────────┘   └─────────────────────────────┘
┌ 내 계정 ────────────────────┐   ┌ 수익 ─────────────────────┐
│ 네이버 블로그 (3)             │   │ 9월 ₩ 284,100             │
│  @cook_a   ● 정상  오늘 2/3   │   │ 애드센스 ▇▇▇▇▇ 121,000   │
│  @blog_b   ● 재로그인 필요     │   │ 쿠팡     ▇▇▇   88,400    │
│  @life_c   ● 정지(9/12) → 승계│   │ 애드포스트▇▇    41,700 ⟳어제│
│ 티스토리 (2) · 유튜브 (1) …    │   │ 글별 TOP5                 │
│ [ + 계정 연결 ]               │   │  1. 에어프라이어… ₩38,200  │
└──────────────────────────────┘   └───────────────────────────┘
```

### 13.3b 웹(데스크톱) — 앱과 같은 코드, 폭에 따라 펼쳐진다

앱과 웹은 **하나의 PWA**다. 별도 웹 버전을 만들지 않는다. 폭 구간 3개에서 «자리만» 바뀐다.

| 폭 | 내비게이션 | 콘텐츠 | 선택/옵션 | 주 버튼 |
|---|---|---|---|---|
| ≤ 640px 폰 | 하단 탭 5 | 한 컬럼 | 바텀시트 | 하단 고정 56px |
| 641~1099px 태블릿·좁은 창 | 좌측 레일(아이콘+라벨) | 720px 컬럼 | 바텀시트 | 하단 고정 |
| ≥ 1100px 데스크톱 | 좌측 레일 220px | 640px 컬럼 + **우측 300px 패널**(미리보기·손보기 상시 노출) | 우측 패널 | 컬럼 끝 우측 정렬 48px |

- 텍스트 폭은 넓어져도 **720px을 넘기지 않는다**(대시보드식으로 펼치지 않는다 — 헌장 «깔끔»).
- 홈처럼 짧은 목록 둘은 데스크톱에서 2열로 나란히 놓을 수 있다(행 규칙 동일).
- 컴포넌트 12개는 그대로. `BottomSheet`가 ≥1100px에서 `SidePanel`로 렌더되는 것뿐(같은 컴포넌트·같은 내용).
- 시안 정본: `docs/screens-v1.html`(폰) · `docs/screens-web-v1.html`(데스크톱).

### 13.4 디자인 토큰(`public/css/ac.css`)
- 폰트 Pretendard(AM 동일) · 스케일 13/15/17/20/24/32/40.
- 색: ground `#F7F8FA` · surface `#FFFFFF` · text `#191F28` · muted `#6B7684` · brand `#3060F0` · money `#12B886` · warn `#F59F00` · danger `#F03E3E`. 다크는 토큰만 교체.
- 반경 16(카드)·12(칩)·999(버튼) · CTA 높이 56 · 안전 여백 20.
- 모션 160ms ease-out · reduced-motion 존중.

---

## 14. 데이터 모델(테이블)

| 영역 | 테이블 |
|---|---|
| 테넌시·권한 | `tenants` `users` `tenant_members` `operators` `sessions` |
| 플랜·결제·코인 | `plans` `subscriptions` `invoices` `billing_keys` `coin_ledger`(AM) `coin_orders` |
| 채널·계정 | `channel_registry` `accounts` `account_creds` `account_groups` `personas` `emotion_profiles` |
| 소재·제작 | `topics` `topic_sources`(검색량 스냅샷) `briefs` `pieces` `piece_assets` `piece_gates`(검사 결과) |
| 발행 | `schedules` `posts` `runner_devices` `runner_jobs` `runner_heartbeats` |
| 수익 | `revenue_sources` `revenue_daily` `affiliate_links` |
| AI | `ai_model_overrides` `ai_model_probes` `ai_usage`(AM 미터) |
| 운영 | `notifications` `audit_log` `feature_flags` |

DDL 규칙: AM §4.5(추가형 DDL 자율·`scripts/neon-migrate.mjs`·`drizzle-kit push` 금지·schema.ts 동시 갱신).

---

## 15. API(요약 · 전부 `export const config = { path }`)

| 그룹 | 엔드포인트 |
|---|---|
| 인증 | `auth-login/logout/me/refresh` · `auth-register/verify/forgot/reset` · `sso/enter` |
| 소재 | `topics-list` · `topics-refresh`(AI 소재뽑기·검색량) · `topics-pick` |
| 디렉터 | `director-propose`(자동안) · `director-confirm`(수정본 포함) · `director-settings`(자동모드) |
| 제작 | `pieces-list/get` · `pieces-regenerate` · `pieces-approve/reject` · `assets-presign` |
| 발행 | `schedule-list/move` · `publish-now` · `posts-list` |
| 계정 | `accounts-list/add/remove` · `accounts-oauth-start/return`(구글·메타·틱톡) · `accounts-session-request`(러너 로그인 요청) · `accounts-health` |
| 러너 | `runner/register` · `runner/queue`(claim/report/release) · `runner/heartbeat` · `runner/session-upload` |
| 수익 | `revenue-summary` · `revenue-sources-connect` · `revenue-manual-add` |
| 결제 | `billing-*`(AM) · `coin-balance/purchase/history`(AM) |
| 운영(ops) | `ops-tenants` · `ops-coins-grant` · `ops-runners` · `ops-ai-models`(후보·적용·롤백) · `ops-impersonate` |
| 크론 | `cron-topics-refill` · `cron-publisher` · `cron-revenue-sync` · `cron-account-health` · `cron-ai-model-watch` · `cron-coin-monthly` |

---

## 16. 보안 · 법적

- 계정 자격: AES-256-GCM(`CREDS_ENC_KEY` 필수·폴백 없음) · 평문 표면 2곳 규칙 · 열람 감사.
- OAuth 토큰: 채널별 앱 1개(우리) · 리프레시 토큰 암호화 · 스코프 최소.
- 러너 토큰: 테넌트 스코프·회전 가능·헤더 전용.
- **자동화 약관 리스크 고지**: 러너 채널(네이버·티스토리·클립)은 플랫폼 정책상 계정 제재 가능 → 가입 시 고지·캐던스 기본값 보수적·«내 PC 러너» 기본.
- **광고·제휴 고지** 자동 삽입(공정위 표시광고법·쿠팡 파트너스 문구).
- 광고법 금칙어·과장 표현: AM `findBannedWord`·`checkSeoClaims` 게이트.
- 팩트체크: 쇼츠 대본 검색 그라운딩(AM) · 글은 «검증된 팩트만» 원칙 + 수치 주장 표시.
- 저작권: BGM 라이선스 게이트 · 이미지는 생성만(스톡 크롤링 0).
- 개인정보: 계정 이메일·연락처 최소 · 파기 요청 시 `purged_at`.

---

## 17. 로드맵

| Phase | 기간 | 산출 | 완료 정의(화면에서 쓸 수 있을 때) |
|---|---|---|---|
| **0 뼈대** | 1주 | 리포 스캐폴드 · AM 코어 이식(auth·tenant·coin·billing·ai·ai-models·audit) · 스키마 v1 · 디자인 시스템 · 온보딩 · MIS SSO | MIS 허브 카드 → AC 운영 콘솔 진입 · 셀프 가입 → 홈 |
| **1 글 MVP** | 2~3주 | 소재뽑기 → 디렉터(자동+손보기) → 글·이미지 → 검수 → 예약 · 네이버 블로그 러너 · 블로거/WP API · 계정 N개 등록 | 계정 3개에 하루 3편이 자동 예약·발행되고 URL이 발행함에 뜬다 |
| **2 수익·계정** | 2주 | 애드센스·쿠팡·유튜브 애널리틱스 API · 애드포스트 러너 스크랩 · 정지 감지·승계 · 캐던스 | 홈 «오늘 번 돈»이 실데이터 · 정지 계정 글이 다음 계정으로 옮겨진다 |
| **3 영상** | 3~4주 | 쇼츠 공장 이식(3포맷) · 유튜브 API(앱 심사 착수) · 릴스·쓰레드 · 네이버 클립 러너 검증 | 소재 1개 → 60초 쇼츠가 계정별 변주로 예약·업로드 |
| **4 상용** | 2주 | KICC 구독·코인 결제 · 플랜 게이트 · 관리형 러너 팜 · 운영 콘솔 · AI 자동 업데이트 | 결제 → 코인 → 생성 → 발행 → 수익까지 실돈 루프 |
| **5 확장** | 이후 | 티스토리 러너 · 틱톡 · X · 워드프레스 고급 · 화이트라벨 · 수익 학습 되먹임 | |

### 리스크

| 리스크 | 대응 |
|---|---|
| 러너 채널 셀렉터 변경·캡차 | AM 다중 폴백 셀렉터 + 눈검사 스냅샷(`RUNNER_SHOTS`) + `awaiting_manual` 정직 폴백 |
| 유튜브 앱 심사 지연(비공개 고정) | Phase 3 시작과 동시에 심사 신청 · 심사 전엔 «비공개 업로드 후 사용자가 공개 전환» 안내 |
| 네이버 클립 PC 업로드 불가 | Android 에뮬(관리형 러너)로 대체 · 실패 시 «앱에서 올리기» 딥링크 폴백 |
| 계정 대량 정지 | 캐던스 보수 기본값 · 계정 간 유사도 게이트 · 프로필 격리 · 고지 |
| 영상 원가 | 60초 28코인 확정치 · provider 레지스트리 비용 게이트 |

---

## 18. 리포 구조(예정)

```
AutoCreate/
  public/               # PWA · 토스형 화면(app/*.html · js · css/ac.css)
  netlify/functions/    # /api/* 핸들러 (AM 컨벤션)
  lib/                  # 도메인 코어 (AM 이식 + 신규 director/ accounts/ revenue/)
  lib/ai-models.ts      # 모델명 단일 출처
  db/schema.ts          # Drizzle 정본(append-only 섹션)
  drizzle/*.sql         # 추가형 DDL
  runner/               # 러너(코어·채널 어댑터·런처)
  scripts/              # neon-migrate · verify-ai-models · 러너 프리플라이트
  docs/DESIGN.md        # 이 문서
```
