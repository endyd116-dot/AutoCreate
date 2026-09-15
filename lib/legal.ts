/**
 * lib/legal.ts — 법·범위 문구 정본(계약 P1R7 §3.3 «댓글·DM 은 하지 않아요» · DESIGN §16).
 *   🔴 문구가 사는 곳은 여기 하나다. 약관 페이지·FAQ·계정 연결 시트가 **같은 문장**을 읽는다(두 벌이 되면 한쪽만 고쳐져 거짓말이 된다).
 *   서버가 문장을 내려주는 이유: 약관·FAQ 는 정적 HTML(A 영역)이라 문구가 화면에 박히면 바뀔 때 배포가 필요하다 —
 *   `GET /api/company.scopeNotice` · `GET /api/faqs` 의 **고정 1행**으로 내려보내면 한 곳만 고치면 된다.
 *   🔎 출처: AC 신규(계약 P1R7-B §3 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
/** 자동화 범위 — 우리가 하는 것/안 하는 것(정직 표기 · 계정 정지 위험을 줄이는 약속이기도 하다). */
export const AUTOMATION_SCOPE_NOTICE = "AutoCreate 는 글·영상을 만들고 예약한 시간에 올리는 것까지만 해요. 댓글·DM·이웃 추가 같은 활동은 하지 않아요.";
/** 자격(아이디·비밀번호) 보관 고지 — 계정 연결 시트 한 줄(§3.3 · consents kind `creds_storage` 와 짝). */
export const CREDS_STORAGE_NOTICE = "아이디·비밀번호는 암호화해서 보관해요. 언제든 지울 수 있어요.";
/** FAQ 고정 1행(DB faqs 표에 넣지 않는다 — 문구 정본이 코드에 있고, 운영자가 실수로 지워도 사라지지 않는다). */
export const SCOPE_FAQ = { id: 0, q: "댓글이나 DM 도 대신 해 주나요?", a: AUTOMATION_SCOPE_NOTICE, order: -1, category: "서비스 범위", pinned: true } as const;
