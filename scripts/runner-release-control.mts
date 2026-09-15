/**
 * scripts/runner-release-control.mts — 러너 배포를 **되돌리는** 두 가지 길(계약 P1R8 §3.5 · 메인 지시 2026-09-15).
 *
 *   node scripts/runner-release-control.mts stop    <version>            더 안 퍼지게 (기본 dry-run)
 *   node scripts/runner-release-control.mts reissue <from> <as>          옛 내용을 새 번호로 다시 내기
 *   ... --go 를 붙여야 실제로 R2 를 만진다.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 **이 파일에서 제일 중요한 것: «되돌리기»가 두 가지고, 둘은 하는 일이 완전히 다르다**
 *
 *   실측(2026-09-15 · 코드 확인): 서버(`runner-release.updateOfferFor`)도 러너(`update.isNewer`)도
 *   **판이 더 높을 때만** 받는다. 그리고 그건 **일부러 그렇게 둔 것**이다 —
 *   내려주기를 허용하면 두 판이 서로를 덮어쓰며 오간다(그 주석이 `runner-release.ts:72` 에 있다).
 *
 *   ⇒ 그래서 `latest.json` 을 옛 판으로 되돌려도 **이미 그 판을 받은 기기는 돌아오지 않는다.**
 *      그걸 «되돌렸다»고 부르면 **사고 한가운데서 거짓 안심**을 하게 된다. 이름을 갈랐다:
 *
 *   ┌─ `stop <version>` ── 「피 멈추기」
 *   │   latest.json 을 옛 판으로 돌린다.
 *   │   · **아직 안 받은 기기**는 이제 그 판을 받는다 · 새로 내려받는 고객도 그 판을 받는다
 *   │   · 🔴 **이미 새 판을 받은 기기는 그대로다** — 이걸로는 안 돌아온다
 *   │   · 언제 쓰나: 새 판이 나쁜 걸 알았고, **아직 많이 안 퍼졌을 때**(제일 흔한 경우)
 *   │
 *   └─ `reissue <from> <as>` ── 「되감아 올리기」
 *       옛 판의 **내용 그대로**를 **더 높은 새 번호**로 다시 낸다(예: 1.1.8 의 내용 → v1.2.1).
 *       · **전부 돌아온다**(앞으로만 가는 규칙을 어기지 않으면서 되돌리는 유일한 길)
 *       · 🔴 zip 안의 `package.json` version 을 **새 번호로 고쳐서** 다시 묶는다.
 *         안 고치면 러너가 제 판을 옛 번호로 보고하고 서버가 계속 새 판을 권해 **영원히 내려받기만 반복한다.**
 *         (이 함정이 이 파일을 만든 값의 절반이다 — 코드를 읽어서는 안 보인다.)
 *       · 언제 쓰나: 이미 퍼졌을 때.
 *
 *   🔴 **zip 은 절대 지우지 않는다.** 지우면 그 판을 받던 러너가 404 로 깨진다(그리고 복기도 못 한다).
 *      우리가 만지는 것은 `latest.json` **한 파일**뿐이고, reissue 는 **새 zip 을 더할** 뿐이다.
 *   🔴 **기본은 dry-run.** `--go` 없이는 아무것도 안 바뀐다(`publish-preflight.mts` 와 같은 관례).
 *   🔴 되돌릴 판이 **실제로 거기 있고 열리는지** 확인하고서야 바꾼다 — 받아서 풀어 보고 해시를 다시 잰다.
 *      «있다고 적혀 있다»는 «열린다»가 아니다.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { r2Configured, r2Get, r2Head, r2Put } from "../lib/r2";
import { releaseKey, type RunnerRelease } from "../lib/runner-release";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER = path.join(ROOT, "runner");
const LATEST_KEY = "autocreate/runner/latest.json";

const { zipRead, zipWrite } = await import(pathToFileURL(path.join(RUNNER, "lib/zip.mjs")).href) as {
  zipRead: (b: Buffer) => { name: string; data: Buffer; mode: number }[];
  zipWrite: (e: { name: string; data: Buffer; mode?: number; mtime?: Date }[]) => Buffer;
};

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const isSemver = (v: unknown) => /^\d+\.\d+\.\d+$/.test(String(v ?? ""));
export function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

export type Plan =
  | { ok: true; latest: RunnerRelease; warn?: string; zip?: { key: string; bytes: Buffer } }
  | { ok: false; why: string };

/* ─────────────────────────── 순수 판정(하니스가 이걸 그대로 돌린다) ─────────────────────────── */

