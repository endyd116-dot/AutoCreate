/**
 * scripts/verify-runner-auth.mts — **로그인 벽을 무엇으로 부르는가**를 돌려서 확인한다(2026-09-15 B2).
 *
 *   🔴 왜 이 자리가 제일 비싼가: 전이표(`lib/account-health.ts`)에서
 *        `login_fail`·`captcha` → 계정 **`pending_login`** → 고객에게 «다시 로그인하세요»
 *        `unknown`·`network`·`selector_changed` → 계정 **그대로**(건강도만 깎인다 · 계정 잘못이 아니다)
 *      즉 여기서 잘못 부르면 **우리 문제인데 고객을 부른다.** 그리고 그 «다시 로그인»이 반복되면
 *      캡차를 부른다(이 파일들의 주석에 실측이 남아 있다 — job #16).
 *
 *   🔴 실계정으로 로그인해 보지 않는다(캡차를 부른다 · AC-19 · 메인 지시).
 *      그래서 판정을 **순수 함수**로 뽑아 «그 화면이면 뭐라고 부르나»만 본다 — 네트워크·브라우저 0.
 *
 *   ── 옛 판 되짚기(2026-09-15 · 실측) ──────────────────────────────────
 *   옛 코드엔 이 판정이 함수로 없어서(브라우저 안에 박혀 있었다) git 원문의 그 줄들을 **그대로 옮겨** 같은 케이스를 먹였다.
 *   ⚠️ 재구성이다 — «옛 파일을 그대로 돌렸다»가 아니라 «옛 판정 줄을 그대로 옮겨 돌렸다»가 정확한 말이다.
 *   결과: **네 케이스 전부 계정을 `pending_login` 으로 밀었다.** 그중 둘은 거짓 안내였다:
 *     · 이유를 모르는 경우        → «아이디 또는 비밀번호가 맞지 않아요»  (맞는 비밀번호를 쓴 고객에게)
 *     · 보호조치(idSafetyRelease) → «처음 보는 기기라며 등록을 요구했어요» (고객이 엉뚱한 걸 하고 돌아온다)
 *     · 🔴 카카오 성공 + 블로그 글에 «2단계 인증» → **성공을 login_fail 로 뒤집었다**
 *     · 카카오 이유 모름(동의 화면 막힘 = 우리 문제) → 고객을 불렀다
 *
 *   실행: npx --yes tsx scripts/verify-runner-auth.mts        (DB·네트워크·브라우저 불필요)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const load = async (f: string) => await import(pathToFileURL(path.join(ROOT, "runner", "lib", f)).href);
const { classifyNaverLoginWall } = await load("auth-naver.mjs") as {
  classifyNaverLoginWall: (url: string, seen: string, hasCaptchaEl?: boolean) => { kind: string; message: string } | null;
};
const { classifyKakaoLoginWall } = await load("auth-kakao.mjs") as {
  classifyKakaoLoginWall: (url: string, seen: string) => { kind: string; message: string } | null;
};

interface Case {
  name: string;
  url: string;
  seen: string;
  captchaEl?: boolean;
  /** null = 벽 없음(통과) · 아니면 그렇게 불러야 한다. */
  wantKind: string | null;
  /** 사람에게 나갈 문구에 반드시 들어가야 할 말(거짓 안내 방지). */
  wantSays?: RegExp;
  why: string;
}

const NAVER: Case[] = [
  {
    name: "캡차 주소", url: "https://nid.naver.com/login/captcha", seen: "자동입력 방지 문자를 입력해 주세요",
    wantKind: "captcha", why: "기준선",
  },
  {
    name: "캡차 요소만 있음", url: "https://nid.naver.com/nidlogin.login", seen: "보안을 위해", captchaEl: true,
    wantKind: "captcha", why: "주소가 안 바뀌어도 요소로 잡는다",
  },
  {
    name: "처음 보는 기기", url: "https://nid.naver.com/user2/deviceConfirm?x=1", seen: "새로운 기기에서 로그인",
    wantKind: "login_fail", wantSays: /기기/, why: "고객이 풀어야 한다",
  },
  {
    name: "🔴 보호조치(idSafetyRelease)", url: "https://nid.naver.com/user2/idSafetyRelease", seen: "보호조치가 적용된 상태입니다",
    wantKind: "login_fail", wantSays: /보호조치|보호/, why: "🔴 «처음 보는 기기»와 **다른 일**이다 — 같은 문구로 안내하면 고객이 엉뚱한 걸 한다",
  },
  {
    name: "2단계 인증", url: "https://nid.naver.com/nidlogin.login?mode=need2", seen: "2단계 인증",
    wantKind: "login_fail", wantSays: /2단계/, why: "재로그인으로 안 풀린다는 걸 문구가 말해야 한다",
  },
  {
    name: "비밀번호 틀림(네이버가 그렇게 말함)", url: "https://nid.naver.com/nidlogin.login",
    seen: "아이디 또는 비밀번호를 잘못 입력하셨습니다. 입력하신 내용을 다시 확인해주세요.",
    wantKind: "login_fail", wantSays: /비밀번호/, why: "화면이 그렇게 말할 때만 그렇게 부른다",
  },
  {
    name: "🔴🔴 로그인 화면에 남았는데 이유를 모름", url: "https://nid.naver.com/nidlogin.login",
    seen: "네이버 로그인",
    wantKind: "unknown", wantSays: /끝나지 않|모르|확인/,
    why: "🔴 여기서 «비밀번호가 맞지 않아요»라고 하면 **멀쩡한 계정에 거짓 딱지**가 붙고 pending_login 으로 밀린다",
  },
  {
    name: "성공(블로그로 이동)", url: "https://blog.naver.com/myid", seen: "내 블로그",
    wantKind: null, why: "벽 없음",
  },
  {
    name: "음성① 글 안에 «자동입력 방지»가 있는 성공 화면", url: "https://blog.naver.com/myid",
    seen: "오늘 쓴 글: 자동입력 방지 문자 우회하는 법 2단계 인증 새로운 기기",
    wantKind: null, why: "🔴 낱말이 **본문에 있다고** 벽이 아니다 — 성공을 실패로 뒤집으면 제일 나쁘다",
  },
];

