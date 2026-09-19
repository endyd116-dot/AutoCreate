/**
 * scripts/verify-ruler-legible.mjs — 🔴 **«또렷하게 말한다»(CLAUDE §9)를 «우리 자»에게 건다**
 *   (C · 2026-09-21 · 첫 발행 다음 판)
 *
 *   ══ 왜 이 자가 있나 ══
 *   2026-09-20, `verify-api-surface` 의 △ 줄이 이렇게 찍혔다:
 *       `${unused.length}종: ${unused.slice(0, 8).join(" ")}…`   그리고 그 note 가 다시 `w(note, 58)` 로 잘렸다.
 *   ⇒ **«44종»이라고 말해 놓고 화면에 보이는 것은 셋**이었다. 묻힌 41개 안에
 *     «영상 돈 멈춤 스위치가 화면에 없다»가 있었고 **아무도 안 읽었다.** 돈이 새는 문을 자가 알고도 못 전한 것이다.
 *
 *   🔴 **§9 는 «막지 않는 대신 또렷하게 말한다»인데, 그 규율이 제품에만 걸려 있었다.**
 *      자가 «N개»라고 말하면 **N개를 다 찍어야** 한다. 세어 놓고 감추면 **안 센 것만 못하다** —
 *      «44종»이라는 수가 «봤다»는 착각을 만들기 때문이다(AC-113 «거짓 초록»의 사촌).
 *
 *   ══ 무엇을 세는가 ══
 *   ① 🔴 **«N개»라 말하면서 얼마를 감췄는지는 안 말하는 자리** — «예:»도 «외 N건»도 안 붙인 것만 센다.
 *      🔴 **판정에 안 넣는다(2026-09-21 · 내가 재고 내린 판단)**: 20개 자에 43곳이고 **거의 다 집안 문체**다.
 *      빨강으로 올리면 자 스물몇이 한꺼번에 빨개진다 — 그건 내가 막으려던 바로 그것이다(AC-95).
 *      ⇒ **세어서 또렷하게 말하는 축**으로 둔다. «실패 줄의 표본에 «외 N건»을 붙이는 일»이 끝나면 **그날 올린다.**
 *      🔴 «통과»가 아니라 **«아직 못 올린 일감»**이다(AC-9) — 이 줄을 안 적으면 다음 사람이 초록으로 읽는다.
 *   ② △ **칸 너비로 note 를 자르는 자**(살펴볼 것) — `String(x).slice(0, n).padEnd(n)` 꼴.
 *      🔴 판정에 안 넣는다: 표를 가지런히 하려는 것이라 그 자체는 죄가 아니다. 다만 **목록을 담은 note 가 그리로 가면** ①이 된다.
 *      그래서 **개수와 이름을 또렷하게 찍는다** — 이 수가 늘면 ①이 또 날 자리가 늘어난 것이다.
 *
 *   ══ 🔴 이 자가 **못 재는 것**(AC-9) ══
 *   · «자가 찍은 수»와 «실제로 찍힌 줄 수»를 **돌려서** 대조하지는 않는다(자마다 출력 모양이 달라 파싱이 거짓말한다).
 *     글자만 본다 ⇒ 자르지 않고도 감추는 길(로그를 통째로 안 찍는 것)은 이 자가 못 잡는다.
 *   · `k > 20` 인 자르기는 «글자 다듬기»로 보고 안 센다 — 경계는 내가 정한 것이고, 그 경계 바깥은 못 쟀다.
 *
 *   종료코드: 0 = **자기 찌르기가 다 울었다**(①②는 세어서 찍기만 한다) · 1 = 자기 찌르기가 안 울었다(이 자를 못 믿는다) · 2 = 못 쟀다.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "scripts");
if (!existsSync(DIR)) { console.error("⊘ 못 쟀어요 — scripts/ 가 없다."); process.exit(2); }

/** 주석을 걷는다(AC-109 ①) — 주석 속 본보기를 제품 코드로 세면 안 된다. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, " ");

const CUT = 20;   // 🔴 이보다 큰 자르기는 «글자 다듬기»로 본다(경계는 내가 정했다 — 머리말에 적어 뒀다)

/* 🔴 **자르는 것 자체는 죄가 아니다** — 죄는 «몇 개인지 말해 놓고 **얼마를 감췄는지는 안 말하는 것**»이다.
   첫 판에 «자르면 빨강»으로 했더니 50곳이 걸렸는데 **대부분 정직한 자리**였다:
     · `못 박은 자리 ${safe.length}곳 (예: …3개)`      → «예»라고 **밝혔다**. 전부가 아님을 읽는 사람이 안다.
     · `${miss.slice(0,4)} 외 ${miss.length - 4}건`   → **감춘 수를 말한다.** 더 보려면 어디를 볼지 안다.
   2026-09-20 에 사고를 낸 줄은 둘 다 안 했다:
     `${unused.length}종: ${unused.slice(0, 8)...}${unused.length > 8 ? " …" : ""}`
   «44종»이라 말하고 8개만 찍고 **«…»** 한 글자로 끝냈다 — **얼마가 숨었는지 안 말한다.**
   ⇒ 판정은 그 하나로 좁힌다: **개수를 말하고 · 자르고 · «예»도 «외 N건»도 안 붙인 자리.** */
