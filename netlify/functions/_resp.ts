/** 공용: Set-Cookie 여러 개를 실은 JSON 응답. (Headers 는 append 로 다중 Set-Cookie 지원) */
export function jsonWithCookies(body: unknown, cookies: string[], status = 200): Response {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers: h });
}
export function redirectWithCookies(location: string, cookies: string[] = []): Response {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}
