# AM 서식을 **우리 구조로** 어떻게 옮기나 — 한 장 (B2 · 2026-09-16 · R9-2/3/6)

> 🔴 **읽기만 했다.** AM 리포(`../AutoMarketing`)에 쓰기·커밋·복사 0. 이 문서는 «무엇을 어떻게 옮길지»이고, **코드를 통째로 옮기지 않는다.**
> 잰 것: `public/runner/naver-blog-runner.mjs`(202KB) · `scripts/verify-runner-format.mjs`(174줄) · `scripts/runner-format-repro.mjs`

---

## 0. 결론 먼저 — **옮길 것은 코드가 아니라 «네 번 얻어맞은 지식»이다**

AM 러너는 **한 파일 202KB**에 잡 큐·상태기계·셀렉터·서식·발행이 전부 들어 있다. 우리는 그 구조가 **이미 다르다**:

| | AM | AC(우리) |
|---|---|---|
| 러너 | 한 파일(`naver-blog-runner.mjs` 202KB) | **계획층 분리** — `runner/lib/plan.mjs`(순수·IO 0) + `runner/channels/naver-blog.mjs`(연주) |
| 계획 | `planEditorOps(piece)` 가 HTML 을 파싱 | `planEditorOps(payload)` 가 **`blocks[]` 를 읽는다**(HTML 은 폴백) |
| op 어휘 | **7종** `title heading para quote image divider tagline` | **12종** `para heading quote divider list check image faq link tags note` (+`title` 은 별도 칸) |
| 배포 | `public/runner/` 와 `scripts/` **두 사본**(116줄 갈라진 실사고) | **zip 한 벌**(`runner/`) — 🔴 **미러 축이 우리에겐 필요 없다** |
| 서식 마크 | 본문에 **제어문자**(`\u0011`·`\u0013`·`\u0015`) 를 섞는다 | 🔴 **구조로 받는다**(`block.marks[]`) — 제어문자는 AC-77 ③ 그 병이다 |

⇒ **통째로 복사하면 우리 계획층이 죽는다.** 가져올 것은 아래 셋뿐이다.

---

## 1. 가져오는 것 — 셋 (이게 본체다)

### ① 번짐 세 겹 → `runner/lib/format-bleed.mjs` **새 파일**(순수 · IO 0)

AM 은 이 셋이 러너 본문 여기저기 흩어져 있다. 🔴 우리는 **한 파일**로 모은다 — 하니스가 그 파일 하나를 잘라 돌릴 수 있어야 한다(AM 재현 도구가 202KB 에서 중괄호 균형으로 함수를 «잘라» 오는 이유가 이것이고, 우리는 그 고생을 안 해도 된다).

| AM | 우리 | 왜 옮기나 |
|---|---|---|
| `markFormatDirty(why)` + 모듈 전역 `FORMAT_DIRTY` | 같음 — 단 **모듈 전역이 아니라 `createFormatState()` 가 돌려주는 객체** | AM 은 잡을 한 건씩 도니 전역이 안전했다. 우리도 순차지만(`core.mjs tick`) **전역은 테스트가 못 씻는다** — 하니스에서 케이스마다 새 상태가 필요하다 |
| `breakFormatBeforePara(page)` | 같음(`state` 를 받는다) | 🔴 **URL 전용이던 방어를 «한 곳의 규칙»으로 올린 것** — 이게 사장님이 보신 판을 문단 하나에 가둔다 |
| `measureFormatBleed(page)` | 같음 — **`page.evaluate` 에 넘길 순수 본문을 `export` 로 따로 뺀다** | 하니스가 **그 함수 원문 그대로** DOM 에 돌려야 한다(복제 0 · 두 벌이면 다음 수리 때 갈린다) |
| `FORMAT_BLEED_MAX_PCT` | `RUNNER_FORMAT_BLEED_MAX_PCT \|\| 30` — **상수 한 곳** | 숫자를 코드 여러 곳에 흩지 않는다(트리거 명시) |

🔴 **`freshTextBlockForUrl` 은 이미 우리 안에 있다** — `naver-blog.mjs moveCaretToEnd` 가 같은 일(`.se-canvas-bottom-button` 으로 끝에 새 글 칸)을 한다. **새로 만들지 않고 그것을 부른다**(AC-69 의 반대 방향 — 있는 것을 또 만드는 것도 같은 병이다).

### ② 서식 적용 경로 → `naver-blog.mjs` 안 (AM `writeParts`·`colorLastTyped` 의 AC 판)

🔴 **금지된 길을 그대로 물려받는다**: 이 에디터는 `getSelection()` 이 **항상 빈 문자열**이라 캐럿에 무엇이 켜졌는지 **읽을 수 없다.** ⇒ **캐럿을 눈감고 토글하지 않는다**(`Ctrl+U` 0건 · 끄기가 «켜기»가 된다).
대신 AM 이 실측으로 확정한 성질만 쓴다 — **«새로 만든 글 칸은 앞 서식을 물려받지 않는다»**.

