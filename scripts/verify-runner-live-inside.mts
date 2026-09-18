/**
 * scripts/verify-runner-live-inside.mts — 🔴 **고객이 받아 가는 zip «안»에 무엇이 들었나.** 읽기만 한다.
 *   `npx --yes tsx --env-file=.env scripts/verify-runner-live-inside.mts`
 *
 *   ══ 왜 또 있나 — `read-runner-live.mts` 로는 모자라다 ══
 *     그 자는 «**무엇이 올라가 있나**»(번호·존재·바이트·해시)까지다. 🔴 **번호조차 대용물이다**(C 지적 2026-09-19):
 *     번호가 새것이어도 zip 안이 옛 코드면 **고객은 그대로**고, `latest.json` 만 보면 «갔다»로 읽힌다.
 *     ⇒ 이 자는 **그 zip 을 실제로 받아서 열고 코드 글자를 본다.** «갔다»를 **받아 가는 바이트**로 증명한다.
 *
 *   🔴 쓰기 0 · 삭제 0 (`r2Get` 뿐).
 *   🔴 묶음 안 경로를 **짐작하지 않는다** — C 가 여기서 «파일이 없다»는 거짓 빨강을 냈다(뿌리가 `autocreate-runner/` 였다).
 *      ⇒ 항목 이름을 **끝부분 일치**로 찾는다.
 *
 *   🔴 **주석을 걷고 센다**(2026-09-19 · 이 자가 처음 돌 때 **스스로 거짓 빨강을 냈다**):
 *      `eof_action=pass` 를 찾았더니 **네 곳이 나왔는데 전부 «그때 이래서 고쳤다»는 주석**이었다.
 *      본문에는 한 곳도 없었다. 🔴 오늘 같은 병을 네 번 밟았고, **이번엔 그 병을 재려고 만든 자가 그 병에 걸렸다.**
 *      ⇒ «무엇이 들었나»를 글자로 재는 자는 **언제나 주석을 걷고 재야 한다**(`runner/lib/plan.mjs` 를 세는 하니스와 같은 규칙).
 */
import { r2Get, r2Configured, R2_BUCKET } from "../lib/r2";
import { zipRead } from "../runner/lib/zip.mjs";

const PREFIX = "autocreate/runner/";

/** 🔴 주석을 걷은 본문 — «있다/없다»를 **실행되는 코드에서만** 센다(위 머리말). */
function codeOnly(src: string): string {
  /* 🔴 **진짜로 걷는다** — 「`*` 로 시작하는 줄만 지우기」는 **모자랐다**(2026-09-19 실측):
     블록 주석의 **이어지는 줄**이 `(실제로 그랬다: 옛 eof_action=pass 판을 …` 처럼 `*` 없이 시작하면 그대로 남아
     이 자가 **거짓 빨강**을 냈다. ⇒ `/* … *\u002f` 와 `//` 를 **글자 단위로** 훑어 지운다.
     ⚠️ 문자열 안의 `/*` 까지 가리지는 않는다 — 이 자는 «그 낱말이 실행되는 코드에 있나»만 보므로 그 정도면 넉넉하다. */
  const t = String(src);
  let out = "";
  let k = 0;
  while (k < t.length) {
    const two = t.slice(k, k + 2);
    if (two === "/*") { const e = t.indexOf("*" + "/", k + 2); k = e < 0 ? t.length : e + 2; continue; }
    if (two === "//") { const e = t.indexOf(String.fromCharCode(10), k); k = e < 0 ? t.length : e; continue; }
    out += t[k]; k += 1;
  }
  return out;
}