const KAKAO: Case[] = [
  {
    name: "캡차", url: "https://accounts.kakao.com/login", seen: "자동입력 방지 문자를 입력하세요",
    wantKind: "captcha", why: "기준선",
  },
  {
    name: "2단계 인증", url: "https://accounts.kakao.com/login/two-step", seen: "2단계 인증 카카오톡으로 로그인 확인",
    wantKind: "login_fail", wantSays: /2단계/, why: "사람이 카카오톡에서 눌러야 한다",
  },
  {
    name: "새로운 기기", url: "https://accounts.kakao.com/login", seen: "새로운 기기에서 로그인하려고 합니다",
    wantKind: "login_fail", wantSays: /기기/, why: "고객이 풀어야 한다",
  },
  {
    name: "비밀번호 틀림(카카오가 그렇게 말함)", url: "https://accounts.kakao.com/login",
    seen: "비밀번호가 일치하지 않습니다",
    wantKind: "login_fail", wantSays: /비밀번호/, why: "화면이 그렇게 말할 때만",
  },
  {
    name: "🔴 카카오 화면에 남았는데 이유를 모름", url: "https://accounts.kakao.com/login", seen: "카카오계정",
    wantKind: "unknown", wantSays: /끝나지 않/,
    why: "🔴 동의 화면에서 막힌 것도 여기로 온다 — 그건 **우리 문제**지 고객 비밀번호 문제가 아니다",
  },
  {
    name: "성공(티스토리로 돌아옴)", url: "https://www.tistory.com/", seen: "내 블로그 관리",
    wantKind: null, why: "콜백 완료 = 통과",
  },
  {
    name: "🔴🔴 음성: 티스토리로 돌아왔는데 그 글에 «2단계 인증»이 있다",
    url: "https://myblog.tistory.com/manage", seen: "최근 글: 카카오 2단계 인증 켜는 법 · 새로운 기기 등록하기",
    wantKind: null,
    why: "🔴 로그인은 **성공**했다. 화면 글자만 보면 성공을 login_fail 로 뒤집고 멀쩡한 계정을 pending_login 으로 민다",
  },
  {
    name: "음성: 카카오 도메인 아님 + 아무 글자", url: "https://example.com/", seen: "아무 글",
    wantKind: null, why: "카카오 인증 화면이 아니면 이 판정의 대상이 아니다",
  },
];

let pass = 0; const fails: string[] = [];
const run = (label: string, cases: Case[], fn: (u: string, s: string, c?: boolean) => { kind: string; message: string } | null) => {
  console.log(`\n  [${label}]`);
  for (const c of cases) {
    const got = fn(c.url, c.seen, c.captchaEl);
    const bad: string[] = [];
    const gotKind = got?.kind ?? null;
    if (gotKind !== c.wantKind) bad.push(`기대 ${c.wantKind ?? "통과"} · 실제 ${gotKind ?? "통과"}`);
    if (c.wantSays && got && !c.wantSays.test(got.message)) bad.push(`문구에 ${c.wantSays} 가 없다 — «${got.message.slice(0, 50)}»`);
    if (!bad.length) pass++; else fails.push(`${label} «${c.name}» — ${bad.join(" · ")}  (${c.why})`);
    console.log(`  ${bad.length ? "✗" : "✓"} ${c.name.padEnd(44)} → ${(gotKind ?? "통과").padEnd(14)}${got ? `«${got.message.slice(0, 40)}»` : ""}`);
    for (const x of bad) console.log(`        ${x}`);
  }
};

console.log("\n  로그인 벽 판정 실측 (순수 함수 · 실계정 로그인 없음)");
run("네이버", NAVER, (u, s, c) => classifyNaverLoginWall(u, s, c));
run("카카오", KAKAO, (u, s) => classifyKakaoLoginWall(u, s));

/* 🔴 음성 대조 — «전부 벽» 이나 «전부 통과» 면 검사가 아무것도 안 보는 것이다.
   그리고 **고객을 부르는 종류(login_fail·captcha)와 안 부르는 종류(unknown)가 둘 다** 나와야 한다 —
   한쪽만 나오면 이 판정은 가르는 일을 안 하고 있는 것이다. */
const all = [...NAVER.map((c) => classifyNaverLoginWall(c.url, c.seen, c.captchaEl)), ...KAKAO.map((c) => classifyKakaoLoginWall(c.url, c.seen))];
const kinds = new Set(all.map((r) => r?.kind ?? "통과"));
const spread = kinds.has("통과") && kinds.has("login_fail") && kinds.has("captcha") && kinds.has("unknown");
console.log(`\n  ${spread ? "✓" : "✗"} 음성 대조 — 나온 판정 ${[...kinds].join(", ")}`);
if (!spread) fails.push("판정이 한쪽으로 쏠렸다(통과·login_fail·captcha·unknown 이 다 나와야 한다) — 초록이어도 의미가 없다");

const total = NAVER.length + KAKAO.length;
console.log(`\n  통과 ${pass}/${total}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 우리 문제와 고객 문제를 섞지 않는다.\n");