/**
 * 「피 멈추기」 계획 — 🔴 **이미 받은 기기는 안 돌아온다**를 `warn` 으로 **반드시** 말한다.
 *   이 문장이 빠지면 운영자가 «되돌렸다»고 믿고 손을 놓는다. 그게 이 도구의 가장 큰 위험이다.
 */
export function planStop(a: { current: RunnerRelease | null; target: string; targetZip: Buffer | null }): Plan {
  if (!isSemver(a.target)) return { ok: false, why: `판 번호가 «1.2.3» 꼴이 아니에요: ${a.target}` };
  if (!a.targetZip) return { ok: false, why: `v${a.target} zip 이 저장소에 없어요 — 없는 판을 가리키면 아무도 러너를 못 받습니다.` };
  if (a.current && a.current.version === a.target) return { ok: false, why: `이미 v${a.target} 을 가리키고 있어요(바꿀 것이 없습니다).` };
  if (a.current && cmpVer(a.target, a.current.version) > 0) {
    return { ok: false, why: `v${a.target} 은 지금 판(v${a.current.version})보다 **높아요** — 이건 «멈추기»가 아니라 배포예요. 올릴 거면 build-runner 를 쓰세요.` };
  }
  const opened = openable(a.targetZip);
  if (!opened.ok) return { ok: false, why: `v${a.target} zip 이 열리지 않아요(${opened.why}) — 깨진 판을 가리킬 수는 없습니다.` };

  return {
    ok: true,
    latest: {
      version: a.target, sha256: sha256(a.targetZip), bytes: a.targetZip.length,
      releasedAt: new Date().toISOString(),
      notes: a.current ? `v${a.current.version} 에서 되돌림(피 멈추기)` : "되돌림(피 멈추기)",
    },
    /* 🔴 이 한 줄이 이 도구의 정직함이다. */
    warn: "이미 새 판을 받은 기기는 **그대로입니다** — 이건 «더 안 퍼지게»이지 «되돌리기»가 아니에요. 전부 되돌리려면 reissue 를 쓰세요.",
  };
}

/**
 * 「되감아 올리기」 계획 — 옛 내용을 **더 높은 새 번호**로 다시 낸다.
 *   🔴 zip 안 `package.json` 의 version 을 새 번호로 **고쳐서** 다시 묶는다(안 고치면 영원한 내려받기 반복).
 */
