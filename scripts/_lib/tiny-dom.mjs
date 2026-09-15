/**
 * scripts/_lib/tiny-dom.mjs — **셈 DOM**(검사 전용 · 의존성 0).
 *
 * 🔴 왜 jsdom 이 아닌가: AM 하니스는 jsdom 으로 `measureFormatBleed` 를 실제로 돌린다(글자 검사로는
 *    `(true || …)` 같은 무력화를 못 본다 — AM 이 실제로 m6 에서 그렇게 새어 나갔다). 우리 리포에는 jsdom 이 **없다**.
 *    `measureFormatBleedIn` 이 쓰는 DOM 표면은 **여섯 개뿐**이라(querySelectorAll · closest · textContent ·
 *    getComputedStyle 의 네 속성) 의존성을 늘리는 대신 그만큼만 만든다.
 *
 * 🔴 **조용히 빈 배열을 돌려주지 않는다.** 모르는 셀렉터를 만나면 **던진다**(AC-58: 검사의 삼킴은 판정 전체를 뒤집는다).
 *    「셀렉터가 안 맞아 0개」와 「진짜로 0개」는 다른 사실이고, 이 파일이 둘을 섞으면 하니스가 영원히 초록이 된다.
 *
 * 🔴 **이 파일 자체를 대조군으로 잰다** — 하니스가 첫 축에서 «이 DOM 이 빨강을 빨강이라 말하는가»를 먼저 확인하고서야
 *    나머지 판정을 믿는다. 자를 안 재고 쓰면 그게 AC-78 의 문서판이다.
 */

/** 노드 하나. `style` 은 «계산된 값»을 직접 준다(상속·캐스케이드는 흉내 내지 않는다 — 검사에 필요 없다). */
export function el(tag, opts = {}) {
  const node = {
    tag: String(tag),
    className: String(opts.cls ?? ""),
    style: { color: "rgb(0, 0, 0)", textAlign: "left", fontStyle: "normal", textDecorationLine: "none", ...(opts.style ?? {}) },
    text: String(opts.text ?? ""),
    children: [],
    parent: null,
  };
  for (const c of opts.children ?? []) { c.parent = node; node.children.push(c); }
  Object.defineProperty(node, "textContent", { get() { return nodeText(node); } });
  node.closest = (sel) => closest(node, sel);
  node.querySelectorAll = (sel) => queryAll(node, sel);
  return node;
}

function nodeText(n) {
  if (!n.children.length) return n.text;
  return n.children.map(nodeText).join("");
}

/** `.a.b` 또는 `tag` 하나. 그 밖의 문법(속성·`>`·`,`)은 **던진다** — 쓰는 순간 알아채라고. */
function matchSimple(node, sel) {
  if (sel.startsWith(".")) {
    const want = sel.slice(1).split(".").filter(Boolean);
    const have = new Set(node.className.split(/\s+/).filter(Boolean));
    return want.every((w) => have.has(w));
  }
  if (/^[a-zA-Z][\w-]*$/.test(sel)) return node.tag === sel;
  throw new Error(`tiny-dom: 모르는 셀렉터 조각 «${sel}» — 조용히 0개를 돌려주지 않는다(AC-58). 필요하면 여기를 늘려라.`);
}

function closest(node, sel) {
  const parts = sel.trim().split(/\s+/);
  if (parts.length !== 1) throw new Error(`tiny-dom: closest 는 조각 하나만 받는다 — «${sel}»`);
  for (let n = node; n; n = n.parent) if (matchSimple(n, parts[0])) return n;
  return null;
}

/** 후손 조합자(공백)만. `root` 자신은 후보에서 뺀다(브라우저와 같다). */
function queryAll(root, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!parts.length || !parts[0]) throw new Error("tiny-dom: 빈 셀렉터");
  let pool = descendants(root);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) { pool = pool.filter((n) => matchSimple(n, part)); continue; }
    const next = [];
    for (const anc of pool) for (const d of descendants(anc)) if (matchSimple(d, part) && !next.includes(d)) next.push(d);
    pool = next;
  }
  return pool;
}

function descendants(node) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
  walk(node);
  return out;
}

/** `document` 대역 — 루트를 감싸 `querySelectorAll` 만 준다(측정 함수가 쓰는 건 그것뿐이다). */
export function makeDocument(children) {
  const root = el("body", { children });
  return { querySelectorAll: (sel) => queryAll(root, sel), root };
}

/** `getComputedStyle` 대역 — 노드가 들고 있는 계산값을 그대로 준다. */
export const getComputedStyle = (n) => n.style;

/* ─────────── 자주 쓰는 조각(하니스가 읽기 쉽게) ─────────── */

const RED = "rgb(255, 0, 16)";      // #ff0010 — 우리 강조 팔레트의 빨강
const BLACK = "rgb(0, 0, 0)";

/**
 * 문단 한 개(=`.se-component.se-text` 안의 `.se-text-paragraph`).
 *   🔴 **문단 스타일과 span 스타일을 갈라 받는다** — 측정 함수가 정렬(`textAlign`)은 **문단**에서 보고
 *      색·기울임·밑줄은 **span 전부**에서 본다. 한 덩어리로 주면 «부분 강조는 정상»을 못 잰다.
 * @param opts {{ p?: object, spans?: object[] }}
 */
export function para(text, opts = {}) {
  const spanStyles = opts.spans && opts.spans.length ? opts.spans : [{}];
  const chunk = Math.ceil(text.length / spanStyles.length);
  const spans = spanStyles.map((st, i) => el("span", { style: st, text: text.slice(i * chunk, (i + 1) * chunk) }));
  return el("p", { cls: "se-text-paragraph", style: opts.p ?? {}, children: spans });
}

export const textComponent = (paras) => el("div", { cls: "se-component se-text", children: paras });
export const quotation = (paras) => el("div", { cls: "se-component se-quotation", children: [el("blockquote", { children: [textComponent(paras)] })] });
export const documentTitle = (paras) => el("div", { cls: "se-component se-text se-documentTitle", children: paras });

export const STYLE = {
  plain: {},
  red: { color: RED },
  black: { color: BLACK },
  center: { textAlign: "center" },
  italic: { fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
  quote: { color: RED, textAlign: "center", fontStyle: "italic" },
};
