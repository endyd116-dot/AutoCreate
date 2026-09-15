/**
 * lib/photo-source.ts — **사진이 어디서 왔나**(R8 §5D.4 · §5C.5 · B-1 2026-09-15). 순수 리프(DB·네트워크 0).
 *
 *   ══ 왜 한 파일인가 ══
 *     사진이 오는 길은 셋인데(**내 사진** · **스톡** · **AI**) 적는 자리가 갈리면 나중에 아무것도 못 찾는다.
 *     세 길 다 `piece_assets.meta.source` **한 칸**에 같은 모양으로 적는다.
 *
 *   ══ 🔴 되짚기(역방향)가 이 파일의 핵심이다 ══
 *     «이 사진이 문제다»라는 통지는 **사진 한 장**을 가리키며 온다. 그때 우리는 **그 사진이 들어간 글을 전부** 찾아야 한다.
 *     출처만 적고 열쇠가 없으면 그때 못 찾는다(메인 지시 2026-09-15).
 *     그래서 `source.key` 는 **같은 사진이면 같은 값**이다 — 내 사진은 **바이트 해시**, 스톡은 **제공사:id**, AI 는 **모델:ref**.
 *     찾는 것은 `piecesUsingSource()`(DB 쪽 · `lib/piece-photos.ts`)가 이 열쇠로 한다.
 *
 *   ══ 🔴 모르는 것은 «모른다»로 적는다 ══
 *     사람·상표 여부(`people`·`brand`)는 **제공사가 명시할 때만** 값을 적는다. 짐작해서 `false` 를 적으면
 *     그 한 줄이 라이선스 위반을 통과시킨다(AC-57 · B3 `lib/stock-safety.ts` 규약).
 *   🔎 출처: AC 신규(DESIGN §5D.4 · §5C.5 · B-1 · 2026-09-15) — AM 원본 없음.
 */

export type PhotoSourceKind = "customer" | "stock" | "ai";

export interface PhotoSource {
  kind: PhotoSourceKind;
  /** 🔴 되짚기 열쇠 — 같은 사진이면 같은 값. `customer:sha256:…` · `stock:pixabay:123` · `ai:<model>:<ref>`. */
  key: string;
  /** 언제 이 글에 붙었나(ISO UTC · 표시는 KST 로 · §4.5b). */
  addedAt: string;
  /** 올린 사람(내 사진일 때만) — 누가 올렸는지는 침해 통지 때 첫 질문이다. */
  by?: number | null;
  filename?: string;
  bytes?: number;
  mime?: string;
}

/** 내 사진 — **바이트 해시**가 열쇠다(같은 파일을 여러 글에 올려도 하나로 묶인다 · 파일 이름은 못 믿는다). */
export function customerSourceKey(sha256hex: string): string { return `customer:sha256:${String(sha256hex).slice(0, 64)}`; }
/** 스톡 — 제공사와 제공사 id. 같은 사진을 다른 글이 써도 같은 값이라 통지 한 건으로 전부 찾는다. */
export function stockSourceKey(provider: string, id: string | number): string { return `stock:${String(provider).toLowerCase()}:${String(id)}`; }
/** AI — 우리가 구운 것. 열쇠가 겹칠 일은 없지만 **같은 칸에 적어야** 되짚기가 한 길이 된다. */
export function aiSourceKey(model: string, ref: string): string { return `ai:${String(model)}:${String(ref).slice(0, 80)}`; }

/** 열쇠 모양 검사 — 되짚기 API 가 아무 문자열이나 받지 않게. */
export function isSourceKey(v: unknown): v is string {
  return typeof v === "string" && /^(customer:sha256:[0-9a-f]{16,64}|stock:[a-z0-9_]+:[A-Za-z0-9_-]{1,64}|ai:[A-Za-z0-9._-]{1,60}:.{1,80})$/.test(v);
}

/**
 * [B3 `lib/stock-safety.ts` 규약] 스톡 사진 한 장의 라이선스 재료.
 *   🔴 `people`·`brand` 는 **`null` 이 기본**이다 — «모른다»와 «없다»는 다르다.
 */
