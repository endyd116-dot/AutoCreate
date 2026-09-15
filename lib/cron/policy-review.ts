/**
 * lib/cron/policy-review.ts — 스텝 `policy.review`(DESIGN §16B.4 «분기 1회 정책 재확인» · 계약 P1R8 §5.1).
 *   🔎 출처: AC 신규(계약 P1R8 §5.1 · 생성 2026-09-15) — AM 원본 없음.
 *
 *   ══ 무엇을 하나 ══
 *     분기가 바뀌면(1·4·7·10월 1일 KST 09시) **운영에게 «정책을 다시 읽어라»를 남긴다.** 검사가 아니라 **알림**이다 —
 *     우리가 지키는 규칙의 출처(공정위 지침 · 애드센스 정책 · 각 채널 API 문서)는 **우리 코드가 아니라 남의 문서**라
 *     조용히 바뀐다. 바뀐 걸 모르고 있으면 어느 날 계정이 정지되거나 과태료가 온다.
 *
 *   🔴 **자동으로 판정하지 않는다**: 남의 정책 페이지를 긁어 «바뀌었나»를 기계가 재면 오검출로 매분기 거짓 경보가 난다.
 *      대신 **사람이 확인할 목록**을 감사에 남기고, 사람이 확인했다고 적으면 그 분기는 닫힌다(`ops_settings.policy_review`).
 *   🔴 분기당 **한 번만** — 우산이 테넌트 수만큼 부르므로 `ops_settings` 한 행으로 원자 선점한다(coin.reconcile 관례 그대로).
 *
 *   ══ 왜 «global» 이 아니라 테넌트 스텝인가 ══
 *     운영 알림이라 테넌트와 무관하지만, 선점 잠금이 있어 **누가 먼저 부르든 한 번만** 돈다.
 *     global 로 만들면 hourly 우산의 global 목록을 또 건드려야 해서(다른 세션이 만지는 자리) 이번엔 테넌트 스텝 + 잠금으로 둔다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { kstHour, type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

/** 확인할 정책 출처 — **바뀌면 우리 코드가 틀려지는** 문서만 적는다(장식용 링크 금지). */
export interface PolicySource { key: string; label: string; url: string; whatBreaks: string }
export const POLICY_SOURCES: readonly PolicySource[] = [
  { key: "ftc_endorsement", label: "공정위 추천·보증 심사지침", url: "https://www.law.go.kr/LSW//admRulInfoP.do?admRulSeq=2100000190311",
    whatBreaks: "고지 문구·위치(lib/disclosure.ts) — 2024-12-01 개정으로 «제목 또는 첫 부분»이 됐다" },
  { key: "ftc_guide", label: "공정위 경제적 이해관계 표시 안내서", url: "https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1575&ccfNo=2&cciNo=3&cnpClsNo=1",
    whatBreaks: "부적절 표현 목록(«체험단»·«AD»·«Thanks to») · 영상 표시 방법(시작·끝·반복)" },
  { key: "adsense_placement", label: "애드센스 광고 게재위치 정책", url: "https://support.google.com/adsense/answer/1346295?hl=ko",
    whatBreaks: "«광고를 가리키는 표현» 게이트(lib/banned-words.ts findAdPointing) · 광고 자리 배치 규칙" },
  { key: "adsense_publisher", label: "Google 게시자 정책", url: "https://support.google.com/adsense/answer/10502938?hl=ko",
    whatBreaks: "복제 콘텐츠·건강 주장 금지 — 글 게이트(banned_words)의 근거" },
  { key: "youtube_paid", label: "유튜브 유료 프로모션 공개", url: "https://support.google.com/youtube/answer/154235?hl=ko",
    whatBreaks: "영상 고지 3중(lib/video/gen.ts) · paidProductPlacementDetails 시도(lib/publish/youtube.ts)" },
  { key: "youtube_hashtag", label: "유튜브 해시태그 규칙", url: "https://support.google.com/youtube/answer/6390658?hl=ko",
    whatBreaks: "설명란 해시태그 수·snippet.tags 500자(lib/publish/youtube.ts)" },
  { key: "ig_publishing", label: "인스타 콘텐츠 게시 API", url: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    whatBreaks: "유료 파트너십 라벨 파라미터(lib/publish/instagram.ts is_paid_partnership)" },
  { key: "threads_posts", label: "쓰레드 게시물 API", url: "https://developers.facebook.com/documentation/threads/posts",
    whatBreaks: "토픽 태그 1개 규칙(lib/writing-contracts.ts) — 라벨 파라미터가 생기면 고지 축이 바뀐다" },
  { key: "food_ad_law", label: "식품 등의 표시·광고에 관한 법률 §8", url: "https://www.foodsafetykorea.go.kr/portal/board/board.do?menu_grp=MENU_NEW01&menu_no=4838&ctgType=CTG_TYPE01&ctgryno=2255",
    whatBreaks: "건강·식품 효능 표현 사전(lib/banned-words.ts BANNED_HEALTH_CLAIM)" },
  { key: "medical_law", label: "의료법 §56 의료광고 금지", url: "https://www.law.go.kr/LSW//lsLawLinkInfo.do?lsJoLnkSeq=900350305&lsId=001788&chrClsCd=010202&print=print",
    whatBreaks: "건강·의료 소재의 경험담 구성 금지(lib/banned-categories.ts HEALTH_FORBIDDEN_FORMATS)" },
];