const SAMPLE_MARK = /(예\s*:|예시|보기|sample)/;
const REMAINDER_MARK = /외\s*(\$\{|\d)/;

/** 한 줄이 «개수를 말하면서, 얼마를 감췄는지는 안 말하고 목록을 자르는가». */
function hidesInLine(line) {
  const out = [];
  const excused = SAMPLE_MARK.test(line) || REMAINDER_MARK.test(line);
  for (const m of line.matchAll(/([A-Za-z_$][\w$]*)\s*\.slice\(\s*0\s*,\s*(\d+)\s*\)/g)) {
    const id = m[1], k = Number(m[2]);
    if (k > CUT) continue;
    const saysCount = new RegExp("\\$\\{\\s*" + id + "\\.length\\s*\\}").test(line)
      || new RegExp("\\b" + id + "\\.length\\b[\\s\\S]{0,80}?" + id + "\\.slice\\(").test(line);
    if (saysCount && !excused) out.push({ id, k });
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => /^verify-.*\.(mjs|mts)$/.test(f)).sort();
const hiding = [];
const columned = [];
for (const f of files) {
  if (f === "verify-ruler-legible.mjs") continue;   // 🔴 나 자신은 «본보기 글자»가 많아 뺀다(대신 ⓪ 로 나를 찌른다)
  const src = decomment(readFileSync(path.join(DIR, f), "utf8"));
  src.split("\n").forEach((l, i) => {
    for (const h of hidesInLine(l)) hiding.push({ f, line: i + 1, ...h, text: l.trim().slice(0, 100) });
    if (/String\([^)]*\)\s*\.slice\(\s*0\s*,\s*\w+\s*\)\s*\.padEnd\(/.test(l)) columned.push({ f, line: i + 1 });
  });
}

/* ═══ ⓪ 자기 찌르기 — 🔴 «이 자가 그 사고를 잡았겠나»를 **그때 글자로** 재 본다(AC-122) ═══ */
const probes = [];
const chk = (n, ok, note) => { probes.push({ n, ok, note }); return ok; };
/* 2026-09-20 에 실제로 있던 그 줄을 **글자 그대로** 둔다 — git 에 기대지 않는다(해시는 바뀐다). */
const HISTORIC = '  unused.length ? `${unused.length}종: ${unused.slice(0, 8).join(" ")}${unused.length > 8 ? " …" : ""}` : "0종", unused);';
chk("⓪a 🔴 **2026-09-20 에 킬 스위치를 묻은 그 줄**을 잡는다", hidesInLine(HISTORIC).length === 1, `잡은 것: ${JSON.stringify(hidesInLine(HISTORIC))}`);
chk("⓪b 안 자르고 다 찍는 줄에는 안 운다(거짓 빨강 없음)",
  hidesInLine('say(`${xs.length}종: ${xs.join(" ")}`);').length === 0, "같은 모양인데 `.slice` 가 없다");
chk("⓪c 개수를 말하지 않고 자르기만 하는 줄에는 안 운다",
  hidesInLine('say(`앞쪽: ${xs.slice(0, 3).join(" ")}`);').length === 0, "«몇 개인지»를 말한 적이 없으면 감춘 것이 아니다");
chk("⓪f 🔴 «예:» 라고 **밝힌** 줄에는 안 운다(정직한 표본)",
  hidesInLine('say(`못 박은 자리 ${safe.length}곳 (예: ${safe.slice(0, 3).join(" ")})`);').length === 0, "표본이라고 말했으면 감춘 것이 아니다");
chk("⓪g 🔴 «외 N건» 으로 **감춘 수를 말한** 줄에는 안 운다",
  hidesInLine('say(`${miss.slice(0, 4).join(" | ")} 외 ${miss.length - 4}건`);').length === 0, "얼마가 남았는지 말했으면 따라갈 수 있다");
chk("⓪d 큰 자르기(글자 다듬기)는 안 센다",
  hidesInLine('say(`${xs.length}개: ${xs.slice(0, 200)}`);').length === 0, `경계 k>${CUT}`);
chk("⓪e 주석 속 본보기는 안 센다(AC-109 ①)",
  decomment("/* ${xs.length}종: ${xs.slice(0, 8)} */\nconst a = 1;").split("\n").every((l) => hidesInLine(l).length === 0), "머리말에 적은 본보기가 스스로를 빨갛게 하면 안 된다");

/* ═══ 판정 ═══ */
const say = (s = "") => console.log(s);
say(`🔴 «또렷하게 말한다»를 우리 자에게 건다 · ${new Date().toISOString()}`);
say("─".repeat(118));
say(`■ 잰 모수 — \`scripts/verify-*.{mjs,mts}\` ${files.length}개(나 자신은 뺐다)`);
say("");

if (hiding.length) {
  say(`△ «N개»라 말해 놓고 **목록을 자르는** 자리 ${hiding.length}곳 — 🔴 **판정에 안 넣는다(아직 못 올린다)**`);
  say("   ─ 까닭을 적어 둔다(AC-9 · 내가 재고 내린 판단이다):");
  say(`     · 재 보니 ${new Set(hiding.map((h) => h.f)).size}개 자에 ${hiding.length}곳이다. **거의 다 집안 문체**이지 고장이 아니다.`);
  say("     · 빨강으로 올리면 자 스물몇 개가 **한꺼번에** 빨개진다 — 그건 내가 막으려던 바로 그것이다(AC-95 «늘 빨간 자는 아무도 안 본다»).");
  say("     · 🔴 **올릴 수 있는 날**: 실패 줄의 표본에 «외 N건»을 붙이는 일이 끝나면 그날 판정으로 올린다. 그때까진 **이 목록이 그 일감**이다.");
  say("   ─ 아래는 **자르지 않고 전부** 찍는다(이 자가 제 병을 저지르면 안 된다):");
  for (const h of hiding) {
    say(`   · ${h.f}:${h.line}  \`${h.id}\` 를 ${h.k}개까지만 찍는다`);
    say(`       ${h.text}`);
  }
  say("   🔴 고치는 법: 줄을 나눠 **전부** 찍고, 무리가 크면 무리별 개수를 자가 세어 준다(verify-api-surface 가 본보기).");
} else {
  say("✅ «N개»라 말해 놓고 목록을 자르는 자리 0곳");
}

say("");
say(`△ 살펴볼 것 — 칸 너비로 note 를 자르는 자 ${new Set(columned.map((c) => c.f)).size}개(자리 ${columned.length}곳)`);
for (const f of [...new Set(columned.map((c) => c.f))].sort()) say(`   · ${f}`);
say("   🔴 판정에 안 넣는다 — 표를 가지런히 하려는 것이다. 다만 **목록을 담은 note 가 그리로 가면 위 ① 이 된다.**");
say("   🔴 이 수가 늘면 ①이 날 자리가 늘어난 것이다(2026-09-20 의 사고가 바로 이 둘이 겹친 자리였다).");

say("");
say("⓪ 자기 찌르기 — 🔴 «이 자가 **그 사고를** 잡았겠나»(AC-122)");
for (const p of probes) say(`  ${p.ok ? "✓" : "✗"} ${p.n}  — ${p.note}`);

say("─".repeat(118));
/* 🔴 **판정은 자기 찌르기에만 건다.** ①은 아직 «세어서 또렷하게 말하는» 축이다 —
   내가 재고 «오늘은 못 올린다»고 정했고, 까닭을 위에 적었다. 적어 두지 않으면 다음 사람이 «통과»로 읽는다. */
const badProbe = probes.filter((p) => !p.ok).length;
say(`■ 감추는 자리 ${hiding.length}곳(${new Set(hiding.map((h) => h.f)).size}개 자) · 칸 너비로 자르는 자 ${new Set(columned.map((c) => c.f)).size}개 · 자기 찌르기 ${probes.length - badProbe}/${probes.length}`);
say(badProbe ? `🔴 FAIL — 자기 찌르기 ${badProbe}개가 안 울었다(이 자를 믿을 수 없다)`
  : "PASS — 다만 🔴 **위 두 수는 «통과»가 아니라 «아직 못 올린 일감»이다**(AC-9).");
process.exit(badProbe ? 1 : 0);
