// scripts/verify-profile-seal-roundtrip.mjs — 🔴 **봉인을 진짜 파일로 왕복**시킨다(P1R8 §3.1 · 설계 §4).
//   사용: node scripts/verify-profile-seal-roundtrip.mjs
//
//   ══ 이 하니스가 답해야 하는 질문은 **하나**다 ══
//     «**폴더를 복사해 가면 안 열리나.**» 그게 이 기능이 파는 전부이고, 나머지는 그걸 안 깨뜨리기 위한 것이다.
//
//   ══ 그리고 반대쪽을 같은 수만큼 잰다(AC-68) ══
//     조이는 쪽만 보면 «전부 거절»이 정답처럼 보인다. 그런데 여기서 «전부 거절»은 **고객이 로그인을 잃는 것**이고,
//     재로그인 반복은 캡차를 부른다(AC-19). 그래서 «**열려야 하는 것이 열리나**»를 같은 무게로 잰다.
//
//   🔴 임시 폴더에서만 돈다 — 진짜 `runner/profiles` 는 건드리지 않는다.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealProfile, unsealProfile, unsealBlob, sealedPathFor } from "../runner/lib/profile-seal.mjs";

let pass = 0; let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); }
};

const KEY = crypto.randomBytes(32).toString("hex");
const OTHER = crypto.randomBytes(32).toString("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac-seal-rt-"));
const w = (dir, rel, text) => { const p = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"); } catch { return null; } };

/** 진짜 크로미움 프로필과 **같은 모양**으로 만든다(세션 파일 + 담으면 안 되는 캐시). */
function makeProfile(name) {
  const dir = path.join(root, name);
  w(dir, "Default/Network/Cookies", "COOKIE-DB-v10-secret");
  w(dir, "Default/Local Storage/leveldb/000003.log", "LOCALSTORAGE-login-state");
  w(dir, "Default/Preferences", '{"profile":{"name":"x"}}');
  w(dir, "Default/Cache/data_0", "X".repeat(50_000));     // 🔴 담으면 안 되는 것(크고 값이 없다)
  w(dir, "Default/History", "browsing history");           // 세션이 아니다 — 담지 않는다
  return dir;
}

console.log("① 🔴 왕복 — 봉하고 풀면 로그인이 **그대로** 돌아온다");
{
  const dir = makeProfile("p1");
  const s = sealProfile(dir, KEY);
  ok("봉인이 선다", s.ok, s.ok ? "" : s.why);
  ok("봉인본이 폴더 **옆**에 생긴다(안에 두면 자기가 자기를 담는다)", fs.existsSync(sealedPathFor(dir)));
  /* 🔴 여기가 핵심 — 봉한 뒤 평문이 남아 있으면 봉인이 아니다. */
  ok("🔴 쿠키 평문이 사라진다", read(dir, "Default/Network/Cookies") === null);
  ok("🔴 localStorage 평문이 사라진다", read(dir, "Default/Local Storage/leveldb/000003.log") === null);
  ok("캐시는 **건드리지 않는다**(크고 값이 없다 · 잡마다 암호화하면 발행이 느려진다)", read(dir, "Default/Cache/data_0")?.length === 50_000);
  ok("히스토리도 안 건드린다(세션이 아니다)", read(dir, "Default/History") === "browsing history");

  const u = unsealProfile(dir, KEY);
  ok("풀린다", u.ok, u.ok ? "" : u.why);
  ok("🔴 쿠키가 **글자까지 그대로** 돌아온다", read(dir, "Default/Network/Cookies") === "COOKIE-DB-v10-secret");
  ok("localStorage 도 그대로", read(dir, "Default/Local Storage/leveldb/000003.log") === "LOCALSTORAGE-login-state");
  ok("Preferences 도 그대로", read(dir, "Default/Preferences") === '{"profile":{"name":"x"}}');
}

console.log("② 🔴 **이 기능이 파는 것** — 복사해 가면 안 열린다");
{
  const dir = makeProfile("p2");
  sealProfile(dir, KEY);
  const stolen = fs.readFileSync(sealedPathFor(dir));
  /* 훔쳐 간 사람은 봉인본은 있지만 **서버가 쥔 열쇠가 없다**. */
  const bad = unsealBlob(stolen, Buffer.from(OTHER, "hex"));
  ok("🔴 남의 열쇠로는 안 열린다", !bad.ok, bad.ok ? "열렸다 — 이 기능이 아무것도 안 판다" : "");
  const good = unsealBlob(stolen, Buffer.from(KEY, "hex"));
  ok("우리 열쇠로는 열린다(통과해야 하는 쪽)", good.ok, good.ok ? "" : good.why);
  /* 🔴 봉인본 안에 평문이 그대로 보이면 암호화가 모양뿐인 것이다 — 바이트를 직접 뒤진다. */
  ok("🔴 봉인본 바이트에 비밀이 안 보인다", !stolen.includes(Buffer.from("COOKIE-DB-v10-secret")) && !stolen.includes(Buffer.from("LOCALSTORAGE-login-state")));
  /* 한 바이트만 건드려도 열리면 안 된다(GCM 인증 태그가 일하는지). */
  const tampered = Buffer.from(stolen); tampered[tampered.length - 5] ^= 0xff;
  ok("🔴 한 바이트만 바꿔도 거절한다(위조 탐지)", !unsealBlob(tampered, Buffer.from(KEY, "hex")).ok);
}

console.log("③ 🔴 fail-open — 안전장치가 고객 공장을 세우지 않는다");
{
  const dir = makeProfile("p3");
  sealProfile(dir, KEY);
  /* 열쇠가 바뀌었다(서버가 폐기했거나 사고). 🔴 **평문이 그대로 남아야** 한다 — 지워 버리면 로그인을 잃는다. */
  const u = unsealProfile(dir, OTHER);
  ok("🔴 남의 열쇠로 풀기 실패 — 그래도 **던지지 않고** 사유를 돌려준다", !u.ok && !!u.why);
  ok("🔴 실패했다고 봉인본을 지우지 않는다(맞는 열쇠가 오면 살아난다)", fs.existsSync(sealedPathFor(dir)));

  const fresh = makeProfile("p4");
  const noKey = unsealProfile(fresh, KEY);
  ok("봉인본이 없으면 «할 일 없음»이고 **실패가 아니다**(처음 켠 프로필)", noKey.ok && noKey.skipped === true);
  ok("그때 평문은 그대로다", read(fresh, "Default/Network/Cookies") === "COOKIE-DB-v10-secret");

  /* 열쇠 모양이 아니면 봉하지 않는다 — 🔴 그런데 **평문을 지우지도 않는다**(제일 나쁜 결과를 피한다). */
  const p5 = makeProfile("p5");
  const s5 = sealProfile(p5, "not-a-key");
  ok("열쇠가 모양이 아니면 봉인을 안 한다", !s5.ok);
  ok("🔴 그래도 평문을 **안 지운다**(안 지우는 것이 정답이다)", read(p5, "Default/Network/Cookies") === "COOKIE-DB-v10-secret");

  /* 로그인한 적 없는 빈 프로필 — 봉할 게 없다. 실패로 세되 **아무것도 지우지 않는다**. */
  const p6 = path.join(root, "p6"); fs.mkdirSync(p6, { recursive: true });
  const s6 = sealProfile(p6, KEY);
  ok("봉할 세션 파일이 없으면 봉인본을 만들지 않는다", !s6.ok && !fs.existsSync(sealedPathFor(p6)));
}

console.log("④ 두 번 봉해도 망가지지 않는다(잡이 여러 번 돈다)");
{
  const dir = makeProfile("p7");
  sealProfile(dir, KEY);
  unsealProfile(dir, KEY);
  w(dir, "Default/Network/Cookies", "COOKIE-DB-v10-secret-UPDATED");   // 잡이 새 쿠키를 남겼다
  const s2 = sealProfile(dir, KEY);
  ok("두 번째 봉인도 선다", s2.ok, s2.ok ? "" : s2.why);
  unsealProfile(dir, KEY);
  ok("🔴 **마지막 값**이 돌아온다(옛 봉인본이 새 쿠키를 덮지 않는다)", read(dir, "Default/Network/Cookies") === "COOKIE-DB-v10-secret-UPDATED");
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
