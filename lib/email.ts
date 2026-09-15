/**
 * lib/email.ts — Resend 발송(키 없으면 콘솔 로그 · graceful). AM lib/email.ts 축약 이식(2026-09-14).
 *   🔎 출처: AC 신규(계약 phase0 · 생성 커밋 2026-09-14) — 본문의 «AM lib/email.ts 축약 이식»이 되짚을 경로다: ../AutoMarketing/lib/email.ts
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "AutoCreate <onboarding@resend.dev>";
  if (!key) { console.warn(`[email] RESEND_API_KEY 없음 — 미발송 to=${to} subject=${subject}`); return false; }
  try {
    const { Resend } = await import("resend");
    const r = await new Resend(key).emails.send({ from, to, subject, html });
    const err = (r as { error?: unknown })?.error;
    if (err) { console.error("[email] resend error", err); return false; }
    return true;
  } catch (err) { console.error("[email] send failed", err); return false; }
}
export function siteUrl(): string { return (process.env.SITE_URL || "http://localhost:8888").replace(/\/+$/, ""); }

/** 토스형 짧은 메일 — 제목 한 줄·본문 한 문장·버튼 하나. */
export function simpleMail(title: string, line: string, cta: { label: string; url: string }): string {
  return `<!doctype html><body style="margin:0;background:#F2F4F6;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:32px 16px">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:20px;padding:28px 24px">
    <div style="font-size:20px;font-weight:800;color:#191F28;letter-spacing:-.02em">${title}</div>
    <p style="font-size:15px;color:#4E5968;line-height:1.6;margin:12px 0 22px">${line}</p>
    <a href="${cta.url}" style="display:block;text-align:center;background:#191F28;color:#fff;text-decoration:none;font-weight:700;font-size:15px;border-radius:14px;padding:16px">${cta.label}</a>
    <p style="font-size:12px;color:#8B95A1;margin:18px 0 0">버튼이 안 눌리면 이 주소를 복사하세요: ${cta.url}</p>
  </div></body>`;
}
