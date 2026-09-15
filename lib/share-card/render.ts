/**
 * lib/share-card/render.ts — 결과 공유 카드 **서버 렌더**(계약 P1R6 §2.2 · 화면 canvas 합성 금지).
 *
 *   왜 서버인가: 화면에서 canvas 로 합성하면 ①기기·폰트에 따라 글자가 달라지고 ②숫자를 클라이언트가 그린다(고칠 수 있다).
 *   자랑용 이미지는 **우리가 낸 값**이어야 한다.
 *
 *   🔴 **기본은 금액 + 기간 + 우리 브랜드뿐이다.** 핸들·채널 이름은 **꺼짐이 기본**(§2.2 · DESIGN §16·§7.3) —
 *      핸들이 박힌 이미지를 올리는 건 «이 계정은 자동화로 돌아간다»를 공개 게시하는 것과 같다. 켜는 건 사용자의 명시적 선택.
 *   🔴 래스터라이저는 **이 파일의 `toPng` 하나 뒤**에 있다 — 바꿀 일이 생기면 그 함수 본문만 바꾼다(호출부·API·화면 무변경).
 *      Netlify 리눅스 컨테이너엔 한글 글꼴이 없다 → `loadSystemFonts:false` + 우리 OTF 만(없으면 전부 네모).
 *      번들 설정은 `netlify.toml`(`external_node_modules` + `[functions."share-card"] included_files`) — 메인이 넣었다.
 *   🔎 출처: AC 신규(계약 P1R6-B-1 §2.2 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const CARD_W = 1080;
export const CARD_H = 1080;

export interface CardInput {
  /** «2026-09» — 카드에 «9월» 로 쓴다. */
  month: string;
  amountKrw: number;
  /** 지난달 대비(원) — 0 이거나 없으면 안 그린다(없는 자랑을 만들지 않는다). */
  deltaKrw?: number;
  /** 켜면 계정 핸들이 보인다(기본 꺼짐). */
  handles?: string[];
  /** 켜면 채널 이름이 보인다(기본 꺼짐). */
  channels?: string[];
  brand?: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
/** «2026-09» → «9월» · 이상하면 그대로. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  return m ? `${Number(m[2])}월` : String(month ?? "");
}

/** 폰트 파일 경로(번들에 included_files 로 실린다 · 없으면 null → 시스템 폰트로 떨어진다). */
export function fontFiles(): string[] {
  const roots = [process.cwd(), path.resolve(process.cwd(), "..")];
  const names = ["Pretendard-Regular.otf", "Pretendard-Bold.otf"];
  const found: string[] = [];
  for (const n of names) for (const r of roots) {
    const p = path.join(r, "assets", "fonts", n);
    if (existsSync(p)) { found.push(p); break; }
  }
  return found;
}

