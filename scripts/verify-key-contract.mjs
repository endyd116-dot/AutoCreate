/**
 * scripts/verify-key-contract.mjs — 🔴 **«같은 이름으로 부르나»**(C · 수리 라운드 2026-09-19).
 *   사용: node scripts/verify-key-contract.mjs            (판정)
 *         node scripts/verify-key-contract.mjs --list     (뽑아낸 계약을 전부 찍는다 — 자가 무엇을 보는지)
 *
 *   ══ 왜 이 자가 있나 — 아홉 중 여섯이 이 모양이었다 ══
 *   2026-09-19 시나리오 B 가 운영센터를 전부 눌러 보니 결함 아홉 중 **여섯이 «화면이 보내는 키 ↔ 서버가 읽는 키»**
 *   가 어긋난 것이었다. 그런데 **그 축을 재는 자가 리포에 하나도 없었다.**
 *   `verify-r8-deadends.mjs` 는 «정의가 있나»(AC-69) 와 «호출이 있나»를 잰다 — 둘 다 이 병을 못 본다.
 *
 *   🔴 **본보기(실측)** — 운영 메모:
 *     화면 `public/ops/tenant.html:71`  → `UI.api("/api/ops-tenant-note", { body: { id, **text**: d.text } })`
 *     서버 `netlify/functions/ops-tenants.ts:238` → `const note = String(b.**note** ?? "")`
 *     ⇒ `note` 가 늘 `""` 라 **저장이 안 될 뿐 아니라 있던 메모까지 지운다.** 그런데 응답은 **`ok:true`**.
 *     타입 검사도 통과한다(`readJson<{note?:string}>` 는 **화면을 안 본다**). 🔴 **오류 한 글자 없이 조용히 죽는 자리**다.
 *
 *   ══ 무엇을 세는가 — 🔴 «손으로 든 목록»이 아니다(AC-108) ══
 *   ① `public/**` 에서 `UI.api("<경로>", { … body: { … } … })` 를 **전부 긁어** 보내는 키를 뽑는다.
 *   ② `netlify/functions/*.ts` 의 `export const config = { path: [...] }` 로 **경로 → 핸들러 파일**을 만든다.
 *   ③ 핸들러에서 그 경로의 **라우트 블록**(`path.endsWith("/xxx")` 부터 다음 `path.endsWith(` 전까지)만 잘라
 *      `b.key` · `body.key` · `readJson<{ key?: … }>` · `["key"]` 로 **읽는 키**를 뽑는다.
 *   ④ **보내는데 안 읽는 키**가 있으면 빨강.
 *
 *   🔴 **주석을 걷고 센다**(AC-109 ①) — `scripts/_lib/code-only.mjs` 한 곳을 쓴다.
 *      «그때 이래서 고쳤다»는 주석의 키 이름을 «읽는다»로 세면 이 자가 바로 그 병에 걸린다.
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 🔴 **되돌아오는 키**(서버 응답 ↔ 화면의 `r.xxx`)는 **찍기만 하고 판정하지 않는다**(«살펴볼 것»).
 *     세 판을 고쳐 봤다 — ①`json({…})` 최상위 키 파싱 ②느슨한 키 모음 ③응답 변수 묶기.
 *     진짜 둘(`coinsSplit`·`notes`)은 매번 잡혔지만 **중첩 접근**(`r.slots[i].topicTitle`)과
 *     **갈래마다 다른 응답 모양** 때문에 거짓 빨강이 끝내 안 걷혔다.
 *     🔴 빨강으로 게이트하면 **잘 선 요청 축까지 같이 못 믿을 것이 된다**(AC-95) ⇒ 내렸다.
 *     **이 축은 아직 «못 쟀음»이다**(AC-9) — 판정으로 올리는 것이 다음 사람의 몫이다.
 *   · 키 이름을 **변수로 만들어** 보내면(`{ [k]: v }`) 못 본다. 지금 리포엔 그런 자리가 없다(아래 ⑤ 축이 센다).
 *   · `fetch()` 직접 호출은 안 본다 — 화면은 `UI.api` 를 쓴다(그 축도 아래 ⑤ 가 센다).
 *
 *   종료코드: 0 = 전부 맞다 · 1 = 어긋난 키가 있다 · 2 = 못 쟀다(재료 없음).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

/* 🔴 뿌리를 손잡이로 뺀다 — **변이를 넣어 보려고**다(AC-108 «만든 사람이 자기 자에 변이를 한 번은 넣어 본다»).
   `scripts/verify-key-contract-mutants.mjs` 가 리포를 임시 폴더로 복사해 망가뜨린 뒤 이 자를 그 뿌리로 돌린다.
   손잡이가 없으면 **변이를 넣으려고 진짜 소스를 고쳐야 한다** — 그건 위험하고(AC-34 «실행 중 소스 편집 금지») 되돌리기도 어렵다. */
const ROOT = process.env.KEY_CONTRACT_ROOT ? path.resolve(process.env.KEY_CONTRACT_ROOT) : path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const FN = path.join(ROOT, "netlify", "functions");
const LIST = process.argv.includes("--list");

if (!existsSync(PUB) || !existsSync(FN)) { console.error("⊘ 못 쟀어요 — public/ 또는 netlify/functions/ 가 없습니다."); process.exit(2); }

