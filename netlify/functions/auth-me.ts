/** GET /api/auth-me — 사용자·테넌트·플랜·체험 남은 일·코인 잔액. 401 이 곧 «로그인 안 됨» 판정(쿠키 직접 검사 금지 · CLAUDE §4.3). */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { userContext } from "../../lib/auth-service";
export const config = { path: "/api/auth-me" };
export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  try {
    const ctx = await userContext(auth.user.uid, auth.tid);
    if (!ctx) return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "user" }, 401);
    return json({ ok: true, ...ctx, impersonation: auth.user.imp || null });
  } catch (err) { return jsonError("me", err); }
};
