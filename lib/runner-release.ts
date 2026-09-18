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
 *   🔎 출처: AC 신규(계약 러너 배포 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { r2Configured, r2Get, r2PresignGet } from "./r2";

export interface RunnerRelease { version: string; sha256: string; bytes: number; releasedAt?: string; notes?: string }
export interface RunnerUpdateOffer { version: string; url: string; sha256: string; bytes: number }

const CACHE_MS = 60_000;
const DOWNLOAD_TTL_SEC = 600;                       // 10분 — 계약값
let cache: { at: number; rel: RunnerRelease | null } = { at: 0, rel: null };

export const releaseKey = (version: string) => `autocreate/runner/v${version}.zip`;
/** 고객 다운로드 폴더에 남을 이름. 🔴 API 응답의 `filename` 과 **같은 값**이어야 한다(화면이 말한 이름과 실제가 달라지지 않게). */
export const releaseFilename = (version: string) => `autocreate-runner-v${version}.zip`;

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
  /* 🔴 파일명을 **서명에 담는다**. 받는 곳이 R2 도메인이라 우리 화면은 이름을 정할 수 없다(cross-origin 에서 `download` 속성은 무시된다) —
     담지 않으면 고객 폴더에 «v1.1.3.zip» 이 남아 무엇인지 알 수 없다(2026-09-15 A 발견). */
  const url = await r2PresignGet(releaseKey(rel.version), DOWNLOAD_TTL_SEC, { filename: releaseFilename(rel.version) });
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

/* ═══════════ [수리 라운드 2026-09-19 · B2] 🔴 «고객 PC 가 받아 가는 판»을 **운영 화면까지** ═══════════
 *   2026-09-15 에 «고객 러너는 v1.3.0» 이라는 말이 **세 번 인용됐는데 라이브는 v1.1.8** 이었다.
 *   근거가 `runner/package.json`(= **우리 소스**)이었기 때문이다 — 고객이 받아 가는 것은 R2 의 `latest.json` 이다.
 *   `scripts/read-runner-live.mts` 가 그때 생겼지만 그건 **사람이 손으로 부르는 자**라, 운영자가 `/ops/runners` 를
 *   보고 있는 동안에는 아무도 그 사실을 모른다. ⇒ **같은 값을 화면에도 세운다.**
 *   🔴 읽는 법은 위의 `latestRelease()` **그대로 쓴다** — 여기서 R2 를 다시 읽으면 두 벌이 되고, 두 벌은 또 갈린다
 *      (그게 바로 이 문제의 **재발**이지 수리가 아니다).
 */
export interface RunnerReleaseHealth {
  /** 🔴 `false` = **못 쟀다**(«판이 없다»도 «최신이다»도 아니다 · AC-9). */
  measured: boolean;
  reason?: string;
  version: string | null;
  releasedAt: string | null;
  bytes: number | null;
  sha256: string | null;
  notes: string | null;
  /** `latest.json` 이 가리키는 zip 이 **정말 있나**. 가리키기만 하고 없으면 러너가 받다 실패한다. `null` = 못 물어봤다(≠ 없다). */
  zipOk: boolean | null;
  /** zip 실측 바이트가 `latest.json` 과 같은가. `null` = 못 쟀다. */
  bytesMatch: boolean | null;
}

/** 운영 화면용 — 라이브 판 + «그 판 파일이 진짜 있나»까지. 🔴 던지지 않는다(이것 때문에 운영 화면이 500 나면 안 된다). */
export async function releaseHealth(): Promise<RunnerReleaseHealth> {
  if (!r2Configured()) return { measured: false, reason: "R2 설정이 없어서 못 읽었어요", version: null, releasedAt: null, bytes: null, sha256: null, notes: null, zipOk: null, bytesMatch: null };
  const rel = await latestRelease();
  if (!rel) return { measured: false, reason: "아직 올린 판이 없거나 판 정보를 읽지 못했어요", version: null, releasedAt: null, bytes: null, sha256: null, notes: null, zipOk: null, bytesMatch: null };
  let zipOk: boolean | null = null, bytesMatch: boolean | null = null;
  try {
    const { r2Head } = await import("./r2");
    const h = await r2Head(releaseKey(rel.version));
    zipOk = !!h;
    if (h) bytesMatch = h.bytes === rel.bytes;
  } catch { zipOk = null; }                            // 🔴 못 물어봤다 ≠ 없다
  return { measured: true, version: rel.version, releasedAt: rel.releasedAt ?? null, bytes: rel.bytes, sha256: rel.sha256, notes: rel.notes ?? null, zipOk, bytesMatch };
}

/**
 * 이 기기가 **라이브 판을 쓰고 있나**.
 *   🔴 판정을 **서버에서** 한다 — 화면이 조건을 다시 짜면 서버와 갈린다(AC-74 · `ops/runners.html` 이 이미 적어 둔 규율).
 *   🔴 `null` = 못 쟀다: 라이브 판을 못 읽었거나(기기 탓이 아니다) 기기가 아직 판을 안 알려 줬다.
 *   🔴 비교는 `cmpVersion` 한 벌로 — 하트비트의 «권할까»(`updateOfferFor`)와 **같은 잣대**여야 한다.
 *      다른 잣대를 쓰면 화면은 «낡음»이라는데 하트비트는 안 권하는 일이 생긴다.
 */
export function runnerUpToDate(deviceVersion: string | null | undefined, rel: RunnerReleaseHealth): boolean | null {
  if (!rel.measured || !rel.version) return null;
  const v = String(deviceVersion ?? "").trim();
  if (!v) return null;
  if (!/^\d+\.\d+\.\d+$/.test(v)) return null;         // 형식을 모르면 «낡았다»고 단정하지 않는다
  return cmpVersion(rel.version, v) <= 0;              // 라이브가 더 높지 않다 = 이 기기는 뒤처지지 않았다
}
