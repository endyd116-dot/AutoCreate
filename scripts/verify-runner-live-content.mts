/**
 * scripts/verify-runner-live-content.mts — 🔴 **고객이 받아 가는 zip «안»에 그 고침이 있나**(C · 2026-09-19 · 읽기만).
 *   사용: `npx --yes tsx --env-file=.env scripts/verify-runner-live-content.mts`
 *   종료코드: 0 = 고침이 들어 있다 · 1 = 안 들어 있다 · 2 = 못 쟀음(R2 설정 없음·없는 키 등)
 *
 *   ══ 왜 B2 의 `read-runner-live.mts` 와 **층이 다른가** ══
 *   B2 의 자는 «**무엇이 올라가 있나**»를 읽는다 — `latest.json` 의 판 번호, zip 의 존재와 바이트.
 *   그건 «**가리키는 것이 있다**»까지다. 🔴 **그 zip «안»에 무엇이 들었는지는 안 본다.**
 *   이 자는 그 zip 을 **받아서 열고**, 안의 `channels/render-video.mjs` 를 꺼내 **글자를 본다**:
 *     · `eof_action=pass`  → 🔴 자막·제휴 고지가 **영상에 안 실린다**(2026-09-17 C 실측 · ffmpeg 8.x)
 *     · `eof_action=repeat` → 실린다
 *   ⇒ «판 번호가 몇이냐»가 아니라 «**고객 영상에 고지가 실리느냐**»를 바로 답한다.
 *
 *   🔴 이 자가 태어난 까닭(기록): 2026-09-17 에 내가 «R2 의 러너는 1.3.0 이라 옛 판»이라고 **세 번** 말했는데,
 *      그 숫자의 출처가 **`runner/package.json`**(= 우리가 만든 것)이었다. B2 가 R2 를 직접 읽어 **v1.1.8** 임을 밝혔다
 *      (1.2.0·1.3.0 은 한 번도 안 올라갔다). AC-66 «설정했다 ≠ 그렇다»의 배포판이고,
 *      🔴 **판 번호조차 대용물이다** — 번호가 맞아도 zip 안이 옛 코드면 고객은 그대로다. 그래서 «안»을 본다.
 *
 *   ⚠️ 읽기만 한다. `r2Get`·`r2Head` 뿐이고 쓰기·삭제·업로드가 한 줄도 없다(라이브 변경은 사장님 Allow · AC-50).
 */
import { r2Configured, r2Get, R2_BUCKET } from "../lib/r2";
import { codeOnly } from "./_lib/code-only.mjs";   // 🔴 주석 걷기는 **한 곳**에서(B2 · 2026-09-19)
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const PREFIX = "autocreate/runner/";
const out: { step: string; ok: boolean | null; note: string }[] = [];
const rec = (step: string, ok: boolean | null, note = "") => { out.push({ step, ok, note }); return ok; };

