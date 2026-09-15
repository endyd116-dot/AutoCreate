# 사진 조달 — 무엇이 되고 무엇이 안 되나(공식 약관 실조사 · B3 2026-09-15)

> 발주: 메인(사장님 제안 «소재를 검색해서 스와이핑·크롤링해서 사진을 가져오거나, 스톡 사진을 쓰고, 1장(많아야 2장)만 메인만 AI 로 만드는 게 어때?»).
> 규율(R8-A §1): **모든 줄에 공식 문서 URL**. 없으면 그 줄에 **«추정»**. 🔴 이 문서는 코드를 고치지 않는다 — 판단 재료다.

## §0 한 장 결론

| 물음 | 답 | 근거 |
|---|---|---|
| 검색 결과를 긁어 오는 것 | 🔴 **안 된다**(저작권 + 플랫폼 정책 둘 다) | §3-1 |
| 스톡 사진을 쓰는 것 | 🟢 **된다 — 정식 API 통로로, 지킬 것 지키면** | §1 |
| 어디를 쓰나 | 🟢 **Pixabay · Pexels** · 🔴 **Unsplash 는 이번엔 쓰지 않는다** | §1.4 |
| 왜 Unsplash 를 빼나 | 공식 가이드라인이 ① **«non-automated … experiences» 용도**로 못 박고 ② **API 가 준 URL 을 그대로 hotlink 하라**고 요구한다 — 우리는 **자동 생성·자동 발행**이고, 네이버·티스토리 에디터는 사진을 **자기 저장소로 올린다**(hotlink 유지 불가) | §1.2 |
| 사람 얼굴·상표가 찍힌 스톡 사진 | 🔴 **광고성 글(제휴·협찬·무상 제공)에는 쓰지 않는다** | §1.3 |
| «스톡은 중복이라 네이버에서 불리하다» | 🟡 **추정** — 네이버 공식 문서에서 확인하지 못했다(도구가 네이버 도메인을 못 읽는다). 구글 쪽은 **이미지를 «모아 붙이기만» 하는 사이트를 명시적으로 스팸으로 본다** | §2 |
| 고객이 올린 사진 | 🔴 **가장 조용한 위험** — 약관에 «권리 보증 + 면책·구상 + 우리의 삭제권» 세 줄이 있어야 한다 | §3-2 |

**한 줄**: 사장님 제안 중 **«스톡 + 메인만 AI»는 그대로 살릴 수 있다.** 다만 **긁어 오기는 뺀다**, 스톡은 **Pixabay·Pexels 두 곳**으로 한정하고, **사람 얼굴·상표는 광고성 글에서 제외**한다.

---

## §1 무료 스톡 3곳 — 공식 약관 대조(확인일 2026-09-15)

### 1.1 라이선스 본문

