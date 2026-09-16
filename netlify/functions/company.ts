/**
 * GET /api/company → { ok, company:{ name, ceo, bizNo, mailOrderNo, address, email, phone } | null, scopeNotice, credsNotice }   (계약 P1R6 §1.3 · P1R7 §3.3 · 공개 읽기)
 *   약관·개인정보 처리방침 하단 «사업자 정보» 가 읽는 한 출처(ops_settings.company · 운영센터에서 저장). 없으면 null → 화면 «준비 중».
 *   로그인 불필요(약관은 가입 전에도 본다) · 60초 캐시(lib/ops/settings.ts) · 값은 공개 정보뿐(운영자 id 는 싣지 않는다).
 *   [P1R7 §3.3] `scopeNotice` = «댓글·DM 은 하지 않아요»(자동화 범위 정직 표기) · `credsNotice` = 자격 보관 고지 — 정본은 `lib/legal.ts` 한 곳(약관 하단·FAQ·연결 시트가 같은 문장을 읽는다).
 */
import { json, jsonError } from "../../lib/response";
import { readCompany, supplierOf } from "../../lib/ops/company";
import { AUTOMATION_SCOPE_NOTICE, CREDS_STORAGE_NOTICE } from "../../lib/legal";

export const config = { path: "/api/company" };

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
  try {
    const c = await readCompany();
    const res = json({ ok: true, company: supplierOf(c), scopeNotice: AUTOMATION_SCOPE_NOTICE, credsNotice: CREDS_STORAGE_NOTICE });
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  } catch (err) { return jsonError("company", err); }
};
