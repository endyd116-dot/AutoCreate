/**
 * runner/channels/naver-clip.mjs — 네이버 클립 **스텁**(계약 P1R5 §2.3).
 *
 *   🔴 아직 올릴 방법이 없다. 네이버 클립은 공개 업로드 API 가 없고, 웹 업로드는 모바일 앱 전용 흐름이라
 *      브라우저 자동화로 흉내 내면 계정이 막힌다(AM 교훈: 막힌 길을 우회하려다 계정을 잃는다).
 *   그래서 **정직하게 멈춘다**: 잡을 집자마자 «아직 못 한다»고 돌려보내고, 서버가 그 글을
 *      `awaiting_manual` 로 두고 «클립은 앱에서 올려 주세요» 알림을 띄운다.
 *   조용히 0건으로 사라지지 않는 것이 이 파일의 존재 이유다(PITFALLS #7).
 *
 *   길이 열리면(공식 API·파트너 권한) 이 파일만 채우면 된다 — 잡 kind·큐·발행 경계는 이미 다 서 있다.
 */
const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

export async function run({ job }) {
  const handle = String(job?.account?.handle ?? "").slice(0, 30);
  throw BLOCK("not_supported_yet",
    `네이버 클립은 아직 자동 업로드를 지원하지 않아요${handle ? `(@${handle})` : ""}. 만들어 둔 영상을 네이버 앱에서 올려 주세요.`);
}

export const channel = "naver_clip";
