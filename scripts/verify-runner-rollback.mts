/**
 * scripts/verify-runner-rollback.mts — 러너 배포 **되돌리기 리허설**(P1R8 §3.5 · 메인 지시 2026-09-15).
 *   사용: npx --yes tsx scripts/verify-runner-rollback.mts
 *
 *   🔴 **R2 를 건드리지 않는다.** 가짜 zip 을 메모리에서 만들어 판정만 돌린다.
 *      대외 저장소를 만지는 연습은 라운드 끝 그 창에서 사장님 Allow 를 받고 한다(AC-50).
 *
 *   ══ 왜 «배포 직전»이 아니라 지금 만드나(메인) ══
 *      되돌리기는 **급할 때 쓰는 물건**이다. 배포 직전에 만들면 **한 번도 안 돌려 본 코드를
 *      사고 난 뒤에 처음 돌리게 된다.** 오늘 그걸 두 번 증명했다 — `run.bat` 도 `publicKeyPem()` 도
 *      **돌려 보고서야** 나왔다.
 *
 *   ══ 이 하니스가 지키는 두 문장 ══
 *      ① `stop` 은 «더 안 퍼지게»지 «되돌리기»가 아니다 — **그 경고가 실제로 나오는지** 본다.
 *         그 한 줄이 빠지면 운영자가 «되돌렸다»고 믿고 손을 놓는다.
 *      ② `reissue` 는 zip 안 `package.json` 판을 **반드시** 새 번호로 바꿔야 한다 —
 *         안 바꾸면 러너가 제 판을 옛 번호로 보고하고 서버가 계속 새 판을 권해 **영원히 내려받기만 반복한다.**
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { planReissue, planStop, cmpVer, sha256 } from "./runner-release-control.mts";
import type { RunnerRelease } from "../lib/runner-release";

const RUNNER = path.join(path.resolve(import.meta.dirname, ".."), "runner");
const { zipRead, zipWrite } = await import(pathToFileURL(path.join(RUNNER, "lib/zip.mjs")).href) as {
  zipRead: (b: Buffer) => { name: string; data: Buffer; mode: number }[];
  zipWrite: (e: { name: string; data: Buffer; mode?: number; mtime?: Date }[]) => Buffer;
};

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); }
};

/** 진짜 러너 zip 과 **같은 모양**의 가짜(한 폴더로 감싸고, 있어야 할 세 파일을 넣는다). */
function fakeZip(version: string, extra: Record<string, string> = {}): Buffer {
  const P = "autocreate-runner";
  const files = [
    { name: `${P}/package.json`, data: Buffer.from(`${JSON.stringify({ name: "ac-runner", version, type: "module" }, null, 2)}\n`, "utf8"), mode: 0o644 },
    { name: `${P}/ac-runner.mjs`, data: Buffer.from(`// v${version}\n`, "utf8"), mode: 0o644 },
    { name: `${P}/core.mjs`, data: Buffer.from(`// v${version}\n`, "utf8"), mode: 0o644 },
    ...Object.entries(extra).map(([n, t]) => ({ name: `${P}/${n}`, data: Buffer.from(t, "utf8"), mode: 0o644 })),
  ];
  return zipWrite(files.map((f) => ({ ...f, mtime: new Date("2020-01-01T00:00:00Z") })));
}
const verInZip = (b: Buffer): string => {
  const f = zipRead(b).find((x) => /(^|\/)package\.json$/.test(x.name));
  return f ? String((JSON.parse(f.data.toString("utf8")) as { version?: string }).version ?? "") : "";
};

const Z118 = fakeZip("1.1.8", { "run.bat": "@echo off\r\n" });
const Z120 = fakeZip("1.2.0");
const cur: RunnerRelease = { version: "1.2.0", sha256: sha256(Z120), bytes: Z120.length };

console.log("① 🔴 리허설 — 1.2.0 이 나쁘다는 걸 알았다. 「피 멈추기」로 1.1.8 을 가리킨다");
{
  const p = planStop({ current: cur, target: "1.1.8", targetZip: Z118 });
  ok("계획이 선다", p.ok);
  if (p.ok) {
    ok("latest.json 이 v1.1.8 을 가리킨다", p.latest.version === "1.1.8");
    ok("해시·크기를 **zip 에서 다시 재서** 넣는다", p.latest.sha256 === sha256(Z118) && p.latest.bytes === Z118.length);
    /* 🔴 이 하니스의 존재 이유 절반 — 경고가 **실제로** 나오는가. */
    ok("🔴 «이미 받은 기기는 그대로»를 반드시 말한다", !!p.warn && p.warn.includes("그대로"));
    ok("«되돌리기가 아니다»라고 못 박는다", !!p.warn && p.warn.includes("되돌리기»가 아니"));
    ok("zip 을 만들지도 지우지도 않는다(latest.json 만)", !p.zip);
  }
}