/** 지금이 몇 분기인가(KST) — «2026-Q3» 꼴. 이 문자열이 잠금 키의 값이다. */
export function kstQuarter(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const qq = Math.floor(kst.getUTCMonth() / 3) + 1;
  return `${y}-Q${qq}`;
}
const RUN_HOUR = 9;   // KST 09시 — 운영이 출근해서 보는 시간

export const policyReviewStep: CronStep = {
  key: "policy.review",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const quarter = kstQuarter(ctx.now);
    if (!ctx.manual && kstHour(ctx.now) !== RUN_HOUR) return NOOP;

    /* 분기 1회 선점 — 🔴 INSERT 의 VALUES 에 **이번 분기를 이미 넣는다**(coin.reconcile 에서 `null` 로 뒀다가
       두 번째 테넌트가 통과해 두 번 돈 적이 있다 · 2026-09-15 프로브). */
    const claim = await q(sql`INSERT INTO ops_settings (key, value, updated_at)
      VALUES ('policy_review', jsonb_build_object('quarter', ${quarter}::text), NOW())
      ON CONFLICT (key) DO UPDATE SET value = jsonb_set(COALESCE(ops_settings.value, '{}'::jsonb), '{quarter}', to_jsonb(${quarter}::text)), updated_at = NOW()
      WHERE COALESCE(ops_settings.value->>'quarter', '') IS DISTINCT FROM ${quarter}::text
      RETURNING key`);
    if (!claim.length) return { changed: 0, skipped: 1, detail: { reason: "already-ran-this-quarter", quarter } };

    /* 🔴 판정하지 않는다 — **읽을 것과 «틀어지면 무엇이 깨지는가»**를 남긴다. 사람이 본다. */
    await writeAudit({
      tenantId: null, action: "policy_review_due", actorType: "system", target: "policy", riskLevel: "medium",
      detail: {
        quarter,
        sources: POLICY_SOURCES.map((s) => ({ key: s.key, label: s.label, url: s.url, whatBreaks: s.whatBreaks })),
        checklist: "docs/rules/POLICY-REVIEW.md",
        note: "분기 1회 정책 재확인(DESIGN §16B.4) — 사람이 열어 보고 바뀐 것이 있으면 그 자리 코드를 고친다",
      },
    });
    return { changed: 1, skipped: 0, detail: { quarter, sources: POLICY_SOURCES.length } };
  },
};
