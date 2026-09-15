/**
 * lib/runner-release.ts — 러너 배포판의 단일 출처(계약 «러너 배포» ①②③).
 *   R2 `runner/latest.json`(빌더 `scripts/build-runner.mts` 가 올린다)을 읽어
 *   ① 내려받기 링크(presigned) ② 하트비트의 업데이트 제안 을 만든다.
 *
 *   🔴 **링크는 항상 짧게 산다(10분).** 러너 zip 은 우리 자동화의 알맹이라 공개 URL 로 두지 않는다 —
 *      로그인·플랜을 통과한 사람에게만, 그때그때 만들어 준다(`netlify/functions/runner.ts` 의 runner-download).
 *   🔴 **latest.json 은 캐시한다.** 하트비트는 기기마다 분당 한 번씩 온다 — 그때마다 R2 를 때리면
 *      요금과 지연이 고객 수에 비례해 커진다. 60초면 «새 판 올린 뒤 1분 안»에 다 퍼진다(충분하다).
 *   🔴 **못 읽으면 조용히 «업데이트 없음»** 이다. 릴리스 정보를 못 읽었다고 러너를 멈추면,
 *      R2 장애가 곧 발행 중단이 된다. 배포는 편의고 발행은 본업이다 — 본업을 인질로 잡지 않는다.
 */
import { r2Configured, r2Get, r2PresignGet } from "./r2";

export interface RunnerRelease { version: string; sha256: string; bytes: number; releasedAt?: string; notes?: string }
export interface RunnerUpdateOffer { version: string; url: string; sha256: string; bytes: number }

const CACHE_MS = 60_000;
const DOWNLOAD_TTL_SEC = 600;                       // 10분 — 계약값
let cache: { at: number; rel: RunnerRelease | null } = { at: 0, rel: null };

export const releaseKey = (version: string) => `autocreate/runner/v${version}.zip`;

/** 지금 배포 중인 판. 없거나 못 읽으면 null(호출부는 «아직 준비 중»으로 정직하게 말한다). */
export async function latestRelease(): Promise<RunnerRelease | null> {
  if (Date.now() - cache.at < CACHE_MS) return cache.rel;
  let rel: RunnerRelease | null = null;
  try {
    if (r2Configured()) {
      const got = await r2Get("autocreate/runner/latest.json");
      if (got) {
        const j = JSON.parse(Buffer.from(got.bytes).toString("utf8")) as Partial<RunnerRelease>;
        const version = String(j.version ?? "");
        const sha256 = String(j.sha256 ?? "");
        const bytes = Number(j.bytes ?? 0);
        // 🔴 셋 중 하나라도 없으면 «판이 없는 것»으로 친다 — 반쪽 정보로 러너에게 받으라고 하면 안 된다.
        if (/^\d+\.\d+\.\d+$/.test(version) && /^[0-9a-f]{64}$/i.test(sha256) && bytes > 0) {
          rel = { version, sha256: sha256.toLowerCase(), bytes, ...(j.releasedAt ? { releasedAt: String(j.releasedAt) } : {}), ...(j.notes ? { notes: String(j.notes) } : {}) };
        }
      }
    }
  } catch (e) {
    console.error("[runner-release] latest.json", (e as Error)?.message ?? e);
  }
  cache = { at: Date.now(), rel };
  return rel;
}

/** 지금 판을 받을 수 있는 짧은 링크. 판이 없으면 null. */
export async function presignLatest(): Promise<{ rel: RunnerRelease; url: string } | null> {
  const rel = await latestRelease();
  if (!rel) return null;
  const url = await r2PresignGet(releaseKey(rel.version), DOWNLOAD_TTL_SEC);
  return { rel, url };
}

/** semver 비교 — a > b 면 양수. 형식이 아니면 0(비교하지 않는다 = 권하지 않는다). */
export function cmpVersion(a: string, b: string): number {
  const ok = (v: string) => /^\d+\.\d+\.\d+$/.test(String(v ?? ""));
  if (!ok(a) || !ok(b)) return 0;
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = pa[i] - pb[i]; if (d) return d; }
  return 0;
}

/**
 * 하트비트에 실을 업데이트 제안. 기기가 이미 최신이면 null(=아무것도 안 싣는다).
 *   🔴 **더 높을 때만** 권한다. 같거나 낮으면(=우리가 롤백한 뒤) 가만히 둔다 —
 *      내려주기 시작하면 두 판이 서로를 덮어쓰며 오가는 사고가 난다.
 */
export async function updateOfferFor(deviceVersion: string | null | undefined): Promise<RunnerUpdateOffer | null> {
  const rel = await latestRelease();
  if (!rel) return null;
  if (cmpVersion(rel.version, String(deviceVersion ?? "")) <= 0) return null;
  try {
    const url = await r2PresignGet(releaseKey(rel.version), DOWNLOAD_TTL_SEC);
    return { version: rel.version, url, sha256: rel.sha256, bytes: rel.bytes };
  } catch (e) {
    console.error("[runner-release] presign", (e as Error)?.message ?? e);
    return null;                                    // 링크를 못 만들면 이번 바퀴는 그냥 넘어간다
  }
}