| 항목 | **Unsplash** | **Pexels** | **Pixabay** |
|---|---|---|---|
| 약관 URL | [unsplash.com/license](https://unsplash.com/license) · [API Guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) | [pexels.com/license](https://www.pexels.com/license/) · [API 문서](https://www.pexels.com/api/documentation/) | [라이선스 요약](https://pixabay.com/service/license-summary/) · [약관](https://pixabay.com/service/terms/) · [API 문서](https://pixabay.com/api/docs/) |
| 상업적 사용 | 🟢 «for free, including for **commercial purposes**» | 🟢 «All photos and videos on Pexels are **free to use**» | 🟢 «Modify or adapt Content into new works» |
| 수정 | 🟢 «copy, **modify**, distribute» | 🟢 (원본 그대로 판매만 금지) | 🟢 |
| 출처 표기 **의무** | 🟡 라이선스상 불필요(«attribution isn't required») · **API 를 쓰면 의무**(§1.2) | 🟡 «Attribution is **not required**» · **API 를 쓰면 «prominent link to Pexels» 요구** | 🟡 불필요(«without having to attribute the author») · **API 를 쓰면 «Show your users where the images … are from»** |
| 그대로 재판매 | ❌ «cannot be sold without significant modification» | ❌ «Don't sell unaltered copies» | ❌ «cannot sell or distribute the Content … on a **Standalone** basis» |
| 유사 서비스 만들기 | ❌ «replicate a similar or competing service» | ❌ «may not copy or replicate core functionality» | — |
| 🔴 AI 학습·생성 조항 | **없음**(라이선스·가이드라인 어디에도) | **없음** | 🟡 있지만 **방향이 반대다** — «Pixabay … may use **your Content** … including through the use of machine learning»(우리가 **올린** 것에 대한 조항) · «You **may** upload Content you have created with generative AI» |

> 🔴 세 곳 모두 **«스톡 사진을 AI 생성 이미지와 같은 글에 섞어 쓰는 것»을 막는 조항이 없다.** 사장님 제안(스톡 + 메인 1장 AI)은 **라이선스상 문제가 없다.**

### 1.2 API 를 쓸 때 추가로 걸리는 것(여기서 갈린다)

| 항목 | **Unsplash** | **Pexels** | **Pixabay** |
|---|---|---|---|
| 요청 상한 | Demo **50/시간** → 승인 후 **1,000/시간** | **200/시간 · 20,000/월** | **100 요청 / 60초** |
| 🔴 운영(production) 승인 | **필요** — «If ready to move to production mode, follow the ‘Apply for Production’ instructions»(메인 기억이 맞았다) | 문서상 별도 승인 절차 없음 | 문서상 별도 승인 절차 없음 |
| 🔴 이미지 저장 방식 | **hotlink 강제** — «All API uses must use the **hotlinked image URLs** returned by the API» | 명시 없음 | 🔴 **반대로 강제** — «Permanent hotlinking of images … is **not allowed**. If you intend to use the images, please **download them to your server first**» · «Requests must be **cached for 24 hours**» |
| 표기 요구 | «must attribute Unsplash, the Unsplash photographer, and contain a **link back**» + `?utm_source=…&utm_medium=referral` | «show a **prominent link to Pexels**» · «Always **credit our photographers** when possible» | «**Show your users where the images and videos are from**, whenever search results are displayed» |
| 다운로드 추적 | 다운로드 시 `photo.links.download_location` 로 **GET 필수** | 없음 | 없음 |
| 🔴 용도 제한 | **«The API is to be used for _non-automated_, high-quality, and authentic experiences.»** | 문서상 자동화 금지 문장 **없음** | 약관 §8 «Data mining, extraction, **scraping** … is strictly prohibited» — 단 **API 는 공식 통로**라 이 금지는 «긁기»에 대한 것이다 |

> 🔴 **Unsplash 를 빼는 이유(두 줄)**
> ① 우리 제품은 **자동 생성·자동 발행**이다 — «non-automated experiences» 용도 제한과 정면으로 부딪힌다.
> ② hotlink 강제인데 **네이버·티스토리 에디터는 사진을 자기 저장소로 올린다** — 발행하는 순간 hotlink 가 끊기므로 기술 요구를 지킬 수 없다.
> 쓰고 싶다면 **Apply for Production 에 용도를 있는 그대로 적고 허락을 받은 뒤**에 연다. 🔴 «일단 쓰고 나중에»는 안 된다 — 걸리면 키가 죽고 고객 글이 멈춘다.

### 1.3 사람·상표(모델 릴리스)

| 출처 | 원문 | 우리 규칙 |
|---|---|---|
| Pexels | «**Identifiable people may not appear in a bad light** or in a way that is offensive.» · «Don't **imply endorsement** of your product by people or brands on the imagery.» | 🔴 **광고성 글(제휴·협찬·무상 제공)에는 사람 얼굴이 식별되는 스톡 사진을 쓰지 않는다** — 제품 옆에 사람 얼굴이 있으면 그 자체가 «보증 암시»로 읽힌다 |
| Pixabay | «If Content depicts any **trademarks, logos or brands** … you cannot use that Content **for commercial purposes** in relation to goods and services» · «You cannot use Content in any immoral or illegal way, especially Content which features a **recognisable person**» | 🔴 **상표·로고가 찍힌 사진은 상업적 글에 금지** |
| Unsplash | 라이선스에 모델 릴리스 문장 **없음** | (해당 없음 — 이번엔 안 쓴다) |

> ⚠️ 셋 다 **모델 릴리스를 보증하지 않는다.** 사진 안의 사람·상표에 대한 책임은 **쓰는 쪽**에 남는다.

### 1.4 그래서 우리가 지금 쓸 수 있는 것

| | 쓸 수 있나 | 지킬 것 |
|---|---|---|
| **Pixabay** | 🟢 **바로** | ① 이미지를 **우리 서버(R2)로 내려받아** 쓴다(hotlink 금지 · 이게 우리 발행 방식과 정확히 맞는다) ② 검색 결과를 보여 줄 땐 출처 표시 ③ 100req/60s · 응답 24시간 캐시 ④ 상표·사람 주의(§1.3) |
| **Pexels** | 🟢 **바로** | ① **Pexels 링크를 눈에 띄게** ② 작가 크레딧 ③ 200/시간·20,000/월 ④ 사람·보증 암시 주의(§1.3) |
| **Unsplash** | 🔴 **이번엔 안 쓴다** | production 승인 + «non-automated» 제한 + hotlink 강제(§1.2) |

---

## §2 «스톡은 중복이라 네이버에서 불리하다» — 확인한 것과 못 한 것

| 물음 | 답 | 근거 |
|---|---|---|
| 네이버가 **이미지 중복**으로 불이익을 준다고 **공식 문서**에 썼나 | 🟡 **확인 못 함(«추정»)** — `searchadvisor.naver.com`·`help.naver.com` 이 우리 도구에서 **fetch 차단**이라 원문을 못 봤다. 검색으로도 공식 문장을 찾지 못했다 | — |
| 참고할 사실 | R8-A 에서 확인된 것: **네이버는 «본문 몇 자·사진 몇 장» 같은 수치 기준을 공식으로 낸 적이 없다**(업계 통설이 공식처럼 돌아다닌다). 이미지 중복도 **같은 성격일 가능성이 높다** | `docs/active/2026-09-15-R8A-voice-text.md` §5.1 |
| 구글은? | 🔴 **명시적으로 있다** — 스팸 정책의 «대규모로 제작된 콘텐츠 남용» 예시에 «사용자에게 실질적인 부가 가치를 제공하지 않고 **다른 사이트의 동영상, 이미지 또는 기타 미디어와 같은 콘텐츠를 삽입하거나 컴파일하기만 하는 사이트** 작성»이 들어 있다 | [구글 검색 스팸 정책](https://developers.google.com/search/docs/essentials/spam-policies?hl=ko) |

> 🔴 **읽는 법**: 구글 조항이 겨냥하는 것은 «**남의 것을 모아 붙이기만** 한 페이지»다. **정식 라이선스 스톡 1~2장 + 우리가 쓴 본문**은 그 예시가 아니다.
> 다만 «사진이 전부 스톡이고 본문이 얇은 글»은 저 조항에 가까워진다 — R8-A §2 의 «본문이 실물이어야 한다»와 같은 자리를 가리킨다.
> 네이버 축은 **사장님 화면으로 원문을 받아** 이 줄을 «추정»에서 빼는 것이 남은 일이다(합동 세션 체크리스트 13번 · `docs/rules/POLICY-REVIEW.md` «추정» 표에 올려 뒀다).

---

## §3 조달 경로별 한 장

| 경로 | 저작권 | 플랫폼 정책 | 🔴 우리가 지킬 것 |
|---|---|---|---|
| **① AI 생성**(지금 하는 것) | 🟢 우리가 만든 것 | 🟢 유튜브엔 «합성 콘텐츠» 플래그를 우리가 먼저 켠다(`containsSyntheticMedia:true`) | 사람 얼굴·실존 인물 생성 금지(지금 프롬프트 규칙) · 영상은 고지 3중 |
| **② 고객이 올린 사진** | 🔴 **우리가 알 수 없다** — 고객이 남의 사진을 올릴 수 있다 | 🔴 침해가 나면 **우리 도구로 발행**된다 | **약관 세 줄**(§3-2) + 업로드 화면 한 줄 안내 |
| **③ 스톡 API**(Pixabay·Pexels) | 🟢 라이선스 명시 | 🟢 | §1.4 의 «지킬 것» + 사람·상표 제외(§1.3) + **출처를 우리 DB 에 기록**(누가 물어도 답할 수 있게) |
| **④ 검색 결과 긁기** | 🔴 **금지** | 🔴 **금지** | §3-1 |

### 3-1 🔴 «검색 결과 긁기»가 왜 금지인가 — 다음 사람이 다시 제안하지 않게 문장으로 박아 둔다

1. **저작권**: 검색 결과의 사진은 **누군가의 저작물**이다. 검색 엔진에 떴다는 것이 이용 허락은 아니다. CC 라이선스라도 **조건(출처 표기·비상업·변경 금지)**이 붙고, 그 조건을 자동으로 지킬 방법이 없다.
2. **플랫폼**: 구글 스팸 정책이 «다른 사이트의 이미지를 삽입·컴파일하기만 하는 사이트»를 **명시적으로** 남용으로 든다([링크](https://developers.google.com/search/docs/essentials/spam-policies?hl=ko)). 애드센스 게시자 정책은 «부가 가치 없이 복사한 콘텐츠»에 **광고를 못 붙이게** 하고, 위반 시 «계정을 정지하거나 해지할 수 있습니다»([링크](https://support.google.com/adsense/answer/10502938?hl=ko)).
3. **우리 설계**: DESIGN §16 이 «이미지는 생성만 · 스톡 크롤링 0»으로 이미 못 박아 뒀다.
4. **누가 다치나**: 걸리는 것은 우리 서버가 아니라 **고객 계정**이다. 블로그가 죽고 애드센스가 끊긴다. 되돌릴 수 없다.

⇒ **그래서 «자동으로 긁어 온다»는 선택지는 없다.** 스톡은 **정식 API 통로**로만.

### 3-2 🔴 «고객이 올린 사진» — 약관에 있어야 할 세 줄

> 🔴 **문안은 법률 검토 대상**이다(아래는 «무엇이 들어가야 하나»이지 확정 문안이 아니다 · 사장님 바깥 절차).
> **확인했다**(2026-09-15 ·  전문): 약관은 제1~10조이고, **제6조(금지 행위)**에 «저작권 침해 콘텐츠의 생성·발행» **금지**는 있다.
> 🔴 그러나 **«보증합니다»·«구상»·«면책»·«지체 없이» 는 한 번도 안 나온다**(grep 0) — 즉 **금지만 있고 ①권리 보증 ②면책·구상 ③삭제·정지권 세 줄이 전부 없다.**
> 금지 조항은 «하지 마라»일 뿐, 이미 올라간 남의 사진을 **우리가 내릴 권한**도, 분쟁이 났을 때 **책임의 자리**도 만들어 주지 않는다.

| # | 들어가야 할 것 | 왜 |
|---|---|---|
| 1 | **권리 보증** — «회원은 업로드한 사진·영상에 대해 본인이 권리를 갖고 있거나 적법한 이용 허락을 받았음을 보증합니다» | 우리가 «몰랐다»가 아니라 «고객이 보증했다»가 된다 |
| 2 | **면책·구상** — «제3자의 권리 침해로 분쟁이 생기면 회원이 책임지며, 회사가 손해를 입은 경우 회원에게 구상할 수 있습니다» | 침해 통지는 **우리에게 먼저** 온다(발행 주체가 우리 도구라서) |
| 3 | **삭제·정지권** — «회사는 침해 신고를 받거나 침해가 명백한 경우 해당 콘텐츠를 지체 없이 내리고 발행을 멈출 수 있습니다» | 내릴 권한이 약관에 없으면 우리가 못 내린다 |
| + | 화면 한 줄 — 업로드 자리에 «남의 사진은 올리지 마세요. 내가 찍었거나 쓸 권리가 있는 사진만요.» | 약관은 아무도 안 읽는다 · **그 자리에서** 말해야 지킨다 |

---

## §4 그래서 코드에 무엇이 생겨야 하나(제안 · 이번 라운드 범위 밖)

| # | 무엇 | 크기 | 왜 |
|---|---|---|---|
| 1 | `lib/stock/` — Pixabay·Pexels 검색 → **R2 로 내려받기** → `piece_assets` 에 출처(provider·id·작가·라이선스·원본 URL) 기록 | M | 출처를 안 남기면 나중에 «이 사진 어디서 났냐»에 답할 수 없다 |
| 2 | 사진 정책 게이트 — 광고성 글이면 **사람 얼굴·상표 식별 스톡 금지**(제공사 태그로 1차 거르고 사람이 검수) | S | §1.3 |
| 3 | 글 하단 «사진 출처» 블록(스톡을 쓴 글만) | S | Pexels «prominent link» · Pixabay «where the images are from» |
| 4 | 업로드 화면 한 줄 + 약관 3줄(§3-2) | S | §3-2 |
| 5 | 이미지 예산 규칙 — «스톡 N장 + 메인 1~2장만 AI»(사장님 제안)를 채널 계약 값으로 | S | 지금은 전부 AI 생성이라 원가가 사진 수에 비례한다 |

> 🔴 **5번이 사장님 제안의 핵심**이다 — AI 이미지 장수만큼 원가가 바로 줄어든다. 값이 들어갈 자리는 채널 계약(`lib/writing-contracts.ts images`)에 이미 있다.
