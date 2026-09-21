/**
 * scripts/verify-code-only.mjs — `scripts/_lib/code-only.mjs` 의 자.
 *   `node scripts/verify-code-only.mjs` · 종료코드 0 = 전부 통과.
 *
 *   ══ 🔴 왜 이 자가 있나 ══
 *     이 함수는 **하니스 셋이 같이 쓰는 잣대**다(변이 «심은 자리 수» · zip 안 «그 낱말이 있나» · C 의 음성 대조).
 *     🔴 **여기가 틀리면 그 자들이 전부 조용히 틀린다** — 그것도 «빨강»이 아니라 **«초록»으로** 틀린다.
 *     2026-09-19 에 **사람이 손으로 버그를 두 개** 찾았다(블록 주석 이어짐 줄 · 문자열 안 `://`).
 *     세 번째는 자가 찾아야 한다.
 *
 *   ══ 🔴 대조군을 짝으로 둔다(AC-99 ⑫) ══
 *     «걷히나»만 재면 **전부 지우는 함수**도 초록이다. 그래서 **«안 걷혀야 할 것»을 같은 수만큼 둔다.**
 *
 *   ══ 🔴 «아직 못 하는 것»도 축으로 적는다 ══
 *     못 하는 것을 **비워 두면** 다음 사람이 한계를 모르고 넓힌다. 「지금은 이렇게 동작한다」를 **못으로 박아**
 *     나중에 누가 고치면 **빨개지게** 한다(그때 이 줄을 같이 고치는 것이 맞다).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, codeOnlyKeepIndex, countInCode } from "./_lib/code-only.mjs";

const NL = String.fromCharCode(10);
const S2 = "/" + "/";
const BOPEN = "/" + "*";
const BCLOSE = "*" + "/";

let fail = 0, pass = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
const has = (src, needle) => codeOnly(src).includes(needle);

console.log("① 걷힌다 — 주석은 사라져야 한다");
{
  ok("줄 주석", !has(`const a = 1; ${S2} 비밀글자`, "비밀글자"));
  ok("블록 주석 한 줄", !has(`${BOPEN} 비밀글자 ${BCLOSE} const a = 1;`, "비밀글자"));
  ok("블록 주석 여러 줄", !has([BOPEN, " * 비밀글자", BCLOSE, "const a = 1;"].join(NL), "비밀글자"));
  /* 🔴 **이게 첫 번째 실제 버그였다**(2026-09-19): `*` 없이 시작하는 이어짐 줄이 남았다. */
  ok("🔴 블록 주석의 **이어지는 줄**(`*` 없이 시작)", !has([BOPEN + " 머리", "  (실제로 그랬다: 비밀글자 …)", BCLOSE, "const a = 1;"].join(NL), "비밀글자"));
  ok("닫히지 않은 블록 주석은 끝까지 걷는다", !has([BOPEN + " 머리", "비밀글자"].join(NL), "비밀글자"));
}

console.log("② 🔴 대조군 — 코드는 **살아야** 한다(안 그러면 «전부 지우는 함수»도 초록이다)");
{
  ok("평범한 코드", has("const 살아야한다 = 1;", "살아야한다"));
  /* 🔴 **이게 두 번째 실제 버그였다**(C 실측): `://` 뒤가 통째로 잘렸다 — 러너 .mjs 20파일 47줄. */
  ok("🔴 문자열 안 `https://…`", has('await page.goto("https://살아야한다/manage");', "살아야한다"));
  ok("🔴 그 줄의 **뒤쪽**까지 산다", has('await page.goto(`https://x/${host}`, { waitUntil: "끝까지" });', "끝까지"));
  ok("프로토콜 여럿", has('const a = "http://a"; const b = "wss://살아야한다";', "살아야한다"));
  ok("주석 **뒤에 오는** 코드 줄", has([`const a = 1; ${S2} 주석`, "const 살아야한다 = 2;"].join(NL), "살아야한다"));
  ok("블록 주석 **뒤에 오는** 코드", has(`${BOPEN} 주석 ${BCLOSE} const 살아야한다 = 1;`, "살아야한다"));
}

console.log("③ 🔴 줄 수를 보존한다 — 안 그러면 «줄 번호로 맞댄 표»가 통째로 거짓이 된다");
{
  const src = [BOPEN, " * 한 줄", " * 두 줄", BCLOSE, "const a = 1;", `${S2} 끝`].join(NL);
  ok("줄 수가 같다", codeOnly(src).split(NL).length === src.split(NL).length, `${codeOnly(src).split(NL).length} vs ${src.split(NL).length}`);
  const b = codeOnly(src).split(NL);
  ok("코드가 **같은 줄 번호**에 남는다", b[4].includes("const a = 1;"), JSON.stringify(b));
}

