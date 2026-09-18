/**
 * scripts/read-runner-live.mts — 🔴 **라이브 R2 의 러너 판을 읽는다. 읽기만 한다.**
 *   `npx --yes tsx --env-file=.env scripts/read-runner-live.mts`
 *
 *   왜 있나(`docs/active/2026-09-15-OWNER-CHECKLIST.md` §5.2 «누르기 전에 반드시 먼저 할 것» ①):
 *     사장님께 «지금 고객 PC 의 러너는 1.3.0 입니다»라고 말해 왔는데 그 근거는 **`runner/package.json`** 이었다.
 *     🔴 그건 **우리 소스**지 **고객이 받아 가는 것**이 아니다. R2 의 `latest.json` 은 **아직 아무도 안 읽었다**
 *     (메인이 `/api/runner-download` 를 찔렀으나 로그인이 필요해 401).
 *     ⇒ 배포 직전에 «사실»과 «우리 믿음»이 같은지 **한 번은 봐야 한다**(AC-66 «설정했다 ≠ 그렇다»).
 *
 *   🔴 쓰기 0 · 삭제 0. `r2Get`·`r2Head`·`r2ListPrefix` 만 쓴다.
 */
import { r2Configured, r2Get, r2Head, r2ListPrefix, R2_BUCKET } from "../lib/r2";
import { readFileSync } from "node:fs";
import path from "node:path";

const PREFIX = "autocreate/runner/";

async function main(): Promise<void> {
  if (!r2Configured()) { console.error("R2 설정이 없어요(.env 의 R2_* 확인)."); process.exit(2); }
  console.log(`\n── 라이브 러너 판 읽기 (버킷 ${R2_BUCKET} · 읽기만) ──\n`);

  const local = JSON.parse(readFileSync(path.join(process.cwd(), "runner", "package.json"), "utf8")) as { version?: string };
  console.log(`우리 소스(runner/package.json) : v${local.version}`);

  const latest = await r2Get(`${PREFIX}latest.json`);
  if (!latest) {
    console.log("라이브(latest.json)          : 🔴 **없습니다** — 아직 한 번도 안 올렸다는 뜻입니다.");
  } else {
    const j = JSON.parse(Buffer.from(latest.bytes).toString("utf8")) as Record<string, unknown>;
    console.log(`라이브(latest.json)          : v${j.version}`);
    console.log(`  sha256                     : ${String(j.sha256 ?? "").slice(0, 24)}…`);
    console.log(`  바이트                      : ${Number(j.bytes ?? 0).toLocaleString()}`);
    console.log(`  올린 시각(UTC)              : ${j.releasedAt}`);
    const at = new Date(String(j.releasedAt ?? ""));
    if (!Number.isNaN(at.getTime())) console.log(`  올린 시각(KST)              : ${new Date(at.getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19)}`);
    if (j.notes) console.log(`  메모                        : ${j.notes}`);
    /* 🔴 `latest.json` 이 가리키는 zip 이 **정말 있는지**까지 본다 — 가리키기만 하고 없으면 러너가 받다 실패한다. */
    const h = await r2Head(`${PREFIX}v${j.version}.zip`);
    console.log(`  그 판 zip 실존              : ${h ? `✓ (${h.bytes.toLocaleString()} bytes${h.bytes === Number(j.bytes) ? " · latest.json 과 같음" : " · 🔴 latest.json 과 다릅니다"})` : "🔴 없습니다"}`);
  }

  const keys = await r2ListPrefix(PREFIX, 200);
  const zips = keys.filter((k) => k.endsWith(".zip")).sort();
  console.log(`\n올라가 있는 판 ${zips.length}개: ${zips.map((k) => k.slice(PREFIX.length).replace(/\.zip$/, "")).join(" · ") || "(없음)"}`);

  /* 올리려는 판이 이미 있는지 — 있으면 `build-runner.mts` 가 거절한다(같은 번호 재업로드 금지). */
  const wantKey = `${PREFIX}v${local.version}.zip`;
  const exists = await r2Head(wantKey);
  console.log(`\n지금 소스 판(v${local.version}) 이 이미 올라가 있나: ${exists ? "🔴 **예** — 번호를 올려야 합니다" : "아니요 — 이 번호로 올릴 수 있습니다"}`);
  console.log("");
}

main().catch((e) => { console.error("읽기 실패:", String((e as Error)?.message ?? e)); process.exit(1); });