export function planReissue(a: { current: RunnerRelease | null; from: string; as: string; fromZip: Buffer | null; asZipExists: boolean }): Plan {
  if (!isSemver(a.from) || !isSemver(a.as)) return { ok: false, why: "판 번호가 «1.2.3» 꼴이 아니에요." };
  if (!a.fromZip) return { ok: false, why: `되감을 원본 v${a.from} zip 이 저장소에 없어요.` };
  if (a.asZipExists) return { ok: false, why: `v${a.as} 는 이미 있어요 — **같은 번호에 다른 내용**을 올리지 않습니다(사고 때 무엇이 돌았는지 못 찾습니다). 다음 번호를 쓰세요.` };
  if (a.current && cmpVer(a.as, a.current.version) <= 0) {
    return { ok: false, why: `v${a.as} 는 지금 판(v${a.current.version})보다 높아야 해요 — 낮으면 이미 받은 기기가 안 돌아옵니다(그게 reissue 를 쓰는 이유입니다).` };
  }
  if (cmpVer(a.as, a.from) <= 0) return { ok: false, why: `새 번호 v${a.as} 는 원본 v${a.from} 보다 높아야 해요.` };

  const opened = openable(a.fromZip);
  if (!opened.ok) return { ok: false, why: `v${a.from} zip 이 열리지 않아요(${opened.why}).` };

  const files = zipRead(a.fromZip);
  const pkg = files.find((f) => /(^|\/)package\.json$/.test(f.name));
  if (!pkg) return { ok: false, why: "zip 안에 package.json 이 없어요 — 판 번호를 고칠 수가 없습니다." };
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(pkg.data.toString("utf8")) as Record<string, unknown>; }
  catch { return { ok: false, why: "zip 안 package.json 을 읽지 못했어요." }; }
  if (String(obj.version ?? "") !== a.from) {
    /* 🔴 zip 안의 판과 파일 이름이 다르면 **어느 쪽이 진짜인지 모른다** — 그 상태로 다시 내지 않는다. */
    return { ok: false, why: `zip 이름은 v${a.from} 인데 안의 package.json 은 v${String(obj.version ?? "?")} 이에요 — 어느 쪽이 진짜인지 몰라 멈춥니다.` };
  }
  obj.version = a.as;

  /* 🔴 시각을 **고정값**으로 다시 묶는다 — build-runner 와 같은 규율(재현 가능한 빌드).
     «지금»을 박으면 같은 내용을 두 번 되감아도 해시가 달라져, 나중에 «이게 그 판이 맞나»를 못 따진다. */
  const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");
  const rebuilt = zipWrite(files.map((f) => (f === pkg
    ? { name: f.name, data: Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, "utf8"), mode: f.mode, mtime: FIXED_MTIME }
    : { name: f.name, data: f.data, mode: f.mode, mtime: FIXED_MTIME })));

  /* 되읽어 확인 — 판 번호가 **실제로** 바뀌었나(«고쳤다»는 «바뀌었다»가 아니다). */
  const back = zipRead(rebuilt).find((f) => /(^|\/)package\.json$/.test(f.name));
  const backVer = back ? String((JSON.parse(back.data.toString("utf8")) as { version?: string }).version ?? "") : "";
  if (backVer !== a.as) return { ok: false, why: `다시 묶었는데 안의 판이 v${backVer || "?"} 이에요(v${a.as} 여야 합니다).` };

  return {
    ok: true,
    latest: { version: a.as, sha256: sha256(rebuilt), bytes: rebuilt.length, releasedAt: new Date().toISOString(), notes: `v${a.from} 의 내용을 v${a.as} 로 되감음` },
    zip: { key: releaseKey(a.as), bytes: rebuilt },
    warn: `기기들은 다음 하트비트에 v${a.as}(= v${a.from} 의 내용)로 올라옵니다. v${a.from} zip 은 그대로 둡니다.`,
  };
}

/** zip 이 실제로 열리고 알맹이가 있나 — «있다고 적혀 있다»는 «열린다»가 아니다. */
function openable(buf: Buffer): { ok: true } | { ok: false; why: string } {
  try {
    const files = zipRead(buf);
    if (!files.length) return { ok: false, why: "빈 zip" };
    for (const must of ["ac-runner.mjs", "core.mjs", "package.json"]) {
      if (!files.some((f) => f.name.endsWith(`/${must}`) || f.name === must)) return { ok: false, why: `${must} 가 없다` };
    }
    return { ok: true };
  } catch (e) { return { ok: false, why: String((e as Error)?.message ?? e).slice(0, 80) }; }
}

/* ─────────────────────────── 실행 ─────────────────────────── */