/** 카드 SVG — 헌장 §13.0(색 3개 · 숫자 1개 · 설명 한 문장). 광고 문구·과장 0. */
export function cardSvg(a: CardInput): string {
  const brand = esc(a.brand || "AutoCreate");
  const label = esc(monthLabel(a.month));
  const amount = esc(won(a.amountKrw));
  const lines: string[] = [];
  // 배경 — 한 방향 그라데이션 대신 단색 + 은은한 원 하나(그라데이션 히어로 금지 · CLAUDE §3)
  lines.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#0F1115"/>`);
  lines.push(`<circle cx="${CARD_W - 120}" cy="140" r="260" fill="#1B6EF3" opacity="0.14"/>`);

  /* 세로 배치 — 내용 높이를 재고 **위 여백과 아래 여백이 같게** 놓는다.
     (고정 y 로 찍으면 칩이 없는 기본 카드가 «가운데가 텅 빈» 그림이 된다 — 실측으로 잡았다.) */
  const chips = [...(a.channels ?? []), ...(a.handles ?? [])].filter(Boolean).slice(0, 6);
  /* 칩 폭 — 한글은 라틴보다 훨씬 넓다(32px 글씨에서 한글 ≈ 32px · 영문/숫자 ≈ 17px).
     한 계수로 재면 «네이버 블로그» 가 알약 밖으로 삐져나온다(실측으로 잡았다). 글자 종류별로 센다. */
  const textW = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? size : /\s/.test(ch) ? size * 0.3 : size * 0.53), 0);
  const chipW = (c: string) => Math.min(460, 48 + Math.ceil(textW(String(c).slice(0, 18), 32)));
  let chipRows = 0;
  if (chips.length) { let x = 88; chipRows = 1; for (const c of chips) { const w = chipW(c); if (x + w > CARD_W - 88) { x = 88; chipRows++; } x += w + 16; } }
  const hasDelta = !!(a.deltaKrw && a.deltaKrw !== 0);
  const blockH = 240 + (hasDelta ? 96 : 0) + (chipRows ? chipRows * 84 + 24 : 0);
  const top = 120, bottom = CARD_H - 190;                       // 위 안전 여백 · 아래는 브랜드 줄 위까지
  let y = Math.max(top + 44, Math.round((top + bottom - blockH) / 2) + 44);

  lines.push(`<text x="88" y="${y}" font-family="Pretendard" font-weight="700" font-size="44" fill="#8A93A6">${label}에</text>`);
  lines.push(`<text x="88" y="${y + 160}" font-family="Pretendard" font-weight="700" font-size="132" fill="#FFFFFF">${amount}</text>`);
  lines.push(`<text x="88" y="${y + 240}" font-family="Pretendard" font-weight="400" font-size="42" fill="#8A93A6">벌었어요</text>`);
  y += 240;
  if (hasDelta) {
    const up = a.deltaKrw! > 0;
    y += 96;
    lines.push(`<text x="88" y="${y}" font-family="Pretendard" font-weight="400" font-size="38" fill="${up ? "#33C08A" : "#8A93A6"}">지난달보다 ${esc(won(Math.abs(a.deltaKrw!)))} ${up ? "늘었어요" : "줄었어요"}</text>`);
  }
  // 🔴 핸들·채널은 **켰을 때만**. 기본 카드에는 계정을 식별할 것이 하나도 없다.
  if (chips.length) {
    y += 108;
    let x = 88;
    for (const c of chips) {
      const text = esc(String(c).slice(0, 18));
      const w = chipW(c);
      if (x + w > CARD_W - 88) { x = 88; y += 84; }
      lines.push(`<rect x="${x}" y="${y - 44}" rx="28" ry="28" width="${w}" height="60" fill="#FFFFFF" opacity="0.08"/>`);
      lines.push(`<text x="${x + 22}" y="${y}" font-family="Pretendard" font-weight="400" font-size="32" fill="#C9D1DE">${text}</text>`);
      x += w + 16;
    }
  }
  lines.push(`<rect x="88" y="${CARD_H - 150}" width="${CARD_W - 176}" height="1" fill="#FFFFFF" opacity="0.12"/>`);
  lines.push(`<text x="88" y="${CARD_H - 84}" font-family="Pretendard" font-weight="700" font-size="36" fill="#FFFFFF">${brand}</text>`);
  lines.push(`<text x="${CARD_W - 88}" y="${CARD_H - 84}" text-anchor="end" font-family="Pretendard" font-weight="400" font-size="30" fill="#8A93A6">${esc(a.month)} (KST)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${lines.join("")}</svg>`;
}

export interface RenderedCard { bytes: Buffer; contentType: string; ext: string }

/**
 * toPng — 🔴 **래스터라이저는 여기 한 곳**. SVG 를 PNG 로 굽는다.
 *   `loadSystemFonts:false` 인 이유: Netlify 컨테이너에 한글 글꼴이 없어서 시스템 폰트를 믿으면 **전부 네모**로 나온다.
 *   폰트를 못 찾으면(로컬 개발 등) 시스템 폰트로 떨어뜨리되 **조용히 넘어가지 않고** 로그로 알린다.
 */
export async function toPng(svg: string): Promise<RenderedCard> {
  const { Resvg } = await import("@resvg/resvg-js");
  const files = fontFiles();
  if (!files.length) console.warn("[share-card] Pretendard OTF 를 찾지 못했습니다 — 시스템 폰트로 굽습니다(한글이 깨질 수 있습니다)");
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_W },
    font: { fontFiles: files, loadSystemFonts: files.length === 0, defaultFontFamily: "Pretendard" },
  });
  return { bytes: Buffer.from(r.render().asPng()), contentType: "image/png", ext: "png" };
}

/** 카드 한 장(입구 하나). */
export async function renderCard(a: CardInput): Promise<RenderedCard> { return await toPng(cardSvg(a)); }