/** zip 을 푼다 — `tar`(bsdtar) → 윈도 `Expand-Archive` 순. 둘 다 안 되면 «못 쟀음»(통과 아님). */
function unzip(zipPath: string, dest: string): boolean {
  const t = spawnSync("tar", ["-xf", zipPath, "-C", dest], { encoding: "utf8", shell: false, timeout: 120_000 });
  if (t.status === 0) return true;
  if (process.platform !== "win32") return false;
  /* 🔴 인자에 따옴표·역슬래시를 안 넣는다 — 이 환경의 셸이 한 겹 먹는다(AC-100). `-LiteralPath` 로 그대로 넘긴다. */
  const p = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`],
    { encoding: "utf8", shell: false, timeout: 180_000 });
  return p.status === 0;
}

async function main() {
  if (!r2Configured()) { console.error("⊘ 못 쟀음 — R2 설정이 없다(.env 의 R2_*)"); process.exit(2); }
  console.log(`\n── 라이브 러너 zip «안»을 본다 (버킷 ${R2_BUCKET} · 읽기만) ──\n`);

  /* 🔴 `--version=1.1.8` 로 **아무 판이나** 볼 수 있다 — 그래야 이 자가 «진짜 잡는 자»인지 증명된다.
     안 주면 `latest.json` 이 가리키는 판(= 지금 고객이 받아 가는 것). */
  const want = (process.argv.find((a) => a.startsWith("--version=")) || "").split("=")[1] || "";
  let version = want;
  if (!version) {
    const latest = await r2Get(`${PREFIX}latest.json`);
    if (!latest) { console.error("⊘ 못 쟀음 — latest.json 이 없다(한 번도 안 올렸다)"); process.exit(2); }
    try { version = String(JSON.parse(Buffer.from(latest.bytes).toString("utf8")).version ?? ""); } catch { /* 아래 */ }
    if (!version) { console.error("⊘ 못 쟀음 — latest.json 에서 version 을 못 읽었다"); process.exit(2); }
  }
  rec(want ? "지정한 판(음성 대조용)" : "라이브가 가리키는 판", true, `v${version}${want ? " — `--version=` 으로 물린 판이다" : ""}`);

  const zipKey = `${PREFIX}v${version}.zip`;
  const zip = await r2Get(zipKey);
  if (!zip) { rec("그 판의 zip 이 실제로 있다", false, `🔴 ${zipKey} 가 없다 — 가리키기만 하고 파일이 없다(러너가 받다 실패한다)`); return report(1); }
  const sha = createHash("sha256").update(Buffer.from(zip.bytes)).digest("hex").slice(0, 16);
  rec("그 판의 zip 이 실제로 있다", true, `${zip.bytes.byteLength.toLocaleString()} bytes · sha256 ${sha}…`);

  const dir = mkdtempSync(join(tmpdir(), "ac-runner-live-"));
  try {
    const zipPath = join(dir, "r.zip");
    writeFileSync(zipPath, Buffer.from(zip.bytes));
    if (!unzip(zipPath, dir)) { rec("zip 이 열린다", null, "⊘ 못 쟀음 — tar 로 못 풀었다(이 PC 에 zip 해제기가 없나)"); return report(2); }
    rec("zip 이 열린다", true, "풀었다");

    /* 🔴 고객이 실제로 돌릴 파일을 꺼내 **글자를 본다.**
       ⚠️ 경로를 **짐작하지 않는다** — 2026-09-19 C 가 여기서 한 번 틀렸다: 후보 둘(`channels/…`·`runner/channels/…`)을
          손으로 적었는데 실제 묶음 뿌리는 **`autocreate-runner/`** 였다 ⇒ 내 자가 «파일이 없다»는 **거짓 빨강**을 냈다.
          🔴 오늘만 세 번째로 같은 병이다(짐작으로 좁게 적기 · AC-106). ⇒ **찾아서** 쓴다. */
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const hit = walk(dir).find((p) => p.replace(/\\/g, "/").endsWith("/channels/render-video.mjs"));
    if (!hit) { rec("zip 안에 render-video.mjs 가 있다", false, `🔴 묶음 어디에도 없다 — 이 판은 **영상을 아예 못 굽는다**`); return report(1); }
    const raw = readFileSync(hit, "utf8");
    rec("zip 안에 render-video.mjs 가 있다", true, hit.slice(dir.length + 1));

    /* 🔴 **주석을 걷고 본다 — 안 걷으면 «그 병을 설명한 주석»이 «그 병»으로 세어진다.**
       2026-09-19 실측: v1.4.0 에서 `eof_action=pass` 가 **다섯 줄** 걸렸는데 **전부 주석**이었고
       코드는 `:471` 의 `eof_action=repeat` **한 줄**뿐이었다 ⇒ 내 첫 판이 **거짓 빨강**을 냈다.
       🔴 그리고 그중 한 줄은 `(실제로 그랬다: 옛 ...` 로 **`*` 없이** 시작한다 — 블록 주석의 **이어지는 줄**이다.
          «줄 앞이 `*` 면 주석» 식으로 걷으면 **그 줄이 살아남는다**(B2 가 자기 자에서 먼저 밟고 알려 줬다).
       ⇒ **글자 단위**로 걷는다: 블록 주석 · 줄 주석 · 문자열/템플릿 안은 건드리지 않는다. */
    /* 🔴 **셈은 한 곳에서 나온다**(B2 `scripts/_lib/code-only.mjs`) — 셋이 각자 만들어 셋 다 틀린 자리라
       내 것을 따로 두지 않는다(두 벌이면 또 갈린다 · AC-101). 들이기 전에 **내가 재 봤다**:
       줄 수 796→796 보존 · 내 앵커 `eof_action=repeat` 2→**1**(주석만 걷힘) · `pass` 4→**0** · 잘린 코드 **0줄**.
       ⚠️ 🔴 **다만 그 함수는 문자열 안 `//` 도 주석으로 본다** — 러너 32개 중 16개가 `://` 를 갖고 있고
          그걸로 **코드 43줄이 잘린다**(실측 · B2 에 넘겼다). 이 자가 보는 `render-video.mjs` 는 `://` 가 **0곳**이라
          지금은 안 물린다. 🔴 **다른 러너 파일을 보게 넓히려면 그 고침이 먼저다.** */
    const src = codeOnly(raw);
    const commentOnlyPass = /eof_action=pass/.test(raw) && !/eof_action=pass/.test(src);
    if (commentOnlyPass) rec("🔸 참고 — `pass` 가 주석에만 있다(그 병을 설명한 글)", true, "주석을 걷고 판정했다(안 걷으면 거짓 빨강이다)");

    const hasPass = /eof_action=pass/.test(src);
    const hasRepeat = /eof_action=repeat/.test(src);
    /* 🔴 이 한 줄이 «고객 영상에 자막·제휴 고지가 실리나»를 그대로 답한다. */
    rec("🔴 고객이 받아 가는 판에 **자막·제휴 고지 수리**가 들어 있다(`eof_action=repeat`)", hasRepeat && !hasPass,
      hasRepeat && !hasPass ? "repeat — 자막·고지가 영상에 실린다"
        : hasPass ? `🔴 **pass 다** — 이 판을 쓰는 고객 영상엔 자막·제휴 고지가 **첫 프레임 한 장만** 실린다(v${version})`
          : "🔴 둘 다 없다 — 오버레이 합성 줄을 못 찾았다(묶음이 다른 모양인가 · 검사를 고쳐라)");

    /* 곁들여: R12 모션·전환이 그 판에 들어 있나(있으면 «새 판», 없으면 «옛 판») */
    const hasMotion = /motionForLayer/.test(src);
    const hasXfade = /planTransitions|xfade/.test(src);
    rec("곁 — 그 판에 R12 모션·전환이 들어 있나", hasMotion && hasXfade ? true : null,
      `motionForLayer ${hasMotion ? "있다" : "없다"} · 전환 ${hasXfade ? "있다" : "없다"}${hasMotion && hasXfade ? "" : " (없으면 R12 이전 판이다)"}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ } }
  return report();
}

function report(forceExit?: number) {
  console.log("");
  for (const r of out) console.log(`${r.ok === true ? "✓" : r.ok === false ? "✗" : "⊘"} ${r.step}${r.note ? ` — ${r.note}` : ""}`);
  const red = out.filter((r) => r.ok === false).length, gray = out.filter((r) => r.ok === null).length;
  console.log(`\n합계 ${out.filter((r) => r.ok === true).length} 통과 · ${red} 빨강 · ${gray} ⊘${gray ? " — 못 쟀음은 통과가 아니다(AC-9)" : ""}`);
  process.exit(forceExit ?? (red ? 1 : 0));
}

main().catch((e) => { console.error("하니스 자체가 죽었다:", e); process.exit(2); });
