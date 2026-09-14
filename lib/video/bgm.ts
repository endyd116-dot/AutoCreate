/**
 * lib/video/bgm.ts — 배경음악 관문(계약 §1.4c(3) · §2.1 `audio.bgm`).
 *   곡은 `scripts/seed-bgm.mjs` 가 FreePD(CC0) 에서 받아 R2 `autocreate/bgm/` 에 올리고 매니페스트를 남긴다.
 *
 *   🔴 **정직한 무음이 기본이다.** `BGM_LICENSE_VERIFIED=1` 이 없으면 무조건 `null`(= 러너가 나레이션만 믹스).
 *      라이선스를 사람이 확인하기 전에는 음악을 쓰지 않는다 — 남의 곡이 섞인 영상이 채널에 올라가면 계정이 죽는다.
 *      env 를 꽂는 사람은 메인·사장님(시드 결과를 듣고 나서). 코드가 스스로 켜는 길은 없다.
 *   🔴 매니페스트가 없거나 못 읽어도 `null`(막지 않고 무음) — BGM 은 보조다. 실패가 영상 제작을 세우지 않는다.
 *
 *   고르기는 **결정론**: 같은 piece 는 늘 같은 곡(재생성·이어달리기에서 음악이 바뀌지 않는다).
 */
import { r2Get } from "../r2";

export interface BgmTrack { slug: string; title: string; mood: string; key: string; bytes?: number; sourceUrl?: string }
export interface BgmManifest { version: number; updatedAt: string; prefix: string; defaultGainDb: number; tracks: BgmTrack[] }

const MANIFEST_KEY = "autocreate/bgm/manifest.json";
const CACHE_MS = 10 * 60_000;
let _cache: { at: number; manifest: BgmManifest | null } | null = null;

/** 라이선스 확인 스위치 — 이것이 «1» 이 아니면 이 파일의 모든 길이 null 로 끝난다. */
export function bgmEnabled(): boolean { return String(process.env.BGM_LICENSE_VERIFIED ?? "").trim() === "1"; }

/** 매니페스트(10분 캐시). 없으면 null — 시드를 안 돌렸다는 뜻이고, 그건 오류가 아니라 무음이다. */
export async function loadBgmManifest(): Promise<BgmManifest | null> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.manifest;
  let manifest: BgmManifest | null = null;
  try {
    const obj = await r2Get(MANIFEST_KEY);
    if (obj) {
      const parsed = JSON.parse(Buffer.from(obj.bytes).toString("utf8")) as BgmManifest;
      if (Array.isArray(parsed?.tracks) && parsed.tracks.length) manifest = parsed;
    }
  } catch (e) { console.warn("[video/bgm] 매니페스트를 읽지 못했습니다(무음으로 진행):", String((e as Error)?.message ?? e).slice(0, 100)); }
  _cache = { at: Date.now(), manifest };
  return manifest;
}
/** 테스트·운영 재적재용. */
export function clearBgmCache(): void { _cache = null; }

/** 포맷 → 곡 분위기(계약 §5.4 영상 감성과 같은 결). 매니페스트에 그 분위기가 없으면 아무 곡이나(결정론). */
export function moodForFormat(format: string): string {
  return format === "talking" ? "calm" : format === "clip" ? "drive" : "bright";
}

/**
 * resolveBgm — 이 편에 깔 곡 한 개. 없으면 **null(무음)**.
 *   `seed` 는 pieceId — 같은 piece 면 늘 같은 곡(재생성·이어달리기에서 음악이 갈리지 않는다).
 */
export async function resolveBgm(a: { format?: string; mood?: string; seed?: number }): Promise<{ key: string; gainDb: -18 } | null> {
  if (!bgmEnabled()) return null;                                   // 🔴 라이선스 미확인 = 무음(정직 경로)
  const m = await loadBgmManifest();
  if (!m) return null;
  const want = a.mood || moodForFormat(String(a.format ?? "graphic"));
  const pool = m.tracks.filter((t) => String(t.mood) === want);
  const list = pool.length ? pool : m.tracks;
  if (!list.length) return null;
  const pick = list[Math.abs(Math.trunc(a.seed ?? 0)) % list.length];
  if (!pick?.key) return null;
  return { key: pick.key, gainDb: -18 };                            // 러너 믹스 기본 볼륨(계약 §2.1 · 매니페스트 defaultGainDb 와 같은 값)
}
