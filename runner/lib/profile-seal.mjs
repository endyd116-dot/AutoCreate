/**
 * runner/lib/profile-seal.mjs — **이 PC 의 브라우저 프로필이 실제로 잠겨 있나**를 잰다(P1R8 §3.1 / ④11 · 0단계).
 *   설계: `docs/active/2026-09-15-runner-profile-seal-design.md`
 *
 *   ══ 왜 «봉인»보다 «측정»이 먼저인가 ══
 *     봉인은 Windows 에서 값이 거의 없고(DPAPI 가 이미 한다) **리눅스 키링 없는 기기에서 거의 전부**다.
 *     그런데 우리는 **라이브 러너 16대 중 몇 대가 리눅스인지 모른다** — `runner_devices` 에 OS 칸이 없다.
 *     비용을 어디에 쓸지 모르는 채로 봉인부터 만드는 건 순서가 틀렸다.
 *
 *   ══ 🔴 이 파일에서 제일 틀리기 쉬운 것 ══
 *     크로미움 쿠키 값의 접두사 `v10` 은 **플랫폼마다 뜻이 다르다**:
 *       · Windows `v10` = AES-256-GCM 키를 **DPAPI** 가 기기+사용자에 묶었다 → **안전**
 *       · macOS  `v10` = **Keychain** 파생 키 → 안전(단, 우리가 맥에서 재 본 적은 없다)
 *       · Linux  `v10` = **하드코딩 키**(공개된 값) → 사실상 평문 · `v11` = 키링 파생 → 안전
 *     ⇒ 접두사만 보고 판정하면 **멀쩡한 Windows 16대를 «평문»이라고 보고**한다.
 *        그게 거짓 false 이고, 거짓 true 보다 나쁘다 — 멀쩡한 것을 고치게 만든다(AC-67).
 *        그래서 판정을 **순수 함수**로 뽑아(`classifyProfileSeal`) 하니스로 양쪽을 다 잰다(AC-68).
 *
 *   🔴 못 읽으면 **`unknown`** 이다 — «안전»도 «위험»도 아니다(AC-9). 못 쟀다고 안전으로 세지 않는다.
 *   🔴 이 파일은 **아무것도 바꾸지 않는다**(읽기만). 봉인 자체는 사장님 승인 뒤.
 */
import fs from "node:fs";
import path from "node:path";

/** 프로필 안에서 쿠키가 있을 수 있는 자리(크로미움 96 이후 `Network/` 로 옮겼다 — 둘 다 본다). */
const COOKIE_PATHS = [
  ["Default", "Network", "Cookies"],
  ["Default", "Cookies"],
  ["Network", "Cookies"],
  ["Cookies"],
];

/** 파일에서 `v10`·`v11` 바이트열의 개수를 센다(SQLite 를 파싱하지 않는다 — 의존성 0). */
export function countPrefixes(buf) {
  let v10 = 0; let v11 = 0;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] !== 0x76 /* v */ || buf[i + 1] !== 0x31 /* 1 */) continue;
    if (buf[i + 2] === 0x30) v10++;
    else if (buf[i + 2] === 0x31) v11++;
  }
  return { v10, v11 };
}

/**
 * 🔴 **판정 — 이 파일의 심장.** 순수 함수라 하니스로 잴 수 있다.
 * @param {{platform:string, v10:number, v11:number, read:boolean}} x
 * @returns {{ state:"os"|"keyring"|"weak"|"none"|"unknown", why:string, copySafe:boolean|null }}
 *   · `copySafe` = «폴더를 복사해 가면 못 여나». 🔴 **`null` 은 «모른다»** 이고 false 가 아니다.
 */
export function classifyProfileSeal({ platform, v10 = 0, v11 = 0, read = true, exists = true }) {
  /* 🔴 **«파일이 없다»와 «못 읽었다»는 다른 말이다**(2026-09-15 실측으로 잡았다 — 이 PC 프로필 27개 중 16개가
     드라이런 찌꺼기라 쿠키 파일 자체가 없는데, 처음엔 그 16개가 전부 «못 쟀다»로 올라와 기기 판정이 통째로 unknown 이 됐다).
       · 파일 없음  = **아직 로그인한 적이 없다**(정상 · 알 것이 없는 상태)
       · 읽기 실패  = **못 쟀다**(브라우저가 쓰는 중이거나 권한이 없다 · 나중에 다시 재야 한다)
     둘을 한 칸으로 뭉치면 운영 화면이 «전 기기 확인 불가»로 보이고, **진짜 못 잰 기기가 그 안에 숨는다**(AC-9 의 한 층 아래). */
  if (!exists) return { state: "none", why: "아직 이 프로필로 로그인한 적이 없어요", copySafe: null };
  if (!read) return { state: "unknown", why: "쿠키 파일을 읽지 못했어요(브라우저가 쓰는 중이거나 권한이 없어요)", copySafe: null };
  if (!v10 && !v11) return { state: "none", why: "잠긴 쿠키가 하나도 없어요 — 아직 이 프로필로 로그인한 적이 없는 것 같아요", copySafe: null };

  if (platform === "win32") {
    /* Windows 는 v10 뿐이고 그 키를 DPAPI 가 기기+사용자에 묶는다. v11 은 이 플랫폼에 없다. */
    return { state: "os", why: "윈도우가 이 PC·이 사용자에게 묶어서 잠갔어요(DPAPI)", copySafe: true };
  }
  if (platform === "darwin") {
    return { state: "os", why: "맥 키체인이 잠갔어요 — 🔴 우리가 맥에서 실제로 재 본 적은 없어요(추정)", copySafe: true };
  }
  if (platform === "linux") {
    if (v11) return { state: "keyring", why: "리눅스 키링(gnome-keyring·kwallet)이 잠갔어요", copySafe: true };
    /* 🔴 여기가 진짜 구멍이다 — 리눅스의 v10 은 **공개된 하드코딩 키**다. */
    return {
      state: "weak",
      why: "키링이 없어서 브라우저가 **공개된 고정 키**로 잠갔어요 — 폴더를 복사해 가면 그대로 열립니다",
      copySafe: false,
    };
  }
  return { state: "unknown", why: `이 운영체제(${platform})에서는 어떻게 잠기는지 확인하지 못했어요`, copySafe: null };
}

