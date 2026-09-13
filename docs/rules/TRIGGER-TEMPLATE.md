# TRIGGER-TEMPLATE.md — A·B·C 트리거 양식 (AutoCreate)

> AM 트리거(예: `2026-10-30-HEROBRAND-B-trigger.md`) 형식 이식. 메인이 라운드마다 `docs/active/<날짜>-<라운드>-<A|B|C>-trigger.md`로 발부한다.
> 원칙: **문제 진단은 메인이 끝내고 준다.** 트리거는 «무엇을 왜 어떻게»가 다 적힌 작업 명세다. 세션이 다시 재지 않게 실측 수치·파일·줄을 박는다.

---

## 파일 이름
`docs/active/YYYY-MM-DD-<ROUND>-<A|B|C>-trigger.md` (ROUND = 대문자 코드명, 예 `SLOTS1`, `ACCOUNTS2`)

## 양식

```markdown
# <ROUND>-<A|B|C> 트리거 — <한 줄 목표> (<A|B|C>)

> 발부 YYYY-MM-DD · 베이스 = 지금 main(`<해시>`) · 브랜치 `feature/<round>-<front|back>` (C: `verify/<round>`)
> 🔴 <이 라운드가 왜 생겼나 한 줄 — 사장님 지시 원문 인용>

```
<ROUND>-<X>다. 베이스 = 지금 main(<해시>). 브랜치 feature/<round>-<front|back>.
읽을 것: docs/rules/PARALLEL_GUIDE.md · CLAUDE.md §3~§6 · docs/rules/PITFALLS.md §0·#<관련 번호> ·
        docs/DESIGN.md §<관련 절> · <관련 lib 파일(«여기 있다» 설명 포함)>
[자율주행 — 완전 자율] (PARALLEL_GUIDE §4 블록 그대로)
[진행률] 착수·완료마다 "📊 진행률 X%/100 — 방금: … / 다음: …" 최소 N회. %는 아래 섹션 제목에서 읽는다.

■ 무엇이 잘못됐나 / 무엇이 없나 — 메인 실측(다시 재지 마라)
  <파일:줄 · 라이브 수치 · 사장님 지적 원문>
  🔴 원인은 <…>다. ⚠️ <잘못된 처방 경고 — «게이트로 막지 마라» 류>

■ 계약 (A·B 공통 · 정본과 바이트 일치)
  GET /api/<x> 응답: { ok:true, <키 이름 글자 그대로>: <모양> }   // 없으면 키를 싣지 않는다
  POST /api/<x> body: { <키>: <모양> }
  라이브 충돌 확인: grep -rn "<키>" lib public netlify → <결과 요약>

■ <X>1 (0→N%) <제목>
  [만들 것] ⓐ … ⓑ … ⓒ …
  [어디에] <파일 경로 — 새 파일이면 «신규», 기존이면 «여기 이 함수 옆»>
  [정본] <이미 있는 기계 — 새로 짓지 마라>
  ⚠️ <함정 · PITFALLS #번호>

■ <X>2 (N→M%) …

■ 검증 (M→95%)
  - B: `npx tsc --noEmit` · DDL 멱등 · `export const config` · jsonb `sql.json` · tenant 스코프
  - A: 폰 400px + 데스크톱 1280px · 콘솔 0 · 헌장 체크(색 3·숫자 1·Primary 1·그룹 섹션) · 12 컴포넌트만
  - C: 시나리오 <번호> 라이브 · 회귀 · 증거(URL·row id·스샷) 첨부

■ 보고 (95→100%)
  [브랜치 · 커밋해시 · 변경요약 · 검증 증거 · 밟은 함정(있으면 PITFALLS §0 추가 커밋)]
  ❌ "push 해달라" · "라이브 확인" 증거 없이 쓰기
```
```

## 메인 체크리스트 (발부 전)
- [ ] 진단이 끝났는가(세션이 다시 재야 하는 항목 0)
- [ ] 계약의 키 이름이 글자 그대로 있고 `grep`으로 라이브 충돌을 확인했는가
- [ ] 섹션 제목마다 % 구간이 있는가
- [ ] A·B를 **동시에** 발부하는가 (UI 불필요면 사유 명시)
- [ ] «정본이 이미 있는 기계»를 트리거에 적었는가(새 두뇌 신설 방지)
- [ ] 완료 정의가 «화면에서 쓸 수 있다»인가(CLAUDE §4.8)
- [ ] PITFALLS 관련 번호를 첫 줄에 적었는가

## 라운드 마감 (메인)
1. B → DDL → A → C 순 머지 · `npx tsc --noEmit`.
2. `PROJECT_STATE.md` 갱신(라이브 상태·다음 할 일).
3. 트리거는 `docs/active/` → `docs/history/`로 이동, 보고서 1장 남김.
4. 배치 push 판단: «검증된 기능 묶음인가?» 아니면 commit만.