/** 이 판이 «어느 라운드»인지 zip 안 글자로 가른다. 🔴 없으면 `⊘ 못 쟀다`(«옛 판»이라고 단정하지 않는다). */
const CHECKS: { file: string; needle: string; good: boolean; say: string }[] = [
  { file: "channels/render-video.mjs", needle: "eof_action=repeat", good: true, say: "자막·제휴 고지가 **창 내내** 실린다(R12 수리)" },
  { file: "channels/render-video.mjs", needle: "eof_action=pass", good: false, say: "🔴 자막·제휴 고지가 **첫 프레임 한 장만** 실린다" },
  { file: "channels/render-video.mjs", needle: "motionForLayer", good: true, say: "자막 모션 넷(R12-1)" },
  { file: "channels/render-video.mjs", needle: "planTransitions", good: true, say: "컷 전환 셋(R12-2)" },
  { file: "channels/render-video.mjs", needle: "overlayVerified", good: true, say: "«고지가 정말 실렸나»를 러너가 잰다" },
  { file: "lib/format-bleed.mjs", needle: "FORMAT_BLEED_MAX_PCT", good: true, say: "글자 꾸밈 번짐 세 겹(R9-3)" },
  { file: "lib/plan.mjs", needle: "itemPartsOf", good: true, say: "목록·표 «안»의 꾸밈(R12-5)" },
  { file: "channels/daangn.mjs", needle: "MAX_PHOTOS", good: true, say: "당근 새소식(R12-6)" },
  { file: "channels/reference-capture.mjs", needle: "export", good: true, say: "레퍼런스 캡처(R10-1)" },
  { file: "lib/profile-seal.mjs", needle: "export", good: true, say: "프로필 봉인(R8)" },
];

async function main(): Promise<void> {
  if (!r2Configured()) { console.error("R2 설정이 없어요."); process.exit(2); }
  const latest = await r2Get(`${PREFIX}latest.json`);
  if (!latest) { console.error("latest.json 이 없어요."); process.exit(1); }
  const j = JSON.parse(Buffer.from(latest.bytes).toString("utf8")) as { version?: string };
  /* 🔴 판을 **골라서** 볼 수 있게 둔다 — 이 자가 «진짜 잡나»는 **옛 판에 대고 빨개지는지**로만 증명된다.
     (초록인 검사는 «잡는다»의 증거가 아니다 · AC-100 ⑦ 의 배포판) */
  const pick = process.argv.slice(2).find((x) => x.startsWith("--version="));
  const version = pick ? pick.split("=")[1] : String(j.version ?? "");
  if (pick) console.log(`(지정한 판을 봅니다 — latest.json 은 v${j.version} 입니다)`);
  console.log(`\n── 고객이 받아 가는 zip «안» 보기 (버킷 ${R2_BUCKET} · 읽기만) ──\n`);
  console.log(`latest.json 이 가리키는 판 : v${version}`);

  const z = await r2Get(`${PREFIX}v${version}.zip`);
  if (!z) { console.error(`🔴 v${version}.zip 을 못 받았어요 — latest.json 이 없는 판을 가리킵니다.`); process.exit(1); }
  const entries = zipRead(Buffer.from(z.bytes)) as { name: string; data: Buffer }[];
  console.log(`받은 zip                   : ${z.bytes.length.toLocaleString()} bytes · 항목 ${entries.length}개`);
  /* 🔴 뿌리를 짐작하지 않는다 — 실제 이름에서 공통 앞머리를 읽어 보여 준다. */
  const root = entries[0]?.name.includes("/") ? entries[0].name.split("/")[0] + "/" : "(뿌리 없음)";
  console.log(`묶음 뿌리                  : ${root}\n`);

  const find = (suffix: string) => entries.find((e) => e.name.endsWith(suffix));
  let bad = 0, unknown = 0;
  for (const c of CHECKS) {
    const e = find(c.file);
    if (!e) {
      /* 🔴 «나쁜 게 없나»를 보는 검사는 **파일이 없으면 못 잰 것**이다 — 조용히 통과시키면 그게 거저 초록이다(AC-9). */
      console.log(`  ${c.good ? "✗" : "⊘"} ${c.file} — 이 판에 **없습니다**${c.good ? ` (${c.say})` : " — 그래서 못 쟀습니다"}`);
      bad++; continue;
    }
    const has = codeOnly(Buffer.from(e.data).toString("utf8")).includes(c.needle);
    const okNow = c.good ? has : !has;
    if (!okNow) bad++;
    const say = c.good ? c.say : okNow ? `${c.say} — **이미 고쳐졌습니다**` : `${c.say} — 🔴 **아직 그대로입니다**`;
    console.log(`  ${okNow ? "✓" : "✗"} ${say}${okNow || !c.good ? "" : " — 🔴 **안 들어 있습니다**"}`);
  }
  console.log(`\n${bad === 0 ? "초록 — 고객이 받아 가는 바이트에 R12 가 실제로 들어 있습니다." : `빨강 — ${bad}가지가 안 맞습니다.`}\n`);
  process.exit(bad === 0 ? 0 : 1);
  void unknown;
}

main().catch((e) => { console.error("읽기 실패:", String((e as Error)?.message ?? e)); process.exit(1); });