async function main() {
  const argv = process.argv.slice(2);
  const go = argv.includes("--go");
  const [cmd, a1, a2] = argv.filter((x) => !x.startsWith("--"));

  if (!cmd || !["stop", "reissue"].includes(cmd)) {
    console.log(`
  러너 배포 되돌리기 — 🔴 **두 가지고, 둘은 다른 일을 합니다**

    stop <version>          더 안 퍼지게 — 아직 안 받은 기기만 그 판을 받습니다.
                            🔴 **이미 받은 기기는 그대로입니다.**
    reissue <from> <as>     되감아 올리기 — 옛 내용을 더 높은 새 번호로 다시 냅니다.
                            🔴 **전부 돌아옵니다**(앞으로만 가는 규칙을 안 어기면서 되돌리는 유일한 길).

    --go 를 붙여야 실제로 바뀝니다(기본은 보기만).
    예) node scripts/runner-release-control.mts stop 1.1.8
        node scripts/runner-release-control.mts reissue 1.1.8 1.2.1 --go
`);
    process.exit(2);
  }
  if (!r2Configured()) { console.error("  ✗ R2 설정이 없어요(.env)."); process.exit(1); }

  const cur = await r2Get(LATEST_KEY).catch(() => null);
  const current = cur ? (JSON.parse(Buffer.from(cur.bytes).toString("utf8")) as RunnerRelease) : null;
  console.log(`\n── 지금 배포 중: ${current ? `v${current.version} (${current.bytes.toLocaleString()} bytes)` : "(없음)"} ──`);

  const getZip = async (v: string) => {
    const got = await r2Get(releaseKey(v)).catch(() => null);
    return got ? Buffer.from(got.bytes) : null;
  };

  const plan = cmd === "stop"
    ? planStop({ current, target: String(a1 ?? ""), targetZip: await getZip(String(a1 ?? "")) })
    : planReissue({
      current, from: String(a1 ?? ""), as: String(a2 ?? ""),
      fromZip: await getZip(String(a1 ?? "")),
      asZipExists: !!(await r2Head(releaseKey(String(a2 ?? ""))).catch(() => null)),
    });

  if (!plan.ok) { console.error(`\n  ✗ ${plan.why}\n`); process.exit(1); }

  console.log(`  → latest.json: v${plan.latest.version} · ${plan.latest.bytes.toLocaleString()} bytes · sha256 ${plan.latest.sha256.slice(0, 16)}…`);
  if (plan.zip) console.log(`  → 새 zip 을 올립니다: ${plan.zip.key} (${plan.zip.bytes.length.toLocaleString()} bytes)`);
  if (plan.warn) console.log(`\n  ⚠ ${plan.warn}`);
  console.log("  · zip 은 **하나도 지우지 않습니다**.");

  if (!go) { console.log("\n  --go 가 없어서 아무것도 바꾸지 않았어요.\n"); return; }

  if (plan.zip) await r2Put(plan.zip.key, plan.zip.bytes, "application/zip");
  await r2Put(LATEST_KEY, Buffer.from(`${JSON.stringify(plan.latest, null, 2)}\n`, "utf8"), "application/json; charset=utf-8");
  /* 🔴 **되읽어 확인한다** — 올렸다는 «그 값이 거기 있다»가 아니다. */
  const back = await r2Get(LATEST_KEY);
  const seen = back ? (JSON.parse(Buffer.from(back.bytes).toString("utf8")) as RunnerRelease) : null;
  if (seen?.version !== plan.latest.version || seen?.sha256 !== plan.latest.sha256) {
    console.error("\n  ✗ 올렸는데 되읽은 값이 달라요 — 손으로 확인해 주세요.\n"); process.exit(1);
  }
  console.log(`\n  ✓ 끝났어요. 지금 배포 중 = v${seen.version}. 러너는 다음 하트비트(≤1분)에 반영합니다.\n`);
}

/* 하니스가 이 파일을 **임포트만** 할 때는 main 을 돌리지 않는다(순수 판정만 가져다 쓴다). */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
