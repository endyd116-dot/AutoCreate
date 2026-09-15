# 분기 1회 «정책 재확인» 체크리스트 (DESIGN §16B.4 · 운영)

> 크론 스텝 `policy.review`(1·4·7·10월 1일 KST 09시)가 **감사 한 줄**(`policy_review_due`)로 이 문서를 가리킨다.
> 🔴 **기계가 판정하지 않는다.** 남의 정책 페이지를 긁어 «바뀌었나»를 재면 매분기 거짓 경보가 난다 — 사람이 열어 보고 고친다.
> 🔴 여기 적힌 출처는 **바뀌면 우리 코드가 틀려지는 것만**이다(장식용 링크 금지). 링크를 더할 땐 «틀어지면 무엇이 깨지나»를 같이 적는다.

## 어떻게 하나 (15분)

1. 아래 표를 위에서 아래로 연다. **바뀐 날짜·문장**이 있는지만 본다(전문을 다시 읽지 않는다).
2. 바뀐 것이 있으면 → **«무엇이 깨지나» 칸의 파일을 그 자리에서 고친다.** 고칠 게 크면 라운드 계약에 항목으로 올린다.
3. 바뀐 것이 없으면 → 아무 것도 하지 않는다(다음 분기에 스텝이 다시 부른다).
4. 확인한 사실을 남기려면 운영센터 감사에서 `policy_review_due` 행에 메모를 붙이거나, 커밋 메시지에 «policy review {분기} 확인» 한 줄.

## 표 — 정본은 `lib/cron/policy-review.ts POLICY_SOURCES` (여기 표는 사람이 읽는 사본)

| # | 출처 | 틀어지면 무엇이 깨지나 |
|---|---|---|
| 1 | [공정위 추천·보증 심사지침](https://www.law.go.kr/LSW//admRulInfoP.do?admRulSeq=2100000190311) | 고지 문구·위치(`lib/disclosure.ts`) — **2024-12-01 개정**으로 문자 매체는 «제목 또는 첫 부분» |
| 2 | [공정위 경제적 이해관계 표시 안내서](https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1575&ccfNo=2&cciNo=3&cnpClsNo=1) | 부적절 표현 목록(«체험단»·«AD»·«Thanks to») · 영상 표시 방법(시작·끝·반복) |
| 3 | [애드센스 광고 게재위치 정책](https://support.google.com/adsense/answer/1346295?hl=ko) | «광고를 가리키는 표현» 게이트(`lib/banned-words.ts findAdPointing`) · 광고 자리 배치 |
| 4 | [Google 게시자 정책](https://support.google.com/adsense/answer/10502938?hl=ko) | 복제 콘텐츠·건강 주장 금지 — 글 게이트(`banned_words`)의 근거 |
| 5 | [유튜브 유료 프로모션 공개](https://support.google.com/youtube/answer/154235?hl=ko) | 영상 고지 3중(`lib/video/gen.ts`) · `paidProductPlacementDetails` 시도(`lib/publish/youtube.ts`) |
| 6 | [유튜브 해시태그 규칙](https://support.google.com/youtube/answer/6390658?hl=ko) | 설명란 해시태그 수 · `snippet.tags` 500자(`lib/publish/youtube.ts`) |
| 7 | [인스타 콘텐츠 게시 API](https://developers.facebook.com/docs/instagram-platform/content-publishing) | 유료 파트너십 라벨(`lib/publish/instagram.ts is_paid_partnership`) |
| 8 | [쓰레드 게시물 API](https://developers.facebook.com/documentation/threads/posts) | 토픽 태그 1개 규칙(`lib/writing-contracts.ts`) · **라벨 파라미터가 생기면** 고지 축이 바뀐다 |
| 9 | [식품 등의 표시·광고에 관한 법률 §8](https://www.foodsafetykorea.go.kr/portal/board/board.do?menu_grp=MENU_NEW01&menu_no=4838&ctgType=CTG_TYPE01&ctgryno=2255) | 건강·식품 효능 표현 사전(`lib/banned-words.ts BANNED_HEALTH_CLAIM`) |
| 10 | [의료법 §56 의료광고 금지](https://www.law.go.kr/LSW//lsLawLinkInfo.do?lsJoLnkSeq=900350305&lsId=001788&chrClsCd=010202&print=print) | 건강·의료 소재의 **경험담 구성 금지**(`lib/banned-categories.ts HEALTH_FORBIDDEN_FORMATS`) |

## 🔴 아직 «추정»으로 남은 출처 (분기 점검 때 같이 뚫는다)

| 무엇 | 왜 못 봤나 | 어떻게 뚫나 |
|---|---|---|
| 네이버 블로그 태그 상한·검색 제외(어뷰징) 기준 | `help.naver.com`·`searchadvisor.naver.com` 이 우리 도구에서 **fetch 차단** | 사장님/운영 브라우저로 열어 캡처(합동 세션 체크리스트 13번) |
| 네이버 애드포스트 부정클릭·유도 금지 조항 | 같은 이유 | 같음 |
| 쿠팡 파트너스 고지 문구 1차 출처 | 로그인 뒤 페이지 | 파트너스 계정으로 «이용 가이드» 확인 |
| 유튜브 `paidProductPlacementDetails` 쓰기 가능 여부 | 공식 문서에 `part` 값으로는 있는데 writable 목록엔 없다 | OAuth 키가 오면 **비공개 업로드 1건**으로 실측(코드는 이미 시도 후 실패하면 빼고 재시도한다) |
| 유튜브 **쇼핑 태그** | 공식 문서상 **Data API v3 에 상품 태그 필드가 없다**(태그는 스튜디오·쇼핑 제휴 프로그램에서 단다 · Merchant Reports API 는 «읽기»만) | 🔴 **우리가 API 로 달 길이 없다** — 고객이 스튜디오에서 달도록 안내하는 쪽으로 간다(§5.1 판단) |

## 기록

| 분기 | 확인일 | 확인한 사람 | 바뀐 것 |
|---|---|---|---|
| 2026-Q3 | 2026-09-15 | B3(코드 도입) | 최초 작성 — 위 10곳을 이번 라운드 근거로 실제 확인 |
