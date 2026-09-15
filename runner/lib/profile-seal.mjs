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

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * [P1R8 §3.1 · 설계 §4] 🔴 **봉인** — 서버가 잡마다 내려 주는 열쇠로 프로필의 «세션 부분»만 잠근다
 *   메인 승인 2026-09-15(설계 §8 네 가지).
 *
 *   ══ 무엇을 파는가 ══
 *     **«폴더를 복사해 가면 안 열린다.»** 그뿐이다 — 그 PC 에서 그 사용자로 코드를 돌릴 수 있는 사람은 원리상 못 막는다.
 *     그래도 진짜 값이 있고, **DPAPI 로는 못 하는 것이 하나 더** 있다: 🔴 **폐기**(서버가 열쇠를 지우면 훔쳐 간 봉인본은 영영 안 열린다).
 *
 *   ══ 🔴 fail-open — 프록시와 정반대다 ══
 *     프록시는 fail-closed 였다(잘못 나가면 연좌제). 여기는 **반대**다:
 *     봉인이 깨졌다고 잡을 멈추면 **고객이 로그인을 잃고, 재로그인 반복이 캡차를 부른다**(AC-19 · 우리가 이미 한 번 그랬다).
 *     ⇒ 풀기 실패 = 있던 평문 그대로 쓴다 · 봉하기 실패 = **평문을 안 지운다**. 대신 **조용히 넘어가지 않는다**(사유를 보고에 싣는다).
 *     메인 말: «우리 안전장치가 고객 공장을 세우면 그건 안전이 아니라 고장이다.»
 *
 *   ══ 무엇을 담는가 — **전부가 아니다** ══
 *     크로미움 프로필은 캐시 때문에 수백 MB 다. 잡마다 그걸 암·복호화하면 발행이 느려지고 디스크가 닳는다.
 *     세션을 지닌 것만 담는다(아래 `SESSION_PATHS`). 🔴 `Cache`·`Code Cache`·`GPUCache` 는 **안 담는다**(크고 값이 없다).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import crypto from "node:crypto";
import { zipRead, zipWrite } from "./zip.mjs";

/** 봉인 파일 이름 — 프로필 폴더 **옆**에 둔다(안에 두면 자기가 자기를 담는다). */
export const sealedPathFor = (dir) => `${dir}.sealed`;

/**
 * 담을 것 — «세션을 지닌 것»만. 폴더면 통째로, 파일이면 그 파일만.
 *   🔴 크로미움 96 이후 쿠키가 `Network/` 로 옮겨 갔다 — **둘 다** 본다(한쪽만 담으면 판에 따라 조용히 로그인을 잃는다).
 */
const SESSION_PATHS = [
  "Default/Network/Cookies", "Default/Network/Cookies-journal",
  "Default/Cookies", "Default/Cookies-journal",
  "Default/Local Storage", "Default/IndexedDB", "Default/Login Data", "Default/Preferences",
];

const MAGIC = "ACSEAL1";
const keyBuf = (hex) => (/^[0-9a-f]{64}$/i.test(String(hex ?? "")) ? Buffer.from(String(hex), "hex") : null);

/** 폴더·파일을 zip 항목으로 모은다(없는 것은 그냥 건너뛴다 — 프로필마다 있는 파일이 다르다). */
function collectSession(dir) {
  const out = [];
  const walk = (abs, rel) => {
    let st; try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      let names = []; try { names = fs.readdirSync(abs); } catch { return; }
      for (const nm of names) walk(path.join(abs, nm), `${rel}/${nm}`);
    } else if (st.isFile()) {
      try { out.push({ name: rel, data: fs.readFileSync(abs), mode: 0o600 }); } catch { /* 잠긴 파일은 건너뛴다 */ }
    }
  };
  for (const rel of SESSION_PATHS) walk(path.join(dir, ...rel.split("/")), rel);
  return out;
}

const rmQuiet = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* 못 지워도 진행 */ } };