/** 폴더를 통째로 훑는다 — 🔴 «내가 적은 이름»이 아니라 «폴더»를 센다(AC-108). */
function walk(dir, re, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

/* ═══ ② 경로 → 핸들러 파일 ═══ */
const routeFile = new Map();   // "/api/ops-tenant-note" → "netlify/functions/ops-tenants.ts"
const fnFiles = walk(FN, /\.ts$/);
for (const f of fnFiles) {
  const src = codeOnly(readFileSync(f, "utf8"));
  const m = src.match(/export\s+const\s+config\s*=\s*\{[^}]*?path\s*:\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/s);
  if (!m) continue;
  for (const p of m[1].match(/["'`](\/[^"'`]+)["'`]/g) ?? []) routeFile.set(p.slice(1, -1), f);
}

/* ═══ ① 화면이 보내는 키 ═══ */
/** `UI.api("<경로>", { … })` 의 두 번째 인자를 괄호 균형으로 잘라 온다(정규식만으로는 중첩을 못 넘는다). */
function sliceArgs(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (!depth) return src.slice(from, i); }
  }
  return "";
}
/** `body: { … }` 의 최상위 키만 뽑는다(중첩 객체 안은 안 본다 — 서버도 그 깊이는 제 나름으로 읽는다). */
function bodyKeys(argSrc) {
  const i = argSrc.search(/\bbody\s*:\s*\{/);
  if (i < 0) return null;
  const open = argSrc.indexOf("{", i);
  let depth = 0, end = -1;
  for (let j = open; j < argSrc.length; j++) {
    const c = argSrc[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) { end = j; break; } }
  }
  if (end < 0) return null;
  const inner = argSrc.slice(open + 1, end);
  const keys = [];
  let depth2 = 0, tok = "";
  for (let j = 0; j < inner.length; j++) {
    const c = inner[j];
    if ("{[(".includes(c)) depth2++;
    else if ("}])".includes(c)) depth2--;
    if (depth2 === 0 && c === ",") { tok = ""; continue; }
    if (depth2 === 0 && c === ":") {
      const k = tok.trim().replace(/^["'`]|["'`]$/g, "");
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.push(k);
      // 값 부분은 건너뛴다
      let d3 = 0;
      for (; j < inner.length; j++) {
        const cc = inner[j];
        if ("{[(".includes(cc)) d3++;
        else if ("}])".includes(cc)) d3--;
        else if (cc === "," && d3 === 0) break;
      }
      tok = ""; continue;
    }
    if (depth2 === 0) tok += c;
  }
  /* 짧은 표기(`{ id, text }`) — 콜론 없이 끝난 토큰도 키다. */
  for (const t of inner.split(",")) {
    const k = t.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(k) && !keys.includes(k)) keys.push(k);
  }
  /* 펼치기(`...patch`)는 이름을 모른다 — 못 잰 것으로 따로 센다. */
  return { keys, spread: /\.\.\./.test(inner) };
}

/** 🔴 **변수로 만든 몸통을 한 겹 따라간다** — `const <name> = { … }` 의 키 + 뒤따르는 `<name>.<키> = …` 의 키. */
function varObjectKeys(src, name, callAt) {
  const keys = new Set();
  /* 🔴 **그 이름이 진짜 «보낼 몸통»인지 먼저 본다.** `piece.html` 에는 `const body = UI.$("#body")`(**DOM 마디**)가 있는데,
     그걸 몸통으로 알고 `body.innerHTML = …` 를 «보내는 키»로 세면 `innerHTML`·`contentEditable` 이 «서버가 안 읽는 키»로 찍힌다.
     🔴 게다가 한 파일에 같은 이름의 몸통이 **여럿** 있다(`accounts.html` 의 add 와 update) — 파일 전체를 훑으면 **남의 키를 섞는다.**
     내 첫 판이 둘 다 저질러 **거짓 빨강 여섯**을 만들 뻔했다(AC-112 ⑤ — 돌려 보고 잡았다).
     ⇒ ①**부르는 자리 바로 앞**의 가장 가까운 `const <이름> = {` 만 본다 ②그 선언과 호출 **사이**의 `<이름>.<키> = …` 만 센다
        ③객체 리터럴을 못 찾으면 **빈 손으로 돌아간다**(= ⊘). 찾은 척하지 않는다. */
  const head = src.slice(0, callAt);
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, "g");
  let declAt = -1, mm;
  while ((mm = re.exec(head))) declAt = mm.index;
  if (declAt < 0) return [];
  /* 🔴 [2026-09-21 · A 가 밟았다] **매개변수를 선언으로 착각하면 «남의 시트 키»를 집는다.**
     `async function startCard(body) { … UI.api("/api/billing-key-start", { body }) }` 처럼 `body` 가 **함수 매개변수**면
     이 파일 어디에도 그 시트의 `const body = {` 가 없다. 그런데 뒤로 훑다 보면 **같은 파일 다른 시트의** `const body = {…}` 가 잡힌다.
     실제로 A 가 `payRoute` 를 지우자 이 자가 **요금제 변경 키**(`planKey`·`cycle`·`agreePaidTerms`)로 다시 빨개졌다 — 엉뚱한 시트 것이다.
     ⇒ **선언한 블록이 호출 전에 닫혔으면 같은 이름이라도 남의 것**이다. 선언에서 호출까지 중괄호를 세어,
        깊이가 한 번이라도 **음수**가 되면(= 그 블록이 닫혔다) **못 따라간 것으로 본다**(⊘). 조용히 엉뚱한 걸 집지 않는다. */
  {
    let depth = 0;
    for (let i = declAt; i < callAt; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth < 0) return []; }
    }
  }
  const open = src.indexOf("{", declAt);
  let d = 0, end = -1;
  for (let i = open; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) { end = i; break; } } }
  if (end < 0 || end > callAt) return [];
  const lit = bodyKeys(`body: ${src.slice(open, end + 1)}`);
  if (lit) for (const k of lit.keys) keys.add(k);
  /* 나중에 붙이는 칸 — 🔴 **선언과 호출 사이**에서만(`body.openedAt = …`) */
  const between = src.slice(end, callAt);
  for (const m of between.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)\\s*=[^=]`, "g"))) keys.add(m[1]);
  for (const m of between.matchAll(new RegExp(`\\b${name}\\[\\s*["']([A-Za-z_$][\\w$]*)["']\\s*\\]\\s*=[^=]`, "g"))) keys.add(m[1]);
  return [...keys];
}

const calls = [];        // { screen, route, keys[], spread }
const unreadableBody = [];  // 🔴 몸통을 못 읽은 짝 — **조용히 넘기지 않는다**(⊘ 로 센다)
const dynamicRoutes = [];   // 화면에서 경로가 변수라 못 읽은 것
const frameworkDynamic = []; // 틀(ui.js) 안의 변수 경로 — `UI.api(path, …)` 재시도라 정당하다
const rawFetch = [];       // UI.api 를 안 거친 화면
const frameworkFetch = []; // 틀(ui.js) 안의 생 fetch — 정당하다(아래 주석)
for (const f of walk(PUB, /\.(html|js)$/)) {
  const src = codeOnly(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/UI\.api\s*\(/g)) {
    const args = sliceArgs(src, m.index + m[0].length - 1);
    /* 🔴 경로는 **앞부분이 글자면 읽는다** — `` `/api/piece-photos?pieceId=${id}` `` 처럼 물음표 뒤만 변수인 것은
       «못 읽는 경로»가 아니다. 진짜로 못 읽는 것은 `UI.api(path, …)` 처럼 **통째로 변수**인 것뿐이다.
       (변이 ④ 를 고치면서 한 번에 다 «변수 경로»로 셌더니 틀 안의 멀쩡한 다섯 곳이 빨개졌다 — 거짓 빨강이다.) */
    const pm = args.match(/^\(\s*["'`](\/api\/[A-Za-z0-9_-]+)/);
    /* 🔴 [변이 ④ 가 잡았다 · 2026-09-19] 종전엔 «인자에 `/api/` 글자가 보일 때만» 변수 경로로 셌다.
       그래서 `UI.api(NOTE_PATH, …)` 처럼 **경로가 통째로 변수면 그 짝을 조용히 건너뛰었다** —
       🔴 «못 본다»고 말하지도 않고 초록이 되는, 이 자가 제일 하면 안 되는 모양이다(AC-9 «조용한 초록»).
       ⇒ 이제 **글자로 된 경로가 아니면 무조건** 변수 경로로 센다. 안 보면 안 본다고 말한다. */
    if (!pm) { (rel(f) === "public/js/ui.js" ? frameworkDynamic : dynamicRoutes).push({ screen: rel(f), snip: args.slice(0, 70).replace(/\s+/g, " ") }); continue; }
    /* 🔴 [2026-09-21 · A 의 새 화면이 드러냈다] **바로 윗 주석의 교훈을 몸통에는 안 걸고 있었다.**
       경로가 변수면 «못 본다»고 적으면서, **몸통이 변수면 `continue` 로 조용히 넘겼다** — 같은 병을 한 줄 아래서 저질렀다.
       실제로 새 났다: A 가 `accounts.html` 에 «언제부터 쓰셨어요» 칸을 달고
           `const body = { id, displayName, … };  if (…) body.openedAt = …;  UI.api("/api/accounts-update", { body })`
       로 보냈는데, 이 자는 `body: {` 라는 글자가 없어 **그 짝을 통째로 안 셌다.**
       `accounts-update` 는 `openedAt` 을 **안 읽는다** ⇒ 손님이 적은 날짜가 조용히 버려지는데 **내가 «어긋남 0»이라 적었다.**
       ⇒ ①**변수 몸통을 한 겹 따라간다**(`const body = {…}` + 뒤따르는 `body.키 = …`) ②그래도 못 읽으면 **⊘ 로 적는다.** */
    let bk = bodyKeys(args);
    if (!bk) {
      const vm = args.match(/\bbody\s*:\s*([A-Za-z_$][\w$]*)/) || args.match(/\{[^{}]*\bbody\b\s*[,}]/) ? (args.match(/\bbody\s*:\s*([A-Za-z_$][\w$]*)/) || [, "body"]) : null;
      if (vm) {
        const keys = varObjectKeys(src, vm[1], m.index);
        if (keys.length) bk = { keys, spread: false, viaVar: vm[1] };
        else { unreadableBody.push({ screen: rel(f), route: pm[1], varName: vm[1] }); continue; }
      }
    }
    if (!bk) continue;                       // 몸통이 아예 없는 호출(GET) — 잴 것이 없다
    /* 🔴 **빈 몸통(`{ body: {} }`)은 «못 읽은 것»이 아니라 «보낼 것이 없는 것»이다.**
       처음에 이걸 ⊘ 로 셌더니 거짓 ⊘ 가 일곱 났다(`billing-key-start`·`account-restore`·`notifications-read` …).
       ⊘ 를 부풀리면 «늘 2» 가 되고, 그러면 **진짜 못 잰 자리가 그 속에 묻힌다** — 내가 고치려던 바로 그 병이다(AC-95). */
    if (!bk.keys.length && !bk.spread) continue;
    calls.push({ screen: rel(f), route: pm[1], keys: bk.keys, spread: bk.spread, viaVar: bk.viaVar });
  }
  /* 🔴 `public/js/ui.js` 는 **틀 자신**이다 — `UI.api` 가 거기 산다.
     그 안의 생 `fetch` 넷은 **정당하다**: 셋은 `auth-refresh`(=`UI.api` 가 401 을 만나 부르는 그 장치 자신이라
     `UI.api` 로 부르면 제자리를 돈다) · 하나는 `ops-impersonate-end`(부르자마자 페이지를 떠난다).
     🔴 이걸 빨강으로 세면 **자가 거짓 빨강을 낸다** — 그러면 곧 아무도 이 자의 빨강을 안 본다(AC-95).
     ⇒ **틀을 빼고 화면만** 센다. 틀 안의 것은 빨강이 아니라 **한 줄로 찍는다**(조용히 넘기지 않는다). */
  const isFramework = rel(f) === "public/js/ui.js";
  for (const m of src.matchAll(/fetch\s*\(\s*["'`](\/api\/[^"'`?]+)/g)) (isFramework ? frameworkFetch : rawFetch).push({ screen: rel(f), route: m[1] });
}

/* ═══ ③ 서버가 읽는 키 ═══ */
/** 🔴 **몸통을 받는 함수를 한 겹 따라간다** — 그 함수가 **첫 매개변수에서 읽는 키**를 돌려준다.
    찾는 곳: 그 핸들러 파일 자신 → `lib/**`(import 를 따라가지 않고 이름으로 찾는다 — 이 리포는 이름이 겹치지 않는다).
    🔴 못 찾으면 **null** 이다. «찾은 척»하지 않는다(AC-9). */
const fnDefCache = new Map();
function paramKeysOfFunction(fnName, sameFile) {
  if (fnDefCache.has(fnName)) return fnDefCache.get(fnName);
  const libDir = path.join(ROOT, "lib");
  const cands = [sameFile, ...(existsSync(libDir) ? walk(libDir, /\.ts$/) : [])];
  let found = null;
  for (const f of cands) {
    const src = codeOnly(readFileSync(f, "utf8"));
    const m = src.match(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`));
    if (!m) continue;
    const param = m[1];
    /* 몸통을 중괄호 균형으로 잘라 `param.키` · `param["키"]` · 구조분해를 모은다. */
    const open = src.indexOf("{", m.index + m[0].length);
    if (open < 0) continue;
    let d = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) { end = i; break; } }
    }
    const body = src.slice(open, end < 0 ? src.length : end + 1);
    const keys = new Set();
    for (const km of body.matchAll(new RegExp(`\\b${param}\\.([A-Za-z_$][\\w$]*)`, "g"))) keys.add(km[1]);
    for (const km of body.matchAll(new RegExp(`\\b${param}\\[\\s*["'\`]([^"'\`]+)["'\`]\\s*\\]`, "g"))) keys.add(km[1]);
    for (const km of body.matchAll(/["'`]([A-Za-z_$][\w$]*)["'`]/g)) keys.add(km[1]);   // 화이트리스트 상수
    /* 🔴 **한 겹 더** — `Object.keys(SCHEDULE_DEFAULTS)` 처럼 **상수 객체의 키**로 훑는 자리가 있다.
       `lib/slots.ts:45 sanitizeSchedulePatch` 가 그 모양이라 «읽는 키»가 글자로 안 나온다.
       그 상수를 찾아 키를 끌어온다(같은 파일 안에서만 — 더 멀리 가면 짐작이 된다). */
    for (const om of body.matchAll(/Object\.keys\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const cm = src.match(new RegExp(`(?:export\\s+)?const\\s+${om[1]}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
      if (cm) for (const kk of cm[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(kk[1]);
    }
    if (keys.size) { found = { from: rel(f), keys }; break; }
  }
  fnDefCache.set(fnName, found);
  return found;
}

const blockCache = new Map();
function readKeysFor(route) {
  const file = routeFile.get(route);
  if (!file) return null;
  const key = route;
  if (blockCache.has(key)) return blockCache.get(key);
  const src = codeOnly(readFileSync(file, "utf8"));
  const tail = route.replace(/^\/api/, "");
  /* 🔴 라우트 블록은 **중괄호 균형**으로 자른다 — «다음 `path.endsWith` 까지»로 자르면
     **라우트 블록 «사이»에 있는 공통 코드를 통째로 잃는다.** 이 리포의 실제 모양이 그렇다:
       netlify/functions/pieces.ts:302  const b = await readJson<…>(req);      ← 공통
       netlify/functions/pieces.ts:303  const id = n(b.id); …                  ← 공통
       netlify/functions/pieces.ts:305  if (path.endsWith("/pieces-regenerate")) { …
     🔴 **내가 이 자를 처음 돌렸을 때 바로 이것 때문에 거짓 빨강 50곳을 냈다**(AC-95 «누가 돌려도
     빨강이 쏟아지면 곧 아무도 빨강을 안 본다» · AC-108 «자가 무엇을 안 보는지를 물어라»).
     ⇒ 읽는 키 = **내 블록** ∪ **어느 라우트 블록에도 안 든 공통 코드**. 형제 라우트 블록은 뺀다. */
  const marks = [...src.matchAll(/if\s*\(\s*path\.endsWith\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\)/g)];
  /** `if (…)` 뒤 첫 `{` 부터 짝이 맞는 `}` 까지. 한 줄짜리(중괄호 없음)면 그 줄 끝까지. */
  const blockOf = (m) => {
    const open = src.indexOf("{", m.index + m[0].length - 1);
    const nl = src.indexOf("\n", m.index);
    if (open < 0 || (nl >= 0 && open > nl)) return [m.index, nl < 0 ? src.length : nl];
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) return [m.index, i + 1]; }
    }
    return [m.index, src.length];
  };
  const spans = marks.map((m) => ({ tail: m[1], span: blockOf(m) }));
  /* 🔴 [2026-09-21] **한 경로가 한 파일에 블록 **여럿**일 수 있다 — 첫 것만 보면 나머지를 통째로 잃는다.**
     `pieces.ts` 는 `if (path.endsWith("/pieces-regenerate"))` 가 **두 번** 나온다(351 앞단속 · 395 본일).
     `const note = String(b.note ?? "")` 는 **둘째** 블록(412)에 있는데, 내 자는 첫째만 «내 블록»으로 잡고
     둘째는 **형제 블록으로 오려내** 버렸다 ⇒ `note` 를 «서버가 안 읽는다»로 찍었다.
     🔴 그 빨강을 내가 **진짜라고 메인·A 에 보고했다.** 서버는 처음부터 읽고 있었다 — **내 자가 틀렸다**(AC-112 ⑤).
     ⇒ 같은 꼬리를 가진 블록을 **전부** 내 것으로 삼고, 그 어느 것도 오려내지 않는다. */
  const mines = spans.filter((s) => s.tail === tail);
  const scoped = mines.length > 0;
  /* 공통 코드 = 전체에서 **형제** 블록만 도려낸 것(내 블록들은 전부 남긴다). */
  let shared = "";
  let cur = 0;
  for (const s of spans.slice().sort((a, b) => a.span[0] - b.span[0])) {
    if (s.tail === tail) continue;                         // 내 꼬리의 블록은 하나도 안 도려낸다
    shared += src.slice(cur, s.span[0]);
    cur = s.span[1];
  }
  shared += src.slice(cur);
  /* 🔴 라우트 블록을 못 찾으면 **파일 전체**로 본다 — 느슨한 쪽(거짓 빨강을 안 낸다). */
  const block = scoped ? shared : src;
  /* 🔴 «읽는다»의 모양이 하나가 아니다 — 여섯 가지를 다 센다.
     처음엔 `b.key` 만 셌더니 **정당한 세 패턴이 전부 거짓 빨강**으로 나왔다(실측):
       ① 화이트리스트 상수  `tenant-settings.ts:19 ALLOWED_SETTINGS = new Set(["autoSchedule", …])`
       ② zod 스키마         `ops-auth.ts:19 z.object({ email: …, password: … })` → `parsed.data.email`
       ③ 통째로 넘기기      `sanitizeSchedulePatch(b)` 처럼 몸통을 함수에 넘기는 자리
     ①②는 아래에서 센다. ③은 **못 센다** — 아래 `passthrough` 로 따로 «못 쟀음»에 적는다. */
  const keys = new Set();
  for (const m of block.matchAll(/\bb\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  for (const m of block.matchAll(/\bbody\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  for (const m of block.matchAll(/\bb\[\s*["'`]([^"'`]+)["'`]\s*\]/g)) keys.add(m[1]);
  /* `readJson<{ id?: number; note?: string }>` 의 타입 키도 «읽는다»로 센다(구조분해 대비). */
  for (const m of block.matchAll(/readJson\s*<\s*\{([^}]*)\}/g)) for (const km of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*:/g)) keys.add(km[1]);
  /* 구조분해 `const { id, note } = await readJson…` */
  for (const m of block.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:await\s+)?readJson/g)) for (const km of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) keys.add(km[1]);
  /* ② zod — `z.object({ email: …, password: … })` 의 키 · `parsed.data.email` */
  for (const m of block.matchAll(/z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) for (const km of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(km[1]);
  for (const m of block.matchAll(/\.data\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  /* ① 화이트리스트·분기 목록 — 키 이름이 **글자로** 적혀 있으면 읽는 것으로 본다.
     🔴 느슨한 쪽이다(거짓 빨강보다 거짓 초록을 고른다) — 그 대가는 머리말 «아직 못 하는 것»에 적혀 있다. */
  for (const m of block.matchAll(/["'`]([A-Za-z_$][\w$]*)["'`]/g)) keys.add(m[1]);
  /* ③ 몸통을 통째로 넘기는 자리 — 키 이름이 **여기에는** 안 나온다.
     🔴 **2026-09-19 · «못 쟀음»을 한 겹 따라가서 줄였다.** 그날 B 가 내 ⊘ 중 넷을 열어 봤더니
     **넷이 전부 진짜 고장**이었다(프로모션·쿠폰 저장이 늘 400 · 「끝내기」는 아무 일도 안 났다).
     🔴 **⊘ 는 «괜찮다»가 아니다**(AC-9) — 넷 중 넷으로 증명됐다. 그래서 비켜 가는 폭을 좁힌다.
     이 리포의 모양은 늘 같다: `sanitizeSchedulePatch(b)` · `validateTaxInput(b)` · `parseLimits(b, cur.limits)`.
     ⇒ **몸통을 받는 그 함수를 찾아** 그 함수가 매개변수에서 읽는 키를 여기로 끌어온다(한 겹만).
     🔴 두 겹 이상 넘어가면 그때는 정말 «못 쟀음»이다 — 지어내지 않는다. */
  const passthrough = /\(\s*b\s*[,)]|\bsanitize[A-Za-z]*\(\s*b\b|\.\.\.\s*b\b/.test(block);
  let followed = null;
  if (passthrough) {
    for (const m of block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(\s*b\s*[,)]/g)) {
      const fnName = m[1];
      if (/^(?:if|for|while|switch|return|json|n|String|Number|Boolean|Object|Array)$/.test(fnName)) continue;
      const got = paramKeysOfFunction(fnName, file);
      if (got && got.keys.size) { followed = { fn: fnName, from: got.from, keys: got.keys }; for (const k of got.keys) keys.add(k); break; }
    }
  }
  /* 🔴 서버가 **같은 이름의 값을 스스로 만드는** 자리 — `support.ts:119 const contentType = ext === "png" ? …`.
     화면이 보낸 `contentType` 을 **안 믿고 제가 정한다.** 이건 **고장이 아니라 옳은 판단**이다(클라이언트 말을 믿으면 안 된다).
     ⇒ 빨강으로 세지 않는다. 🔴 다만 **조용히 넘기지도 않는다** — 따로 한 줄 찍는다(안 찍으면 다음 사람이 «왜 통과지?» 한다). */
  const derived = new Set();
  for (const m of block.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) derived.add(m[1]);
  const out = { file: rel(file), keys, scoped, passthrough, derived, followed };
  blockCache.set(key, out);
  return out;
}

/* ═══ ④ 대조 ═══ */
const bad = [];
const unmeasured = [];
const derivedList = [];
/* 🔴 **몸통을 못 읽은 짝도 ⊘ 다** — 조용히 넘기면 «어긋남 0»이 거짓말이 된다.
   🔴 이 줄이 한 번 **안 들어간 채로 있었다**(2026-09-21): 위에서 `unreadableBody` 에 담기까지는 했는데
   여기서 꺼내 쓰는 줄이 빠져서 **담아 놓고 아무도 안 봤다.** 내가 심은 변이(⑤)가 «조용하다»로 떨어져서 알았다 —
   **변이를 안 넣었으면 «담았으니 됐다»고 믿고 넘어갔을 자리**다(AC-108). */
for (const u of unreadableBody) {
  unmeasured.push({ screen: u.screen, route: u.route, why: `몸통이 변수(\`${u.varName}\`)라 보내는 키를 못 읽었다` });
}
let pairs = 0;
for (const c of calls) {
  const server = readKeysFor(c.route);
  if (!server) { unmeasured.push({ ...c, why: "이 경로를 가진 핸들러를 못 찾았다(config.path 누락이면 라이브 404 다)" }); continue; }
  const missing = c.keys.filter((k) => !server.keys.has(k));
  pairs++;
  if (missing.length && server.passthrough && !server.followed) { unmeasured.push({ ...c, why: `몸통을 통째로 넘기는 자리라 키 이름이 코드에 안 나온다(${server.file}) — 안 읽음[${missing.join(",")}] 를 판정 못 한다` }); continue; }
  const derivedHits = missing.filter((k) => server.derived.has(k));
  const realMissing = missing.filter((k) => !server.derived.has(k));
  if (derivedHits.length) derivedList.push({ ...c, server: server.file, derivedHits });
  if (LIST) console.log(`  ${c.route.padEnd(34)} ${c.screen.padEnd(34)} 보냄[${c.keys.join(",")}] ${server.scoped ? "" : "(파일 전체로 봄) "}${missing.length ? "🔴 안 읽음[" + missing.join(",") + "]" : "✓"}`);
  if (realMissing.length) bad.push({ ...c, server: server.file, missing: realMissing, scoped: server.scoped });
  if (c.spread) unmeasured.push({ ...c, why: "`...펼치기` 라 보내는 키 이름을 다 모른다" });
}

/* ═══ ④b 🔴 **되돌아오는 키** — 화면이 읽는 응답 키를 서버가 정말 보내나 ═══
   ④ 는 «보내는 키»(요청)를 쟀다. 여기서는 **반대 방향**을 잰다 — 시나리오 B 가 찾은 아홉 중 **다섯이 이쪽**이었다:
     `ops/tenant.html:55` 이 `r.coinsSplit` 을 읽는데 서버(`ops-tenants.ts:111`)는 `coinDetail` 을 보낸다
     ⇒ 코인 포함/충전 분해가 **영원히 안 뜬다.** 오류도 없고 `ok:true` 다.
   판정: 화면이 읽는 `r.<키>` 는, **그 화면이 부르는 어느 API 든 하나는** 보내야 한다(합집합으로 본다 —
   한 화면이 여러 API 를 부르고 변수 이름이 겹치므로, 좁게 매기면 거짓 빨강이 난다).
   🔴 **못 하는 것**: `r.slots.planned` 처럼 **한 겹 더 들어간 키**는 안 본다(서버가 SQL 별칭으로 만들어
   글자로는 못 따라간다). 그 자리는 시나리오 B 문서가 손으로 적어 두었다. */
const RESPONSE_SKIP = new Set(["ok", "status", "error", "step", "detail", "gated", "json", "text", "length", "map", "filter", "forEach", "slice", "find", "some", "every", "push", "join", "then", "catch"]);
function responseKeysOf(route) {
  const file = routeFile.get(route);
  if (!file) return null;
  const src = codeOnly(readFileSync(file, "utf8"));
  const keys = new Set();
  /* 🔴 **손으로 중괄호를 세는 파서를 버렸다.** 첫 판에서 `json({ ok:true, tenant:t, users, … })` 의 최상위 키를
     제대로 못 뽑아 **거짓 빨강 21화면**을 냈다(`ops/tenant.html` 의 `tenant`·`setup`·`coins` 는 서버가 **보내고 있는데**도).
     🔴 거짓 빨강이 쏟아지면 곧 아무도 이 자의 빨강을 안 본다(AC-95). ⇒ **느슨한 쪽**으로 간다:
     핸들러 파일 안에서 **객체 키로 쓰인 이름**(`키:`)과 **짧은 표기**(`{ a, b }`)를 전부 모은다.
     이 축이 잡으려는 것은 «서버가 **어디에도 그런 이름을 안 쓴다**»이고(`coinsSplit` 처럼), 그건 이걸로 충분히 잡힌다.
     🔴 대가: 같은 이름이 **다른 뜻**으로 파일 어딘가에 있으면 놓친다. 그건 «못 하는 것»에 적어 둔다. */
  /* 🔴 판정을 **«서버가 그 이름을 아예 모른다»** 하나로 좁혔다. 시나리오 B 가 찾은 병이 정확히 그 모양이다 —
     화면이 `r.coinsSplit` 을 읽는데 서버 파일 어디에도 `coinsSplit` 이라는 **글자가 없다**(서버는 `coinDetail` 을 보낸다).
     «최상위 키인가»를 가리려고 두 판을 썼지만 둘 다 거짓 빨강이 쏟아졌다(`json({…})` 안에 중첩 객체가 있어
     블록을 못 자른다). **정확히 가리려다 아무도 안 보는 자가 되느니, 덜 가리고 믿을 수 있는 쪽**을 고른다.
     🔴 대가는 크다 — «보내긴 하는데 **다른 갈래에서만** 보낸다»는 못 잡는다. 머리말에 적어 뒀다. */
  for (const m of src.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) keys.add(m[0]);
  return keys;
}
const respBad = [];
const respUnmeasured = [];
for (const f of walk(PUB, /\.(html|js)$/)) {
  const screen = rel(f);
  if (screen === "public/js/ui.js") continue;              // 틀은 여러 화면을 대신 부른다 — 짝을 못 맨다
  const src = codeOnly(readFileSync(f, "utf8"));
  const routes = [...new Set([...src.matchAll(/UI\.api\s*\(\s*["'`](\/api\/[A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  if (!routes.length) continue;
  const sends = new Set();
  let unknown = false;
  for (const r of routes) { const ks = responseKeysOf(r); if (!ks) { unknown = true; continue; } for (const k of ks) sends.add(k); }
  if (unknown) { respUnmeasured.push({ screen, why: "핸들러를 못 찾은 경로가 섞여 있다" }); continue; }
  /* 🔴 응답 변수를 **실제 대입에서** 찾는다 — 이름을 짐작하면(`r`·`res`·`j`) **DOM 요소를 담은 `r`** 까지 섞여
     `r.innerHTML` 같은 것이 «서버가 안 보내는 키»로 찍힌다(첫 판이 그랬다). `await UI.api(…)` 로 받은 이름만 본다. */
  const respVars = new Set([...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+UI\.api\s*\(/g)].map((m) => m[1]));
  const read = new Set();
  for (const v of respVars) for (const m of src.matchAll(new RegExp(`\\b${v}\\.([A-Za-z_$][\\w$]*)`, "g"))) read.add(m[1]);
  const missing = [...read].filter((k) => !sends.has(k) && !RESPONSE_SKIP.has(k));
  if (missing.length) respBad.push({ screen, routes, missing });
}
/* 🔴 이 축은 «합집합»이라 느슨하다 — 그래도 `coinsSplit` 처럼 **어느 API 도 안 보내는** 키는 잡힌다. */

/* ═══ ⑤ 이 자가 안 보는 자리를 **축으로** 둔다 — 넓어지면 여기가 먼저 운다 ═══ */
const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); return ok; };

console.log(`\n«같은 이름으로 부르나» — 화면이 보내는 키 ↔ 서버가 읽는 키 · ${new Date().toISOString()}`);
console.log("─".repeat(120));
if (LIST) console.log();

rec("🔴 화면이 보내는 키를 서버가 전부 읽는다", bad.length === 0,
  bad.length ? `어긋난 자리 ${bad.length}곳` : `대조한 짝 ${pairs}쌍 · 어긋남 0`);
for (const b of bad) {
  console.log(`   🔴 ${b.route}`);
  console.log(`      화면 ${b.screen} 이 보냄 : [${b.keys.join(", ")}]`);
  console.log(`      서버 ${b.server} 가 안 읽음: [${b.missing.join(", ")}]${b.scoped ? "" : "   (라우트 블록을 못 찾아 파일 전체로 봤다)"}`);
}

if (derivedList.length) {
  console.log(`
△ 보내는데 안 읽는다 — 그런데 서버가 **같은 이름을 스스로 만든다**(클라이언트를 안 믿는 것이 맞다 — 고장 아님):`);
  for (const d of derivedList) console.log(`   · ${d.route} — 화면이 [${d.derivedHits.join(",")}] 을 보내지만 ${d.server} 가 직접 정한다`);
}
/* ═══ ④c 🔴 **한 겹 들어간 응답 키** — 여기는 판정한다 ═══
   ④b(최상위)는 느슨해서 내렸지만, **한 겹 아래**는 서버 쪽 모양을 글자로 정확히 따라갈 수 있다:
     화면 `ops/tenant.html:62` 이 `r.slots.planned` 를 읽는다.
     서버 `ops-tenants.ts:96` 은 `const [slots] = await q(sql`SELECT … AS upcoming, … AS published …`)`.
   ⇒ `planned` 는 **어디에도 없다.** 「편성 예정」이 **늘 0** 으로 뜬다(시나리오 B §4 표 5번).
   🔴 이 모양은 `AS <별칭>` 과 객체 리터럴 키를 읽으면 **틀림없이** 갈린다 — 그래서 «살펴볼 것»이 아니라 **판정**이다.
   못 하는 것: 두 겹 이상(`a.b.c`)·배열 원소(`r.rows[0].x`)는 안 본다. */
const nestedBad = [];
function shapeOfServerLocal(routeFile, name) {
  const src = codeOnly(readFileSync(routeFile, "utf8"));
  /* `const [name] = await q(sql`…`)` 또는 `const name = await q(sql`…`)` → SELECT 의 별칭·칼럼 이름 */
  const sqlM = src.match(new RegExp(`const\\s+\\[?\\s*${name}\\s*\\]?\\s*=\\s*await\\s+q\\(\\s*sql\`([\\s\\S]*?)\``));
  if (sqlM) {
    const keys = new Set();
    for (const m of sqlM[1].matchAll(/\bAS\s+([A-Za-z_][\w]*)/gi)) keys.add(m[1]);
    const selM = sqlM[1].match(/SELECT\s+([\s\S]*?)\s+FROM/i);
    if (selM) for (const km of selM[1].matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:,|$)/gi)) keys.add(km[1]);
    return keys.size ? keys : null;
  }
  /* `const name = { a: …, b: … }` */
  const objM = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\{([^}]*)\\}`));
  if (objM) return new Set([...objM[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));
  return null;
}
for (const f of walk(PUB, /\.(html|js)$/)) {
  const screen = rel(f);
  if (screen === "public/js/ui.js") continue;
  const src = codeOnly(readFileSync(f, "utf8"));
  const respVars = new Set([...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+UI\.api\s*\(/g)].map((m) => m[1]));
  const routes = [...new Set([...src.matchAll(/UI\.api\s*\(\s*["'`](\/api\/[A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  const files = [...new Set(routes.map((r) => routeFile.get(r)).filter(Boolean))];
  if (!files.length) continue;
  for (const v of respVars) {
    for (const m of src.matchAll(new RegExp(`\\b${v}\\.([A-Za-z_$][\\w$]*)\\.([A-Za-z_$][\\w$]*)\\b`, "g"))) {
      const [, parent, child] = m;
      if (RESPONSE_SKIP.has(parent) || RESPONSE_SKIP.has(child)) continue;
      /* 서버 쪽에서 그 이름의 모양을 **읽어낼 수 있을 때만** 판정한다(못 읽으면 조용히 넘어간다 — 거짓 빨강 금지). */
      let shape = null, from = "";
      for (const file of files) { const s = shapeOfServerLocal(file, parent); if (s) { shape = s; from = rel(file); break; } }
      if (!shape) continue;
      if (!shape.has(child)) nestedBad.push({ screen, parent, child, from, has: [...shape].slice(0, 6) });
    }
  }
}
rec("🔴 한 겹 들어간 응답 키도 이름이 맞는다(`r.슬롯.예정` 같은 자리)", nestedBad.length === 0,
  nestedBad.length ? `어긋난 자리 ${nestedBad.length}곳` : "한 겹 아래까지 이름이 맞는다");
for (const b of nestedBad) {
  console.log(`   🔴 ${b.screen} 이 \`${b.parent}.${b.child}\` 를 읽는다`);
  console.log(`      서버 ${b.from} 의 \`${b.parent}\` 가 가진 이름: [${b.has.join(", ")}] — \`${b.child}\` 는 없다`);
}

/* 🔴 **되돌아오는 방향(최상위)은 «살펴볼 것»으로 내린다 — 판정하지 않는다.**
   세 판을 고쳐 봤지만(최상위 키 파싱 → 느슨한 키 모음 → 응답 변수 묶기) **믿을 만큼 좁혀지지 않았다**:
   진짜 둘(`coinsSplit`·`notes`)은 매번 잡히는데, 중첩 접근(`r.slots[i].topicTitle`)과
   갈래마다 다른 응답 모양 때문에 **거짓 빨강이 계속 섞인다.**
   🔴 이걸 빨강으로 게이트하면 **이 자 전체가 못 믿을 것이 된다**(AC-95) — 잘 선 요청 축까지 같이 죽는다.
   ⇒ **찍기는 하되 판정에서 뺀다.** 여기 있는 것은 «틀렸다»가 아니라 «**사람이 한 번 봐야 한다**»다.
   🔴 이 축을 판정으로 올리는 것이 다음 사람의 몫이고, **올리기 전에는 «못 쟀음»이다**(AC-9). */
if (respBad.length) {
  console.log(`\n△ 살펴볼 것 — 화면이 읽는데 **서버 파일에 그 이름이 아예 없는** 응답 키(판정 아님 · 사람이 본다):`);
  for (const b of respBad) console.log(`   · ${b.screen}  [${b.missing.join(", ")}]`);
  console.log(`   🔴 이 중 확인된 진짜: public/ops/tenant.html 의 \`coinsSplit\`(서버는 \`coinDetail\`) · \`notes\`(서버는 \`note\`)`);
}

rec("화면은 경로를 글자로 적는다(변수로 만들면 이 자가 못 본다 · 틀 `ui.js` 는 제외)", dynamicRoutes.length === 0,
  dynamicRoutes.length
    ? `화면 변수 경로 ${dynamicRoutes.length}곳 — ${dynamicRoutes.map((d) => `${d.screen}: ${d.snip}`).join(" / ")}`
    : `화면 변수 경로 0곳 (틀 ui.js 안 ${frameworkDynamic.length}곳은 정당: \`UI.api(path, …)\` = 401 뒤 제자신 재시도)`);
rec("화면은 `UI.api` 로만 부른다(생 `fetch` 는 401·게이트 처리를 건너뛴다 · 틀 `ui.js` 는 제외)", rawFetch.length === 0,
  rawFetch.length
    ? `화면 생 fetch ${rawFetch.length}곳 — ${[...new Set(rawFetch.map((r) => r.screen))].join(", ")}`
    : `화면 생 fetch 0곳 (틀 ui.js 안 ${frameworkFetch.length}곳은 정당: ${[...new Set(frameworkFetch.map((r) => r.route))].join(", ")})`);

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
for (const o of out) console.log(`  ${o.ok ? "✓" : "✗"} ${o.step}  — ${o.note}`);
/* 🔴 [2026-09-21] **이 자가 «늘 종료코드 2» 였다**(A 가 짚었다).
   `exit(fails ? 1 : unmeasured ? 2 : 0)` 인데 ⊘ 가 상시로 있어서, **어긋난 자리가 0 이어도 언제나 2** 였다.
   ⇒ 늘 2 인 자는 곧 아무도 안 읽는다(AC-95 — 오늘 `verify-api-surface` 에서 고친 그 모양).
   🔴 **⊘ 를 없애서 고치는 게 아니다.** ⊘ 는 그대로 ⊘ 라고 찍는다(AC-9). 바꾼 것은 **종료코드가 무엇을 가리키나**다:
     · «아직 **아무도 안 본** 자리»가 있으면 → **2**(할 일이 있다 · 줄어들 수 있는 수다)
     · 남은 ⊘ 가 전부 «사람이 열어 보고 적어 둔 것»이면 → **0**(자는 여전히 못 쟀다고 찍는다)
   🔴 «적어 두면 조용해진다»가 아니다 — 기록에는 **무엇을 봤나**가 있어야 하고,
      `key-contract-reviewed.json` 의 규율대로 **보내는 키가 달라지면 그 확인은 만료된다.**
      아래 ⓐ 가 그 만료를 실제로 재서, 지문이 바뀌면 **다시 «아무도 안 봤다»로 되돌린다.** */
let reviewed = [];
try { reviewed = JSON.parse(readFileSync(path.join(ROOT, "docs", "rules", "key-contract-reviewed.json"), "utf8")).확인 ?? []; } catch { /* 없으면 전부 ⊘ */ }
/** ⓐ 그 기록이 **지금도 유효한가** — 적어 둔 지문(보낸 키 목록)이 지금 보내는 키와 같아야 한다. */
const reviewOf = (u) => {
  const r = reviewed.find((x) => x.경로 === u.route && x.화면 === u.screen);
  if (!r) return null;
  const want = Array.isArray(r.보낸키) ? r.보낸키.join(",") : String(r.보낸키 ?? "");
  const now = Array.isArray(u.keys) ? u.keys.join(",") : (u.why.includes("펼치기") ? "...펼치기" : `변수:${u.why}`);
  if (want && want !== "...펼치기" && want !== now) return { ...r, 만료: `적어 둘 땐 [${want}] · 지금은 [${now}]` };
  return r;
};
const unseen = [];
if (unmeasured.length) {
  console.log(`\n⊘ 못 쟀음 ${unmeasured.length}곳 — **자가 잰 것이 아니다**(AC-9):`);
  for (const u of unmeasured) {
    const r = reviewOf(u);
    console.log(`   · ${u.route} (${u.screen}) — ${u.why}`);
    if (r && !r.만료) console.log(`     ↳ ● 사람이 열어 봤다: ${r.본사람} · ${r.언제} — ${r.무엇을봤나}`);
    else if (r && r.만료) { unseen.push(u); console.log(`     ↳ 🔴 **그 확인은 만료됐다** — ${r.만료}. 다시 열어 보고 적어라`); }
    else { unseen.push(u); console.log("     ↳ 🔴 **아직 아무도 안 열어 봤다** — 열어 보고 docs/rules/key-contract-reviewed.json 에 적어라"); }
  }
  console.log(`\n   ■ 그중 **아직 아무도 안 본 것 ${unseen.length}곳** · 사람이 보고 적어 둔 것 ${unmeasured.length - unseen.length}곳`);
  console.log("   🔴 종료코드는 **앞의 수**만 가리킨다 — 뒤의 것도 «자가 쟀다»는 아니다(그래서 ⊘ 칸에 그대로 둔다).");
}
console.log(`\nPASS ${out.length - fails.length} · FAIL ${fails.length} · 대조한 짝 ${pairs}쌍 · ⊘ ${unmeasured.length}(안 본 것 ${unseen.length})`);
console.log("🔴 이 자는 «보내는 키»만 잰다 — 되돌아오는 응답 키는 안 본다(머리말 «아직 못 하는 것»).\n");
process.exit(fails.length ? 1 : unseen.length ? 2 : 0);
