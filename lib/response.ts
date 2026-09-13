// AM 원본: ../AutoMarketing/lib/response.ts (복사 2026-09-14 · 무수정)
/** 표준 응답 헬퍼 (MIS 검증 패턴: step·detail·stack) */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

// R6 B5 — prod에서는 detail/stack(내부 SQL·경로·예외 메시지)을 응답에 노출하지 않는다(정보누출 차단·외부판매 전 하드닝).
//   ⚠️ R6 C검증 fix: Netlify Functions 런타임은 NODE_ENV를 'production'으로 보장하지 않아(라이브서 detail/stack 누출 확인)
//     원래 NODE_ENV 단독 게이트가 prod에서 열려 있었다. 배포(AWS Lambda) 런타임에 항상 존재하는
//     LAMBDA_TASK_ROOT(=/var/task·실제 누출 스택에서 확인) + Netlify CONTEXT로 배포를 판정해 **기본 숨김**.
//   노출은 진짜 로컬(netlify dev·node — 배포 표식 전무)에서만 → 디버깅성 유지. 서버 로그에는 환경 무관 항상 남긴다.
const _DEPLOYED =
  !!process.env.LAMBDA_TASK_ROOT ||
  process.env.NODE_ENV === "production" ||
  ["production", "deploy-preview", "branch-deploy"].includes(process.env.CONTEXT || "");
const EXPOSE_DETAIL = !_DEPLOYED;

/** 성공/일반 JSON 응답 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** 단계별 에러 응답 — step 라벨(+개발 한정 detail·stack). prod 비노출 게이트(B5). */
export function jsonError(step: string, err: any, status = 500): Response {
  // 서버 측 관측성은 환경 무관 보존 — prod에서 응답에 안 실어도 함수 로그로 원인 추적 가능.
  console.error(`[jsonError:${step}]`, err);
  const body: Record<string, unknown> = { ok: false, error: "요청 처리에 실패했습니다.", step };
  /* ★LOOPFIX [L1-a](정본 §2-[L1-a]) — prod에서도 **에러 코드**(`err.code` · 예 UNSAFE_TRANSACTION·23505)는 싣는다.
     9/5 훅 전이 500이 step만 보여 진범을 함수 로그까지 가서 찾았다(정본 §1-L1-1). 코드는 짧은 식별자라 SQL·경로·예외 문장을
     담지 않는다 — detail·stack은 종전대로 숨긴다(R6 B5 하드닝 불변). */
  const code = err?.code;
  if (code !== undefined && code !== null && String(code).trim()) body.code = String(code).trim().slice(0, 80);
  if (EXPOSE_DETAIL) {
    body.detail = String(err?.message || err).slice(0, 500);
    body.stack = String(err?.stack || "").slice(0, 1000);
  }
  return json(body, status);
}

/** 검증 실패(400) */
export function badRequest(message: string, step = "validate"): Response {
  return json({ ok: false, error: message, step }, 400);
}