/**
 * 🔴 **봉하기** — 세션 파일들을 한 덩이로 묶어 AES-256-GCM 으로 잠그고, **평문 원본을 지운다**.
 *   실패하면 **평문을 안 지운다**(fail-open). 반환 `{ ok, why }` — `why` 는 보고에 실린다.
 */
export function sealProfile(dir, keyHex) {
  const key = keyBuf(keyHex);
  if (!key) return { ok: false, why: "봉인 열쇠가 없거나 모양이 아니에요" };
  try {
    const files = collectSession(dir);
    if (!files.length) return { ok: false, why: "봉할 세션 파일이 없어요(아직 로그인한 적이 없는 프로필)" };
    const packed = zipWrite(files.map((f) => ({ ...f, mtime: new Date("2020-01-01T00:00:00Z") })));
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(packed), c.final()]);
    const blob = Buffer.concat([Buffer.from(MAGIC, "utf8"), iv, c.getAuthTag(), enc]);

    /* 🔴 **먼저 쓰고, 되읽어 확인하고, 그다음에 지운다.** 순서가 바뀌면 봉인이 깨진 날 로그인이 통째로 사라진다.
       임시 파일에 쓰고 제자리 교체 — 쓰다가 죽어도 옛 봉인본이 남는다(자동 업데이트와 같은 규율). */
    const sealed = sealedPathFor(dir);
    const tmp = `${sealed}.tmp`;
    fs.writeFileSync(tmp, blob);
    const check = unsealBlob(fs.readFileSync(tmp), key);
    if (!check.ok) { rmQuiet(tmp); return { ok: false, why: `봉했는데 되읽기가 안 돼요(${check.why}) — 평문을 그대로 둡니다` }; }
    fs.renameSync(tmp, sealed);

    for (const rel of SESSION_PATHS) rmQuiet(path.join(dir, ...rel.split("/")));
    return { ok: true, why: "", files: files.length, bytes: blob.length };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e).slice(0, 120) };
  }
}

/** 봉인 덩이 → zip 항목들(순수 · 하니스가 직접 부른다). */
export function unsealBlob(blob, key) {
  try {
    if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + 28) return { ok: false, why: "봉인 파일이 너무 짧아요" };
    if (blob.subarray(0, MAGIC.length).toString("utf8") !== MAGIC) return { ok: false, why: "우리 봉인 파일이 아니에요" };
    const iv = blob.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = blob.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    const packed = Buffer.concat([d.update(blob.subarray(MAGIC.length + 28)), d.final()]);
    return { ok: true, why: "", files: zipRead(packed) };
  } catch (e) {
    /* 🔴 열쇠가 다르면 여기로 온다 — **그게 이 기능이 파는 것**이다(복사해 가면 안 열린다). */
    return { ok: false, why: `열쇠가 맞지 않거나 파일이 손상됐어요(${String(e?.message ?? e).slice(0, 60)})` };
  }
}

/**
 * 🔴 **풀기** — 봉인본이 있으면 프로필 폴더에 되돌려 놓는다.
 *   봉인본이 없으면 «할 일 없음»이고 **실패가 아니다**(처음 켠 프로필 · 아직 안 켠 기능).
 *   못 풀면 **있던 평문 그대로** 쓴다(fail-open) — 그리고 그 사실을 말한다.
 */
export function unsealProfile(dir, keyHex) {
  const sealed = sealedPathFor(dir);
  if (!fs.existsSync(sealed)) return { ok: true, why: "", skipped: true };
  const key = keyBuf(keyHex);
  if (!key) return { ok: false, why: "봉인본은 있는데 열쇠가 없어요 — 저장된 로그인을 못 씁니다" };
  const got = unsealBlob(fs.readFileSync(sealed), key);
  if (!got.ok) return { ok: false, why: got.why };
  try {
    for (const f of got.files) {
      const abs = path.join(dir, ...String(f.name).split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.data);
    }
    return { ok: true, why: "", files: got.files.length };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e).slice(0, 120) };
  }
}
