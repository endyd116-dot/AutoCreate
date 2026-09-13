/**
 * GET /api/r2-image?key=pieces/… — R2 객체 공개 서빙(R2_PUBLIC_BASE 가 없을 때의 공개 URL · tbfa 패턴).
 *   키는 `pieces/` 접두만 허용(생성 이미지 전용) · 경로 탈출 금지 · 1년 캐시(immutable 키).
 */
import { r2Get } from "../../lib/r2";
export const config = { path: "/api/r2-image" };

export default async (req: Request): Promise<Response> => {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!/^pieces\/[a-z0-9_\-/]+\.(png|jpg|jpeg|webp)$/i.test(key) || key.includes("..")) return new Response("bad key", { status: 400 });
  try {
    const obj = await r2Get(key);
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(obj.bytes, { status: 200, headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    console.error("[r2-image]", e);
    return new Response("error", { status: 500 });
  }
};
