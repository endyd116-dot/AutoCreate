/**
 * lib/publish/dispatcher.ts — API 채널(유튜브·릴스·스레드)을 **계정별 IP 로** 내보낼 자리(계약 P1R7 §2.5-⑤).
 *
 *   지금 상태: 이 채널들은 **서버 `fetch`** 로 올라간다 → 전 고객이 **우리 Netlify IP 를 공유**한다.
 *   러너 채널(네이버·티스토리)은 브라우저에 프록시를 걸어 계정별로 갈랐는데, 여기는 그 자리가 아예 없었다.
 *
 *   🔴 **정직 표기(계약이 명시한 것)**: IP 를 나눠도 이 채널들은 **우리 OAuth 앱 하나**를 전 고객이 공유하므로
 *      **앱 단위로 묶일 수 있다.** IP 분리로 그건 못 막는다 — 화면·문서에 «막아 준다»고 쓰면 안 된다.
 *      («IP 는 나눠 드리지만, 플랫폼 규칙 위반은 앱 전체에 영향이 갈 수 있어요.»)
 *
 *   🔴 **기본은 직결이다.** 켜는 조건이 둘 다 맞아야 한다:
 *        ① `PROXY_API_PUBLISH=1`  ② 그 계정에 프록시가 배정돼 있다
 *      켜지 않으면 `undefined` 를 돌려주고 호출부는 지금처럼 그냥 `fetch` 한다 — **동작이 하나도 안 바뀐다.**
 *
 *   ⚠️ 실제로 태우려면 `undici` 가 필요하다(Node 내장 fetch 는 dispatcher 를 받지만 `ProxyAgent` 는 별도 패키지다).
 *      지금 의존성에 **없다** — 그래서 켜면 «패키지가 없다»고 **정직하게 던진다**(조용히 직결로 내려앉지 않는다).
 *      내려앉으면 «프록시를 쓰는 줄 알았는데 우리 IP 로 나가는» 바로 그 사고가 된다(§2.5 구멍 1 과 같은 함정).
 *   🔎 출처: AC 신규(계약 P1R7-B2 2.5-⑦⑤ · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { decryptObj } from "../creds-crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/** 이 기능이 켜져 있나(둘 중 하나라도 아니면 직결). */
export const apiProxyEnabled = (): boolean => String(process.env.PROXY_API_PUBLISH ?? "") === "1";

/**
 * 이 계정으로 나갈 때 쓸 dispatcher. **켜져 있지 않거나 프록시가 없으면 `undefined`**(= 지금처럼 직결).
 * 호출부: `fetch(url, { ...init, ...(d ? { dispatcher: d } : {}) })`
 */
export async function accountDispatcher(accountId: number): Promise<unknown | undefined> {
  if (!apiProxyEnabled() || !accountId) return undefined;

  const [r] = await q(sql`SELECT p.url_enc FROM accounts a JOIN proxies p ON p.id = a.proxy_id
    WHERE a.id = ${accountId} AND p.status = 'active' LIMIT 1`);
  if (!r?.url_enc) return undefined;                      // 프록시를 안 산 계정 — 지금처럼 직결(소급 0)

  const url = String(decryptObj<{ url?: string }>(String(r.url_enc))?.url ?? "");
  if (!url) throw new Error("PROXY_DECRYPT: 이 계정의 IP 주소를 읽지 못했어요 — 남의 IP 로 나가지 않도록 멈췄어요.");

  let ProxyAgent: new (url: string) => unknown;
  try {
    /* ⚠️ 문자열을 변수로 둔다 — `undici` 가 **아직 의존성에 없어서** 정적 import 면 컴파일이 깨진다.
       (AC-18 은 «러너 채널은 정적 import» 인데, 여기는 러너가 아니라 **아직 없는 선택적 패키지**라 반대다.
        패키지를 넣기로 정하면 이 줄을 정적 import 로 되돌리는 게 맞다.) */
    const mod = "undici";
    ({ ProxyAgent } = await import(/* @vite-ignore */ mod) as { ProxyAgent: new (u: string) => unknown });
  } catch {
    /* 🔴 여기서 `return undefined` 로 내려앉으면 **프록시를 쓰는 줄 알면서 우리 IP 로 나간다.**
       그게 §2.5 가 막으려던 바로 그 사고라, 켜 놓고 못 쓰면 **멈추는 쪽**을 고른다. */
    throw new Error("PROXY_API_UNAVAILABLE: 계정별 IP 발행을 켜려면 `undici` 패키지가 필요해요(npm i undici). 지금은 올리지 않았어요.");
  }
  return new ProxyAgent(url);
}
