/**
 * runner/lib/block-reason.mjs — 🔴 **«막혔다»의 까닭을 가른다. 못 가르면 못 가른다고 말한다**(AC-203 · B2 · 2026-09-23).
 *
 *   ══ 왜 ══
 *     막히는 것 자체는 어쩔 수 없다. 🔴 **문제는 막혔을 때 우리가 까닭을 틀리게 적는 것**이다.
 *     · 다음 사람이 **엉뚱한 데를 판다**
 *     · 손님에게도 틀린 말을 한다 — «IP 문제예요»라고 했는데 실은 로그인이 풀린 것이면 **손님은 프록시를 사러 간다**
 *
 *   ══ 🔴 재고 나서 만들었다(2026-09-23 · `scripts/probe-block-reasons.mjs`) ══
 *     러너가 «막혔다»를 내는 자리가 **95곳**이고 그중 **24곳**이 까닭을 단정하거나 추측을 단정처럼 적었다.
 *     그중 **실제로 틀린 것 둘**을 실측으로 잡았다:
 *
 *     🔴 ① **제재 가지가 죽어 있었다.** `naver-blog.mjs` 가 `locator("text=이용이 제한, text=제재")` 로 봤는데,
 *        콤마는 CSS 목록 문법이라 `text=` 엔진과 섞이면 **한 문자열**로 읽힌다. 브라우저로 재 봤다:
 *          「이 블로그는 이용이 제한된 상태입니다」 → **0** · 「운영원칙 위반으로 제재되었습니다」 → **0**
 *          (통째로 `이용이 제한, text=제재` 라고 적힌 화면에서만 1)
 *        ⇒ **계정이 제재당해도 그 가지는 한 번도 안 걸렸다.** 45초를 기다린 뒤 `unknown`
 *           «글 주소를 회수하지 못했어요»로 끝났고, `unknown` 은 계정 전이가 **0**이라 그 계정은 **계속 잡을 받았다.**
 *        🔴 «사유가 틀린다»의 가장 순수한 꼴이다 — **«제재당했다»고 말해 줄 유일한 가지가 죽어 있었다.**
 *        ⚠️ 같은 파일 **위쪽**(`openEditor`)은 같은 낱말을 **정규식으로** 제대로 본다. 고친 자리와 안 고친 자리가
 *           한 파일에 같이 있었다(B 가 자기 파일에서 겪은 것과 같은 모양).
 *
 *     🔴 ② **같은 문구를 우리 코드가 세 갈래로 읽고 있었다.** `페이지를 찾을 수 없`은
 *          `post-alive.mjs`·`retract.mjs`·`scrape.mjs` 에선 **«그 글이 없다»**인데
 *          `naver-blog.mjs` 발행 대기에서만 **«해외 IP 차단이 의심돼요»**로 적었다.
 *        ⇒ 그 한 문자열로는 IP 를 **지목할 수 없다.** 우리가 본 것은 «오류 화면이 떴다»까지다.
 *
 *   ══ 규율 ══
 *     🔴 **신호가 그 까닭에만 해당할 때만 까닭을 말한다**(`sure: true`).
 *        아니면 **본 것만 적고 «못 쟀어요»라고 한다**(`sure: false`) — AC-9. **틀린 사유보다 «모른다»가 낫다.**
 *     🔴 **네이버 문구를 새로 지어내지 않았다.** 아래 표의 낱말은 전부 **이미 코드에 있던 것**이다
 *        (`openEditor`·`post-alive`·`scrape` 에서 모아 왔다). 안 겪어 본 화면의 문구를 상상해서 넣으면
 *        그게 또 «틀린 사유»가 된다 — 새 낱말은 **실물을 보고** 넣어라.
 *     🔴 말투는 CLAUDE §3: ①무엇이 그런가 ②어떻게 하면 되는지 ③우리가 대신 해 주는 것. 위협·책임 전가 0.
 *
 *   순수 함수다(DOM·네트워크 0) — `scripts/verify-block-reason.mts` 가 브라우저 없이 그대로 돌린다.
 */

/**
 * 🔴 신호표 — **위에서부터** 본다(좁은 것이 먼저).
 *   `sure` — 이 신호가 **그 까닭에만** 해당하나. `false` 면 까닭을 말하지 않고 본 것만 적는다.
 *   `kind` — 계약 7종(`lib/account-health.ts`)만 쓴다. 어휘를 늘리면 B·A·DB 가 같이 흔들린다.
 */