console.log("④ 🔴 실물로 — 러너 소스를 통째로 먹여 본다");
{
  /* 🔴 **남의 코드는 안 센다** — `node_modules` 의 라이선스 주석까지 세면 «우리 러너 소스»를 재는 게 아니다. */
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { if (n === "node_modules") continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith(".mjs")) out.push(p); } return out; };
  const files = walk("runner");
  /* 🔴 **재는 것을 «줄이 짧아졌나»로 두면 안 된다**(2026-09-19 · 이 자가 스스로 거짓 빨강을 냈다):
     `"https://x", ${S2} 실측: …` 처럼 URL 뒤에 **진짜 주석**이 붙은 줄은 **짧아지는 게 맞다**(URL 은 살아 있다).
     ⇒ 재야 하는 것은 «줄 길이»가 아니라 🔴 **«그 URL 이 살아남았나»**다. 대용물로 재면 함수가 아니라 자를 고치게 된다. */
  const urlsIn = (line) => { const out = []; let k = line.indexOf(":" + S2); while (k >= 0) { let a = k; while (a > 0 && !" 	\"'`(,".includes(line[a - 1])) a -= 1; let b = k; while (b < line.length && !" 	\"'`),;".includes(line[b])) b += 1; out.push(line.slice(a, b)); k = line.indexOf(":" + S2, b); } return out; };
  let lineDrift = 0, urlLost = 0;
  const lost = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const a = src.split(NL), b = codeOnly(src).split(NL);
    if (a.length !== b.length) lineDrift += 1;
    for (let i = 0; i < a.length; i++) {
      const stripped = b[i] ?? "";
      for (const u of urlsIn(a[i])) {
        /* 주석 줄 안의 URL 은 **사라지는 게 맞다** — 그 줄이 통째로 걷혔으면 셈에서 뺀다. */
        if (!stripped.trim() && a[i].trim()) continue;
        if (!stripped.includes(u)) { urlLost += 1; if (lost.length < 4) lost.push(`${f}:${i + 1} ${u.slice(0, 40)}`); }
      }
    }
  }
  ok(`러너 .mjs ${files.length}개(남의 코드 뺌) 전부 줄 수 보존`, lineDrift === 0, `${lineDrift}개 파일이 줄을 잃었다`);
  ok("🔴 코드 줄의 URL 이 **하나도 안 사라진다**(고치기 전에는 47줄이 잘렸다)", urlLost === 0, `${urlLost}개 사라짐: ${lost.join(" / ")}`);
  /* 🔴 지금 두 자가 실제로 쓰는 파일에서 **앵커가 살아 있나** — 이게 «도나»다. */
  const rv = readFileSync("runner/channels/render-video.mjs", "utf8");
  ok("render-video 의 `eof_action=repeat` 이 코드에 **정확히 1곳**", countInCode(rv, "eof_action=repeat") === 1, String(countInCode(rv, "eof_action=repeat")));
  ok("🔴 `eof_action=pass` 는 코드에 **0곳**(주석에는 여럿 있다)", countInCode(rv, "eof_action=pass") === 0, String(countInCode(rv, "eof_action=pass")));
  ok("그 낱말이 **원본에는** 있다(= 위 0곳이 «파일을 못 읽어서»가 아니다)", rv.includes("eof_action=pass"));
}

console.log("④b 🔴 자리 표 보존판(`codeOnlyKeepIndex`) — 순서 판정이 살아 있나(2026-09-22 · AC-193)");
{
  /* 🔴 이 갈래를 만든 까닭이 **순서**다 — 「어느 쪽이 먼저 나오나」를 `indexOf` 로 재는 자는
     주석을 통째로 빼면 자리가 밀려 **답이 달라진다**. 그래서 «걷혔나»와 «자리가 그대로인가»를 **둘 다** 못으로 박는다. */
  const src = [`const A = 1; ${S2} 비밀글자 여기`, `${BOPEN} 비밀글자 ${BCLOSE}`, "const B = 2;"].join(NL);
  const kept = codeOnlyKeepIndex(src);
  ok("걷힌다 — 주석 낱말은 사라진다", !kept.includes("비밀글자"));
  ok("🔴 길이가 그대로다(= 자리 표가 안 밀린다)", kept.length === src.length, `${kept.length} ≠ ${src.length}`);
  ok("🔴 줄 수가 그대로다", kept.split(NL).length === src.split(NL).length);
  ok("🔴 코드의 자리가 원문과 **같은 곳**이다", kept.indexOf("const B") === src.indexOf("const B"));
  ok("🔴 순서가 뒤집히지 않는다", kept.indexOf("const A") < kept.indexOf("const B"));
  ok("`https://` 는 주석이 아니다(같은 눈)", codeOnlyKeepIndex(`const u = "https${S2}x"; ${S2} 비밀글자`).includes("https"));
  /* 🔴 **대조군**(AC-99 ⑫) — 「전부 공백으로 바꾸는 함수」도 위 넷은 통과한다. 코드가 남았나를 같이 본다. */
  ok("대조군 — 코드는 안 걷힌다", kept.includes("const A = 1;") && kept.includes("const B = 2;"));
  /* 🔴 **두 갈래가 같은 눈인가** — 한쪽만 고치면 또 갈린다(이 파일이 태어난 까닭). */
  const strip = (s) => codeOnlyKeepIndex(s).replace(/ +/g, " ").trim();
  ok("🔴 두 갈래가 같은 것을 걷는다(걷는 눈이 하나다)",
    strip(`const a = 1; ${S2} 비밀글자`).includes("const a = 1;") && !codeOnly(`const a = 1; ${S2} 비밀글자`).includes("비밀글자"));
}

console.log("⑤ ⚠️ **아직 못 하는 것** — 못으로 박는다(누가 고치면 여기가 빨개지고, 그때 머리말도 같이 고친다)");
{
  ok("문자열 안의 `" + S2 + "`(앞이 `:` 가 아님)는 **아직 못 가린다**", !has(`const a = "글자 ${S2} 사라진다";`, "사라진다"));
  ok("문자열 안의 블록 주석 여는 글자도 **아직 못 가린다**", !has(`const a = "${BOPEN} 사라진다 ${BCLOSE}";`, "사라진다"));
}

console.log(`\n${fail === 0 ? "초록" : "빨강"} — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