/**
 * 프로필 한 개를 잰다. 🔴 **읽기만 한다** · 실패는 전부 `unknown` 으로 흡수한다(측정이 발행을 막지 않는다).
 * @param {string} dir 프로필 폴더
 */
export function probeProfile(dir, platform = process.platform) {
  for (const parts of COOKIE_PATHS) {
    const f = path.join(dir, ...parts);
    let buf;
    try { if (!fs.existsSync(f)) continue; buf = fs.readFileSync(f); }
    catch { return { ...classifyProfileSeal({ platform, read: false }), file: f, v10: 0, v11: 0 }; }
    const { v10, v11 } = countPrefixes(buf);
    return { ...classifyProfileSeal({ platform, v10, v11 }), file: f, v10, v11 };
  }
  /* 쿠키 파일이 **한 자리에도 없다** = 이 프로필로 로그인한 적이 없다(«못 쟀다»가 아니다 · 위 주석). */
  return { ...classifyProfileSeal({ platform, exists: false }), file: "", v10: 0, v11: 0 };
}

/**
 * 이 PC 전체 — 프로필 폴더를 훑어 **제일 나쁜 판정**을 대표값으로 올린다.
 *   🔴 «하나라도 약하면 약하다»가 맞다. 평균을 내면 구멍이 숨는다.
 * @returns {{ platform:string, profiles:number, state:string, copySafe:boolean|null, why:string, weak:number, unknown:number }}
 */
export function probeFleet(profilesDir, platform = process.platform) {
  let dirs = [];
  try { dirs = fs.readdirSync(profilesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(profilesDir, d.name)); }
  catch { dirs = []; }

  if (!dirs.length) {
    return { platform, profiles: 0, sealed: 0, weak: 0, unknown: 0, state: "none", copySafe: null, why: "아직 로그인한 계정이 없어요" };
  }
  /* 🔴 **순위를 두 번 고쳤다 — 실측이 둘 다 잡았다**(2026-09-15 · 이 PC 프로필 27개).
       ①처음엔 `none`(로그인 없음)을 «나쁜 쪽»으로 둬서, **로그인 5개가 멀쩡히 잠긴 PC 를
         «아직 로그인한 적이 없어요»로 보고**했다 — 있는 것을 없다고 말하는 꼴이다.
       ②`none` 은 «지킬 것이 없다»이지 «못 지킨다»가 아니다 ⇒ **제일 덜 알릴 것**으로 내렸다.
     남은 순서는 그대로 «나쁜 것이 이긴다»다 — `weak` 이 하나라도 있으면 그게 이 PC 의 상태다(평균을 내면 구멍이 숨는다). */
  const RANK = { weak: 0, unknown: 1, keyring: 2, os: 2, none: 3 };
  let worst = null; let weak = 0; let unknown = 0; let sealed = 0;
  for (const d of dirs) {
    const r = probeProfile(d, platform);
    if (r.state === "weak") weak++;
    else if (r.state === "unknown") unknown++;
    else if (r.state === "os" || r.state === "keyring") sealed++;
    if (!worst || RANK[r.state] < RANK[worst.state]) worst = r;
  }
  /* `profiles` 는 폴더 수이고 `sealed` 는 **실제로 로그인이 든 폴더 수**다 — 화면은 뒤엣것을 말해야 한다
     (드라이런 찌꺼기 폴더가 22개인데 «계정 27개»라고 하면 그것도 거짓말이다). */
  return { platform, profiles: dirs.length, sealed, weak, unknown, state: worst.state, copySafe: worst.copySafe, why: worst.why };
}

/** 콘솔 한 줄 — 고객이 보는 말(«위험»을 회색 글씨로 흘리지 않는다 · CLAUDE §9-1). */
export function sealLine(r) {
  if (r.state === "weak") {
    return `  ⚠ 로그인 정보 보관: 이 PC 는 브라우저가 **공개된 고정 키**로 잠급니다 — 러너 폴더를 복사해 가면 로그인이 열립니다.\n` +
           `     공유 PC·동기화 폴더(원드라이브·드롭박스)에 두지 마세요. (계정 ${r.weak}개)`;
  }
  /* 🔴 «계정 N개»는 **로그인이 든 폴더 수**여야 한다 — 폴더 수(찌꺼기 포함)를 말하면 그것도 틀린 숫자다. */
  if (r.state === "os" || r.state === "keyring") return `  · 로그인 정보 보관: ${r.why} (로그인 ${r.sealed ?? 0}개)`;
  return `  · 로그인 정보 보관: ${r.why}`;
}
