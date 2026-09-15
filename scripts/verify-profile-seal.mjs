// scripts/verify-profile-seal.mjs — 프로필 봉인 «판정»을 실제로 돌려 본다(P1R8 §3.1 · 0단계).
//   사용: node scripts/verify-profile-seal.mjs
//
//   🔴 이 판정이 조용히 틀리면 어느 쪽으로든 나쁘다:
//     · 거짓 «위험» → 멀쩡한 윈도우 16대를 «평문»이라고 보고한다 → 없는 문제를 고치러 간다(AC-67 «거짓 false 가 더 나쁘다»)
//     · 거짓 «안전» → 진짜 구멍(리눅스 키링 없음)을 초록으로 덮는다
//   그래서 **떨어져야 하는 것과 통과해야 하는 것을 같은 수만큼** 잰다(AC-68).
//   라이브로는 영영 못 본다 — 리눅스 러너가 아직 0대이기 때문이다. 순수 함수 하니스로만 보인다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyProfileSeal, countPrefixes, probeFleet } from "../runner/lib/profile-seal.mjs";

let pass = 0; let fail = 0;
const t = (name, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      받은 값: ${g}\n      기대값: ${w}`); }
};
const st = (x) => ({ state: x.state, copySafe: x.copySafe });

console.log("① 🔴 같은 v10 이 플랫폼마다 다른 뜻이다 — 여기가 이 파일의 전부");
t("윈도우 v10 = DPAPI → 안전(통과해야 한다)", st(classifyProfileSeal({ platform: "win32", v10: 42, v11: 0 })), { state: "os", copySafe: true });
t("맥 v10 = 키체인 → 안전(통과해야 한다)", st(classifyProfileSeal({ platform: "darwin", v10: 42, v11: 0 })), { state: "os", copySafe: true });
t("🔴 리눅스 v10 = 하드코딩 키 → 위험(떨어져야 한다)", st(classifyProfileSeal({ platform: "linux", v10: 42, v11: 0 })), { state: "weak", copySafe: false });
t("리눅스 v11 = 키링 → 안전(통과해야 한다)", st(classifyProfileSeal({ platform: "linux", v10: 0, v11: 42 })), { state: "keyring", copySafe: true });
t("리눅스 v10+v11 섞임 → 키링 쪽으로(옛 쿠키가 v10 으로 남아 있을 수 있다)", st(classifyProfileSeal({ platform: "linux", v10: 3, v11: 40 })), { state: "keyring", copySafe: true });

console.log("② 🔴 모르는 것을 «안전»으로도 «위험»으로도 접지 않는다(AC-9 · copySafe 는 3값)");
t("파일을 못 읽음 → unknown · copySafe null", st(classifyProfileSeal({ platform: "win32", read: false })), { state: "unknown", copySafe: null });
t("잠긴 쿠키가 0개 → none · copySafe null(«로그인한 적 없음»이지 «안전»이 아니다)", st(classifyProfileSeal({ platform: "linux", v10: 0, v11: 0 })), { state: "none", copySafe: null });
t("모르는 OS → unknown · copySafe null", st(classifyProfileSeal({ platform: "freebsd", v10: 42 })), { state: "unknown", copySafe: null });

console.log("②b 🔴 실측이 잡은 것 — «파일이 없다»와 «못 읽었다»는 다른 말이다");
/* 2026-09-15: 이 PC 프로필 27개 중 22개가 드라이런 찌꺼기(쿠키 파일 자체가 없음)인데,
   처음엔 그게 전부 «못 쟀다»로 올라와 기기 판정이 통째로 unknown 이 됐다.
   그러면 운영 화면이 «전 기기 확인 불가»로 보이고 **진짜 못 잰 기기가 그 안에 숨는다.** */
t("쿠키 파일 없음 → none(«로그인한 적 없다»)", st(classifyProfileSeal({ platform: "win32", exists: false })), { state: "none", copySafe: null });
t("파일은 있는데 못 읽음 → unknown(«못 쟀다»)", st(classifyProfileSeal({ platform: "win32", exists: true, read: false })), { state: "unknown", copySafe: null });

console.log("②c 🔴 실측이 잡은 것 둘 — 기기 대표값의 순위");
/* 처음엔 `none` 을 «나쁜 쪽»에 둬서, **로그인 5개가 멀쩡히 잠긴 이 PC 를 «아직 로그인한 적이 없어요»로 보고**했다.
   있는 것을 없다고 말하는 꼴이다. 아래는 그 순위를 임시 폴더로 **진짜 만들어** 확인한다. */
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac-seal-"));
  const mk = (name, bytes) => {
    const d = path.join(root, name, "Default"); fs.mkdirSync(d, { recursive: true });
    if (bytes !== null) fs.writeFileSync(path.join(d, "Cookies"), bytes);
  };
  mk("logged-in", Buffer.from("v10v10v10"));           // 잠긴 로그인 하나
  mk("empty-1", null); mk("empty-2", null); mk("empty-3", null);   // 찌꺼기 셋
  const w = probeFleet(root, "win32");
  t("로그인 1 + 찌꺼기 3 → 대표값은 os(«없다»가 이기면 안 된다)", { state: w.state, sealed: w.sealed, profiles: w.profiles }, { state: "os", sealed: 1, profiles: 4 });
  const l = probeFleet(root, "linux");
  t("같은 폴더를 리눅스로 보면 weak 이 이긴다(나쁜 것이 이긴다)", { state: l.state, weak: l.weak }, { state: "weak", weak: 1 });
  const e = probeFleet(path.join(root, "nope"), "win32");
  t("폴더가 없으면 none · 0개", { state: e.state, profiles: e.profiles }, { state: "none", profiles: 0 });
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("③ 접두사 세기 — 바이트열을 진짜로 센다");
t("v10 셋 · v11 둘", countPrefixes(Buffer.from("xxv10yyv11zzv10--v10--v11")), { v10: 3, v11: 2 });
t("없으면 0", countPrefixes(Buffer.from("cookies table, no blobs")), { v10: 0, v11: 0 });
t("«v1» 로 끝나면 안 센다(경계 밖을 읽지 않는다)", countPrefixes(Buffer.from("aaav1")), { v10: 0, v11: 0 });
t("«v12» 같은 모르는 판은 안 센다", countPrefixes(Buffer.from("v12v13v10")), { v10: 1, v11: 0 });

console.log("④ 🔴 음성 대조 — 판정이 «아무거나 안전»이라고 하지 않는다");
const risky = ["linux"].map((p) => classifyProfileSeal({ platform: p, v10: 1, v11: 0 }).copySafe);
t("리눅스 v10 은 반드시 false 다(여기가 true 면 구멍이 초록으로 덮인다)", risky, [false]);
const safe = ["win32", "darwin"].map((p) => classifyProfileSeal({ platform: p, v10: 1, v11: 0 }).copySafe);
t("윈도우·맥은 반드시 true 다(여기가 false 면 멀쩡한 16대를 고치러 간다)", safe, [true, true]);

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