console.log("② 🔴 리허설 — 이미 퍼졌다. 「되감아 올리기」로 1.1.8 내용을 1.2.1 로 다시 낸다");
{
  const p = planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: Z118, asZipExists: false });
  ok("계획이 선다", p.ok, p.ok ? "" : p.why);
  if (p.ok && p.zip) {
    ok("새 zip 을 만든다", p.zip.key.endsWith("v1.2.1.zip"));
    /* 🔴 이 하니스의 존재 이유 나머지 절반 — 이걸 놓치면 영원한 내려받기 반복이다. */
    ok("🔴 zip 안 package.json 이 v1.2.1 로 바뀌었다", verInZip(p.zip.bytes) === "1.2.1", `안의 판: ${verInZip(p.zip.bytes)}`);
    ok("내용은 그대로다(run.bat 이 살아 있다)", zipRead(p.zip.bytes).some((f) => f.name.endsWith("run.bat")));
    ok("run.bat 의 CRLF 가 보존된다", zipRead(p.zip.bytes).find((f) => f.name.endsWith("run.bat"))!.data.includes(Buffer.from("\r\n")));
    ok("latest.json 의 해시가 **새 zip** 것이다", p.latest.sha256 === sha256(p.zip.bytes));
    ok("«전부 돌아온다»를 말한다", !!p.warn && p.warn.includes("올라옵니다"));
  }
}

console.log("③ 🔴 되감기는 **재현 가능**해야 한다(같은 입력 → 같은 해시)");
{
  const a = planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: Z118, asZipExists: false });
  const b = planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: Z118, asZipExists: false });
  ok("두 번 되감아도 같은 해시(시각을 고정값으로 묶는다)", a.ok && b.ok && a.latest.sha256 === b.latest.sha256);
}

console.log("④ 🔴 떨어져야 하는 것 — 통과하는 것과 같은 수만큼(AC-68)");
const why = (p: ReturnType<typeof planStop>) => (p.ok ? "" : p.why);
ok("없는 판을 가리키지 않는다(아무도 러너를 못 받게 된다)",
  !planStop({ current: cur, target: "1.1.7", targetZip: null }).ok);
ok("지금과 같은 판이면 할 일이 없다", !planStop({ current: cur, target: "1.2.0", targetZip: Z120 }).ok);
ok("🔴 «멈추기»로 더 높은 판을 가리키지 않는다(그건 배포다)",
  !planStop({ current: cur, target: "1.3.0", targetZip: fakeZip("1.3.0") }).ok);
ok("깨진 zip 은 가리키지 않는다", !planStop({ current: cur, target: "1.1.8", targetZip: Buffer.from("not a zip") }).ok);
ok("판 번호 모양이 아니면 거절", !planStop({ current: cur, target: "v1.1.8", targetZip: Z118 }).ok);
ok("🔴 이미 있는 번호로 되감지 않는다(같은 이름 다른 내용 금지)",
  !planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: Z118, asZipExists: true }).ok);
ok("🔴 지금 판보다 낮은 번호로 되감지 않는다(안 돌아온다)",
  !planReissue({ current: cur, from: "1.1.8", as: "1.1.9", fromZip: Z118, asZipExists: false }).ok);
ok("🔴 zip 이름과 안의 판이 다르면 멈춘다(어느 쪽이 진짜인지 모른다)",
  !planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: fakeZip("9.9.9"), asZipExists: false }).ok,
  why(planReissue({ current: cur, from: "1.1.8", as: "1.2.1", fromZip: fakeZip("9.9.9"), asZipExists: false })));

console.log("⑤ 판 비교 — 서버·러너와 같은 규칙이어야 한다");
ok("1.2.0 > 1.1.8", cmpVer("1.2.0", "1.1.8") > 0);
ok("1.1.10 > 1.1.9 (사전순이 아니다)", cmpVer("1.1.10", "1.1.9") > 0);
ok("같으면 0", cmpVer("1.2.0", "1.2.0") === 0);

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