- 칠하기는 **«치고 나서 되짚어 잡아 칠한다»**(`Shift+ArrowLeft × len` → 도구모음 → `ArrowRight` 로 해제). 캐럿 토글이 아니라 **선택 범위 적용**이라 상태를 읽을 필요가 없다. 🔴 우리 `sizeLastTyped` 가 **이미 이 모양**이다 — 같은 뼈대에 색·밑줄을 얹는다.
- 🔴 **칠하기 전에 «무엇을 잡았는지» 확인한다**(AM #736 — 문단이 한복판에서 갈렸다). 마지막 문단 꼬리가 기대 글자로 끝나지 않으면 **칠하지 않고 물러난다**(`caret_drift` 로 센다). 잘못 칠한 강조는 글을 망가뜨리고, 안 칠한 강조는 아쉬울 뿐이다.
- 팔레트는 **라벨이 아니라 실제 칠해진 색**으로 고른다(AM: `aria-label` 이 빈 문자열이라 헥사 셀렉터가 영원히 0건이었다). 가장 가까운 색 · 너무 멀면 «없는 것».
- **밑줄**은 AM 에 없다(AM 은 밑줄을 *새는 것*으로만 안다). 🔴 우리는 **같은 선택-적용 경로**로 낸다 — 도구모음 밑줄 버튼을 **선택 범위에** 누른다. 캐럿 토글이 아니므로 금지된 길이 아니고, 적용 뒤 `markFormatDirty` 로 다음 문단을 끊는다.

### ③ 변이 하니스 → `scripts/verify-runner-format.mjs` (우리 판)

AM 6종(`m1~m6`)에 **1:1 대응**시킨다. 🔴 **빨강이 안 나면 그 검사는 아무것도 못 잡는다**(AC-87).
🔴 **jsdom 이 우리 리포에 없다.** AM 하니스는 jsdom 으로 `measureFormatBleed` 를 실제로 돌린다(글자 검사로는 `(true || …)` 무력화를 못 본다 — AM 이 m6 에서 실제로 새어 나갔다). ⇒ **의존성을 늘리지 않고** 같은 힘을 낸다: 판정 본문이 쓰는 DOM 표면이 **여덟 개뿐**이라(`querySelectorAll`·`closest`·`textContent`·`getComputedStyle` 의 6속성) **작은 셈 DOM 을 우리가 쓴다**(`scripts/_lib/tiny-dom.mjs`). 🔴 **셈 DOM 자체도 대조군으로 잰다** — «이 DOM 이 빨강을 빨강이라 말하는가»를 먼저 확인하고서야 판정을 믿는다(AC-58: 검사의 삼킴은 판정 전체를 뒤집는다).

---

## 2. 안 가져오는 것 — 이유와 함께 (조용한 축소 금지 · CLAUDE §8)

| AM | 왜 안 가져오나 |
|---|---|
| **미러 축**(`public/runner` ↔ `scripts` 바이트 동일) | 🔴 **우리는 사본이 하나다**(zip 한 벌). 없는 병의 검사는 영영 초록이라 «작동한 적 없는 안전장치»가 된다(AC-68) |
| 제어문자 마크(`MARK_ON`·`LINE_ON`·`ROW_ON`) + `scanMarkParts` | 🔴 **AC-77 ③** — 소스·DB 에 보이지 않는 글자를 넣지 않는다. 같은 뜻을 `block.marks[]` **구조**로 받는다 |
| `stripAdNotice`(«(광고)» 제거) | AM 은 메일 문안이 섞여 들어왔다. 우리는 🔴 **고지를 넣어 주는 쪽**이다(CLAUDE §9 ④ `ensureDisclosureHtml`) — 걷어내면 규칙과 싸운다 |
| `humanClick`(봇 탐지 회피) | 이 라운드 범위 밖. 있는지 따로 잰다(없으면 다음 라운드 후보로 적는다) |
| 당근 러너(`daangn-runner.mjs` 43KB) | 채널을 늘리는 일 — 계약서 §3.2 가 R11 로 잡았다 |

---

## 3. 우리 블록 18종 → op 내리기 (R9-6 · = R8 잔여 «에디터 실제 요소» B7)

🔴 **AM op 7종이 아니라 «우리가 실제로 누를 수 있는 것»에 맞춘다.** 우리 op 어휘는 이미 12종이고 AM 보다 넓다 — 좁히는 게 아니라 **못 내리는 칸을 정직하게 세는 것**이 이 일이다.
표와 «못 냈어요»는 `runner/lib/plan.mjs` 가 `stats.demoted[]` 로 돌려준다(AM `marksDemoted` 자리). 자세한 표는 구현과 같이 이 문서 §3b 로 갱신한다.

---

## 4. 못 잰 것 (정직)

- **실물 에디터로 재지 않았다** — 실호출 0 지시(AC-50). 아래 값은 «AM 이 실측해 둔 것 + 우리 코드가 그렇게 시킨다»이지 «오늘 네이버에서 그렇게 보였다»가 아니다.
- **티스토리가 어떤 서식을 낼 수 있는지 아직 모른다** — 🔴 `null` 이고 «못 쟀다»로 적는다(AC-92 · 「모른다」를 「false」로 바꾸지 않는다).
