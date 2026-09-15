import { json, jsonError } from "../../lib/response";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { isNetlifyDev } from "../../lib/site-url";
import { videoStub } from "../../lib/video/types";
import { aiStubActive, aiStubImagesActive } from "../../lib/ai-stub";   // [R8 §2.1] 글 실호출 대체 스위치가 **이 런타임에** 켜졌나
export const config = { path: "/api/health" };
/** 이 번들이 메모리에 올라온 시각 — 로컬엔 COMMIT_REF 가 없어서, «내가 고친 뒤에 올라온 번들인가»를 하니스가 이걸로 잰다(AC-54). */
const LOADED_AT = new Date().toISOString();
/**
 * GET /api/health → { ok, db, ts, deploy, commit, dev, loadedAt }
 *   [AC-54 · B-1 2026-09-15] `deploy`(이 배포의 URL) · `commit`(COMMIT_REF · 로컬은 없을 수 있다) · `dev`(netlify dev 안인가) ·
 *   `loadedAt`(이 번들이 올라온 시각) — 하니스가 돌리기 **전에** «지금 답하는 서버가 어느 배포·어느 번들이냐»를 묻는 자리.
 *   옛 번들·옛 서버는 여기서 갈린다(«바꿨다» ≠ «반영됐다»). 로컬 하니스는 `dev:true` + (commit 이 있으면 자기 커밋과 같은지 · 없으면
 *   `loadedAt` 이 마지막 소스 수정보다 뒤인지) 둘 다 본다.
 */
export default async (): Promise<Response> => {
  try {
    const r = (await db.execute(sql`SELECT 1 AS ok`)) as unknown as { ok: number }[];
    const deploy = String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/+$/, "") || null;
    const commit = String(process.env.COMMIT_REF || "").trim() || null;
    // `stub` = 이 함수 런타임에 VIDEO_PROVIDER_STUB 이 **실제로** 들어왔나 — 셸에서 켰다고 믿지 말고 서버에게 묻는다(AC-54 «바꿨다 ≠ 반영됐다»).
    //  `aiStub` = 같은 물음의 글 쪽(AI_STUB) — 🔴 배포 런타임에서는 켜 둬도 **항상 false** 여야 한다(가짜 본문 발행 방지).
    return json({ ok: true, db: r[0]?.ok === 1, ts: new Date().toISOString(), deploy, commit, dev: isNetlifyDev(), loadedAt: LOADED_AT, stub: videoStub(), aiStub: aiStubActive(), aiStubImage: aiStubImagesActive() });
  } catch (err) { return jsonError("db", err); }
};
