/**
 * lib/ops/features.ts — **기능 스위치 한 곳**(`ops_settings.features` · 플랫폼 한 벌).
 *
 *   ══ 이 파일이 있는 이유 ══
 *     «만들었는데 지금은 안 판다»가 생긴다. 🔴 그때 **코드를 지우면 다음에 처음부터 다시 만든다** —
 *     그래서 CLAUDE §8 관례대로 **«켜면 즉시 가동» 상태로 재워 둔다**: 서버·표·검사는 그대로, **입구만 닫는다.**
 *
 *   🔴 **기본값은 이 파일에만 적는다.** 읽는 곳마다 `?? false` 를 적으면 언젠가 한 곳이 `?? true` 가 된다(오늘 코인 식이 세 곳에 흩어져 샌 것과 같은 모양 · AC-74).
 *   🔴 읽기 실패 = **기본값으로**(설정 조회가 안 된다고 안 팔던 걸 팔면 안 된다 · fail-closed).
 */
import { readOpsSetting } from "./settings";

export const FEATURES_KEY = "features";

export interface Features {
  /**
   * 고객이 **자기 AI 키**를 꽂기(§4.4 BYO).
   * 🔴 **기본 꺼짐** — 사장님 판단 2026-09-16 «수익 관점에서 BYO 안 하는 게 좋겠다».
   *    서버·표·하니스는 그대로 살아 있고 **고객 화면 입구만** 닫혀 있다. 켜면 그 자리에서 이어진다.
   */
  byoAiKey: boolean;
}

/** 🔴 기본값의 유일한 자리. */
export function featureDefaults(): Features {
  return { byoAiKey: false };
}

/** 지금 켜져 있나 — 60초 캐시(무배포 토글이 1분 안에 먹는다). 못 읽으면 기본값(fail-closed). */
export async function featureOn(key: keyof Features): Promise<boolean> {
  try {
    const bag = await readOpsSetting(FEATURES_KEY);
    const v = bag[key];
    return typeof v === "boolean" ? v : featureDefaults()[key];
  } catch { return featureDefaults()[key]; }
}