export interface StockMeta {
  provider: "pixabay" | "pexels";
  id: string;
  author?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  /** 사람이 찍혀 있나 — 제공사가 말해 줄 때만 true/false. 모르면 **null**. */
  people: boolean | null;
  /** 상표·로고가 있나 — 위와 같다. */
  brand: boolean | null;
  tags?: string[];
}

/**
 * 글 하단 «사진 출처» 한 줄 — 크레딧 의무가 있는 제공사가 있다(Pexels: Pexels 로 가는 링크 + 작가 · Pixabay: 어디서 왔는지).
 *   🔴 **내 사진과 AI 사진은 줄을 만들지 않는다**(`null`) — 없는 출처를 지어내지 않는다.
 *   여러 장이면 호출부가 모아 한 블록으로 만든다(같은 사진 한 번만).
 */
export function creditLineOf(src: PhotoSource | null | undefined, stock: StockMeta | null | undefined): string | null {
  if (!src || src.kind !== "stock" || !stock) return null;
  const who = String(stock.author ?? "").trim();
  const where = stock.provider === "pexels" ? "Pexels" : stock.provider === "pixabay" ? "Pixabay" : String(stock.provider);
  const url = String(stock.sourceUrl ?? "").trim();
  const head = who ? `${who} · ${where}` : where;
  return url ? `${head} (${url})` : head;
}

/** 크레딧 줄 여러 개 → 중복 없이 한 벌(순서 유지 — 글에 나온 순서가 사람이 읽는 순서다). */
export function creditLines(items: { source?: PhotoSource | null; stock?: StockMeta | null }[]): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const it of items) {
    const line = creditLineOf(it.source, it.stock);
    if (!line || seen.has(line)) continue;
    seen.add(line); out.push(line);
  }
  return out;
}

/** 저장된 jsonb → `PhotoSource`(모양이 아니면 null · 옛 행엔 없다). */
export function sourceFromMeta(v: unknown): PhotoSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  if (kind !== "customer" && kind !== "stock" && kind !== "ai") return null;
  if (typeof o.key !== "string" || !o.key) return null;
  return {
    kind, key: o.key, addedAt: String(o.addedAt ?? ""),
    ...(o.by === null || typeof o.by === "number" ? { by: o.by as number | null } : {}),
    ...(typeof o.filename === "string" ? { filename: o.filename } : {}),
    ...(typeof o.bytes === "number" ? { bytes: o.bytes } : {}),
    ...(typeof o.mime === "string" ? { mime: o.mime } : {}),
  };
}

/* ═══════════ 올리는 파일 검사 — 🔴 «확장자와 Content-Type 은 못 믿는다» ═══════════ */

/** 받는 형식 — 세 가지뿐(에디터가 확실히 받는 것). HEIC·GIF·SVG 는 받지 않는다(SVG 는 스크립트가 들어간다). */
export const ALLOWED_IMAGE_MIME: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** 한 장 상한 — 서버리스 본문 한도(≈6MB)와 base64 팽창(4/3)을 함께 본 값. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/**
 * 파일 **첫 바이트**로 형식을 판정한다 — 확장자·Content-Type 은 보내는 쪽이 정하는 값이라 못 믿는다.
 *   맞지 않으면 null(그때는 받지 않는다). 셋 다 시그니처가 또렷해서 이 검사만으로 충분하다.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** 사람에게 보여 줄 거절 사유 — 화면이 그대로 쓴다(시스템 용어 금지 · §3). */
export function photoRejectReason(code: "too_big" | "bad_type" | "empty"): string {
  if (code === "too_big") return `사진 한 장은 ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))}MB까지 올릴 수 있어요. 조금 줄여서 다시 올려 주세요.`;
  if (code === "bad_type") return "JPG·PNG·WEBP 사진만 올릴 수 있어요.";
  return "사진 파일이 비어 있어요.";
}