export const NAVER_PUBLISH_SIGNALS = Object.freeze([
  {
    key: "suspended",
    re: /이용이\s*제한|제재|블라인드\s*처리|운영원칙/,
    kind: "suspended",
    sure: true,
    /* §3 — ①사실 ②어떻게 ③우리가 한 것. «정지됩니다» 같은 위협 0. */
    say: "네이버가 이 계정의 이용을 제한하고 있다고 알려 줬어요. 네이버 고객센터에서 풀어야 올릴 수 있어요 — 그동안 예약된 글은 같은 채널의 다른 계정으로 옮겨 드릴게요.",
  },
  {
    key: "relogin",
    re: /로그인이\s*필요|다시\s*로그인|nidlogin/,
    kind: "login_fail",
    sure: true,
    say: "올리는 도중에 네이버가 다시 로그인을 요구했어요. 앱에서 «다시 로그인»을 한 번만 눌러 주시면 그다음부터는 저절로 올라가요.",
  },
  {
    key: "captcha",
    re: /자동입력\s*방지|캡차|captcha|보안문자/i,
    kind: "captcha",
    sure: true,
    say: "네이버가 «자동입력 방지»를 띄웠어요. 창을 띄워 드릴 테니 한 번만 직접 풀어 주세요 — 그 세션을 저장해 다음부터는 건너뜁니다.",
  },
  {
    key: "too_often",
    re: /너무\s*많|잠시\s*후|일시적으로\s*제한|초과하였습니다|하루\s*\d+회/,
    kind: "rate_limited",
    sure: true,
    say: "네이버가 «글이 너무 잦다»고 했어요. 하루 올리는 수를 한 건 줄이고 잠시 쉬었다가 이어서 올릴게요.",
  },
  {
    key: "no_blog",
    re: /해당\s*블로그가\s*없|존재하지\s*않는\s*블로그|블로그\s*아이디를\s*확인|유효하지\s*않은\s*요청/,
    kind: "login_fail",
    sure: true,
    say: "네이버에 그 주소의 블로그가 없다고 나와요. 계정에 적힌 블로그 주소를 한 번만 확인해 주세요.",
  },
  {
    /* 🔴 **여기가 종전에 «해외 IP 차단이 의심돼요»로 단정하던 자리다.**
       그 한 문자열은 우리 코드 다른 세 곳에서 «그 글이 없다»로 읽힌다 — **IP 를 지목할 근거가 아니다.**
       ⇒ `sure:false`. 본 것만 적고 까닭은 **고르지 않는다.** */
    key: "error_page",
    re: /페이지를\s*찾을\s*수\s*없|잘못된\s*접근|오류가\s*발생|일시적인\s*오류/,
    kind: "network",
    sure: false,
    say: "네이버가 오류 화면을 돌려줘서 이 글은 올리지 못했어요. 무엇 때문인지는 아직 못 쟀어요 — 잠시 뒤에 다시 해 보고, 또 그러면 저희가 확인할게요.",
  },
]);

/**
 * 🔴 정본(순수). **본 글자**로 까닭을 가른다.
 *   @param {{seen?: string, url?: string}} o  `seen` = 화면에 **보이는 글자**(innerText · 원본 HTML 아님)
 *   @returns {{ kind, key, sure, message, matched, seenSample }}
 *     · `matched:false` ⇒ 🔴 **아무 신호도 못 봤다.** 까닭을 지어내지 않고 본 것을 적는다.
 *
 *   ⚠️ **원본 HTML 로 재지 마라** — 스크립트 안 낱말에 걸린다(`classifyNaverLoginWall` 이 카카오에서 피 본 함정).
 */
export function judgeBlockReason(o = {}) {
  const seen = String(o.seen ?? "").replace(/\s+/g, " ").trim();
  const url = String(o.url ?? "");
  const seenSample = seen.slice(0, 120);
  /* 주소가 로그인 화면이면 글자보다 그게 세다(서버가 보낸 곳이라 추측이 아니다). */
  if (/nidlogin/i.test(url)) {
    const s = NAVER_PUBLISH_SIGNALS.find((x) => x.key === "relogin");
    return { kind: s.kind, key: s.key, sure: true, message: s.say, matched: true, seenSample };
  }
  for (const s of NAVER_PUBLISH_SIGNALS) {
    if (!s.re.test(seen)) continue;
    return { kind: s.kind, key: s.key, sure: s.sure, message: s.say, matched: true, seenSample };
  }
  /* 🔴 아무것도 못 봤다 — **까닭을 고르지 않는다.** «모름»을 지어내지 않는 것이 이 함수의 전부다. */
  return {
    kind: "unknown", key: "unmeasured", sure: false, matched: false, seenSample,
    message: seen
      ? `글이 올라갔는지 확인하지 못했어요. 무엇에 막혔는지는 못 쟀어요 — 화면에는 «${seenSample.slice(0, 40)}» 이 보였어요. 저희가 확인할게요.`
      : "글이 올라갔는지 확인하지 못했어요. 화면을 읽지 못해 까닭도 못 쟀어요 — 저희가 확인할게요.",
  };
}

/** 사람말 한 줄(보고 `notes` 용). 🔴 `sure:false` 면 **까닭을 말하지 않는다.** */
export function blockReasonSay(v) {
  if (!v) return "막힌 까닭을 못 쟀어요";
  return v.sure ? v.message : `${v.message}`;
}
