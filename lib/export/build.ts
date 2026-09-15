/**
 * lib/export/build.ts — 내보내기 ZIP 을 실제로 만든다(계약 P1R6 §2.1).
 *   흐름: 기간 안의 것을 모아 → `ZipWriter` 로 흘리고 → `R2MultipartSink` 가 8MB 씩 R2 에 올린다 → presigned 7일.
 *
 *   🔴 **타 테넌트 자산 0**: 모든 SELECT 에 `tenant_id = tid` 가 있고, 자산은 **piece 를 거쳐서만** 집는다
 *      (`piece_assets` 에도 `tenant_id` 조건을 따로 건다 — 두 겹). R2 키를 바깥에서 받지 않는다.
 *   🔴 **용량 상한**(플랜별): 추정하지 않고 **쓰면서 센다**. 넘으면 그 자리에서 «기간을 좁혀 주세요» 로 멈추고
 *      멀티파트를 지운다(추정은 늘 틀리고, 틀리면 15분을 버린 뒤 실패한다).
 *   🔴 **시간 예산**: `EXPORT_BUDGET_MS`(11분)를 넘기면 같은 문장으로 멈춘다 — 15분 벽에 잘려 조용히 사라지지 않게.
 *   시각은 전부 KST 표기(§4.5b) · CSV 헤더에 «(KST)».
 *   🔎 출처: AC 신규(계약 P1R6-B-1 §2.1 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { r2Get, r2PresignGet } from "../r2";
import { tenantPlan } from "../plans";
import { normalizeBlocks, type Block } from "../blocks";
import { utcDate } from "../db-util";
import { ZipWriter } from "./zip";
import { R2MultipartSink } from "./r2-multipart";
import { blocksToMarkdown, frontMatter, type MdImage } from "./markdown";
import { EXPORT_BUDGET_MS, stampProgress, type ExportKind } from "./state";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** presigned GET 유효기간(계약 §2.1 «7일») — S3 SigV4 상한도 7일이라 이보다 길게는 못 준다. */
export const EXPORT_URL_TTL_SEC = 7 * 24 * 3600;

/**
 * 플랜별 ZIP 용량 상한(바이트). 왜 이 값인가: 배경 함수 15분 안에 **R2 에서 받아 다시 올릴 수 있는 양**이 실질 상한이다
 * (용량이 아니라 시간이 먼저 걸린다). 넉넉히 두고 시간 예산이 실제 브레이크 역할을 한다.
 * 운영에서 조이려면 env 로 덮는다.
 */
export const EXPORT_MAX_BYTES: Readonly<Record<string, number>> = {
  trial: 200 * 1024 * 1024, starter: 500 * 1024 * 1024, pro: 1024 * 1024 * 1024, agency: 2048 * 1024 * 1024,
};
export function exportCapBytes(planKey: string): number {
  const env = Number(process.env.EXPORT_MAX_BYTES);
  if (Number.isFinite(env) && env > 0) return env;
  return EXPORT_MAX_BYTES[planKey] ?? EXPORT_MAX_BYTES.trial;
}
const mb = (b: number) => `${Math.round(b / (1024 * 1024))}MB`;

/** KST 문자열(파일명·프런트매터·CSV 공용). */
const kst = (d: Date | null | undefined, withTime = true): string => {
  if (!d || Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (x: number, w = 2) => String(x).padStart(w, "0");
  const day = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
  return withTime ? `${day} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}` : day;
};
/* 🔴 `timestamp without tz` 는 postgres-js 가 **문자열**로 준다 — `new Date(문자열)` 은 그걸 **로컬 시각**으로 읽는다(PITFALLS #4).
   KST(+9) 머신에서 9시간 뒤로 밀려 **폴더 날짜가 하루 어긋났다**(실측: 09-15 자료가 `2026-09-14_…` 로 나왔다).
   정본 파서는 `lib/db-util.ts utcDate` 하나다 — 손으로 다시 짜지 않는다. */
const asDate = utcDate;

/** 파일명에 쓸 수 없는 글자만 걷어낸다(한글·공백은 남긴다 — 사람이 열어 보는 이름이다). */
function safeName(s: unknown, cap = 60): string {
  return String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap) || "제목없음";
}
const extOf = (key: string, fallback: string) => (key.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? fallback).toLowerCase();

export interface BuildInput { tenantId: number; kinds: ExportKind[]; from: string; to: string }
export interface BuildResult { key: string; url: string; expiresAt: string; bytes: number; files: number }

export async function buildExport(inp: BuildInput): Promise<BuildResult> {
  const { tenantId: tid, kinds, from, to } = inp;
  const t0 = Date.now();
  const { planKey } = await tenantPlan(tid);
  const cap = exportCapBytes(planKey);
  const stamp = `${kst(new Date(), false).replace(/-/g, "")}-${Date.now().toString(36)}`;
  const key = `autocreate/${tid}/export/${stamp}.zip`;

  const sink = new R2MultipartSink(key);
  await sink.start();
  const zip = new ZipWriter(sink.write);
  const manifest: Record<string, unknown> = {
    generatedAt: `${kst(new Date())} (KST)`, tenantId: tid, plan: planKey,
    range: { from, to, note: "날짜는 KST 기준입니다" }, kinds, contents: {} as Record<string, unknown>,
  };
  const overCap = () => sink.bytes > cap;
  const overTime = () => Date.now() - t0 > EXPORT_BUDGET_MS;
  const stopIfOver = () => {
    if (overCap()) throw new Error(`자료가 ${mb(cap)} 를 넘어요 — 기간을 좁혀 주세요.`);
    if (overTime()) throw new Error("자료가 많아 시간 안에 다 담지 못했어요 — 기간을 좁혀 주세요.");
  };

  try {
    /* ── 글 ── */
    if (kinds.includes("post")) {
      const posts = await q(sql`SELECT p.id, p.title, p.body, p.blocks, p.meta, p.channel, p.status, p.created_at, p.published_at, p.external_url, a.handle
        FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id AND a.tenant_id = ${tid}
        WHERE p.tenant_id = ${tid} AND p.kind = 'post' AND p.status <> 'rejected'
          AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date
        ORDER BY p.id`);
      await stampProgress(tid, "글", 0, posts.length);
      let i = 0;
      for (const p of posts) {
        stopIfOver();
        const pid = n(p.id);
        const meta = (p.meta ?? {}) as Record<string, unknown>;
        const created = asDate(p.created_at);
        const dir = `글/${kst(created, false)}_${safeName(p.title)}`;
        // 이미지 — piece 를 거쳐서만(두 겹 tenant 조건)
        const imgs = await q(sql`SELECT r2_key, caption, sort FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${pid} AND kind = 'image' ORDER BY sort`);
        const mdImages: MdImage[] = [];
        for (const [k, img] of imgs.entries()) {
          stopIfOver();
          const obj = await r2Get(String(img.r2_key));
          if (!obj) continue;
          const path = `이미지/${String(k + 1).padStart(2, "0")}.${extOf(String(img.r2_key), "png")}`;
          await zip.add(`${dir}/${path}`, Buffer.from(obj.bytes), created ?? new Date());
          mdImages.push({ path, caption: img.caption ? String(img.caption) : undefined });
        }
        const blocks = normalizeBlocks(p.blocks) as Block[];
        const md = frontMatter({
          title: String(p.title ?? ""), channel: String(p.channel), status: String(p.status),
          createdAtKst: kst(created), publishedAtKst: kst(asDate(p.published_at)) || undefined,
          url: p.external_url ? String(p.external_url) : undefined,
          tags: Array.isArray(meta.tags) ? (meta.tags as unknown[]).map(String) : undefined,
          account: p.handle ? String(p.handle) : undefined,
        }) + (blocks.length ? blocksToMarkdown(blocks, mdImages) : String(p.body ?? ""));
        await zip.add(`${dir}/글.md`, Buffer.from(md, "utf8"), created ?? new Date());
        await stampProgress(tid, "글", ++i, posts.length);
      }
      (manifest.contents as Record<string, unknown>).posts = posts.length;
    }

    /* ── 영상 ── */
    if (kinds.includes("video")) {
      const vids = await q(sql`SELECT p.id, p.title, p.body, p.meta, p.channel, p.status, p.created_at, p.published_at, p.external_url, a.handle
        FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id AND a.tenant_id = ${tid}
        WHERE p.tenant_id = ${tid} AND p.kind = 'video' AND p.status <> 'rejected'
          AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date
        ORDER BY p.id`);
      await stampProgress(tid, "영상", 0, vids.length);
      let i = 0;
      for (const p of vids) {
        stopIfOver();
        const pid = n(p.id);
        const meta = (p.meta ?? {}) as Record<string, unknown>;
        const created = asDate(p.created_at);
        const dir = `영상/${kst(created, false)}_${safeName(p.title)}`;
        const assets = await q(sql`SELECT kind, r2_key FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${pid} AND kind IN ('video','thumb','srt') ORDER BY kind`);
        for (const a of assets) {
          stopIfOver();
          const obj = await r2Get(String(a.r2_key));
          if (!obj) continue;
          const kindName = String(a.kind);
          const name = kindName === "video" ? `영상.${extOf(String(a.r2_key), "mp4")}` : kindName === "thumb" ? `썸네일.${extOf(String(a.r2_key), "jpg")}` : "자막.srt";
          await zip.add(`${dir}/${name}`, Buffer.from(obj.bytes), created ?? new Date());
        }
        const yt = (meta.youtube ?? {}) as Record<string, unknown>;
        const info = [
          frontMatter({ title: String(p.title ?? ""), channel: String(p.channel), status: String(p.status), createdAtKst: kst(created),
            publishedAtKst: kst(asDate(p.published_at)) || undefined, url: p.external_url ? String(p.external_url) : undefined,
            tags: Array.isArray(yt.tags) ? (yt.tags as unknown[]).map(String) : undefined, account: p.handle ? String(p.handle) : undefined }),
          `# ${String(p.title ?? "")}`, "", "## 설명란", "", String(p.body ?? ""),
        ].join("\n");
        await zip.add(`${dir}/설명.md`, Buffer.from(info, "utf8"), created ?? new Date());
        await stampProgress(tid, "영상", ++i, vids.length);
      }
      (manifest.contents as Record<string, unknown>).videos = vids.length;
    }

    /* ── 수익 CSV ── */
    if (kinds.includes("revenue")) {
      stopIfOver();
      await stampProgress(tid, "수익", 0, 1);
      const rows = await q(sql`SELECT r.day, r.source, r.amount_krw, r.currency, r.fx_rate, r.freshness, r.piece_id, a.handle, p.title
        FROM revenue_daily r
        LEFT JOIN accounts a ON a.id = r.account_id AND a.tenant_id = ${tid}
        LEFT JOIN pieces p ON p.id = r.piece_id AND p.tenant_id = ${tid}
        WHERE r.tenant_id = ${tid} AND r.day BETWEEN ${from}::date AND ${to}::date
        ORDER BY r.day, r.source`);
      const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const head = ["날짜(KST)", "출처", "계정", "글/영상", "금액(원)", "통화", "환율", "신선도"];
      const lines = [head.join(","), ...rows.map((r) => [
        String(r.day ?? "").slice(0, 10), r.source, r.handle ?? "", r.title ?? (r.piece_id ? `#${n(r.piece_id)}` : ""),
        n(r.amount_krw), r.currency ?? "KRW", r.fx_rate ?? "", r.freshness ?? "",
      ].map(csvCell).join(","))];
      const total = rows.reduce((s, r) => s + n(r.amount_krw), 0);
      lines.push(["합계", "", "", "", total, "KRW", "", ""].map(csvCell).join(","));
      // 🔴 BOM — 엑셀이 UTF-8 한글을 깨뜨리지 않게(없으면 «ì„¤ì •» 로 열린다).
      await zip.add("수익/수익.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n"), "utf8")]));
      (manifest.contents as Record<string, unknown>).revenueRows = rows.length;
      (manifest.contents as Record<string, unknown>).revenueTotalKrw = total;
      await stampProgress(tid, "수익", 1, 1);
    }

    /* ── 안내 + manifest ── */
    const readme = [
      "# 내보낸 자료", "",
      `기간: ${from} ~ ${to} (KST)`,
      `만든 날: ${kst(new Date())} (KST)`, "",
      "- `글/` — 글마다 폴더 하나. `글.md` 와 `이미지/` 가 들어 있어요. 마크다운을 읽는 프로그램(옵시디언·노션 등)에서 바로 열려요.",
      "- `영상/` — 편마다 폴더 하나. 영상(mp4)·자막(srt)·썸네일·설명이 들어 있어요.",
      "- `수익/수익.csv` — 엑셀에서 바로 열려요. 날짜는 모두 한국 시간(KST)입니다.", "",
      "이 파일들은 모두 회원님 것입니다. 마음대로 쓰시고 옮기셔도 됩니다.",
    ].join("\n");
    await zip.add("읽어주세요.md", Buffer.from(readme, "utf8"));
    (manifest.contents as Record<string, unknown>).files = zip.fileCount + 1;
    await zip.add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    const zipBytes = await zip.finish();
    if (sink.bytes > cap) throw new Error(`자료가 ${mb(cap)} 를 넘어요 — 기간을 좁혀 주세요.`);
    const bytes = await sink.complete();
    const url = await r2PresignGet(key, EXPORT_URL_TTL_SEC);
    const expiresAt = new Date(Date.now() + EXPORT_URL_TTL_SEC * 1000).toISOString();
    console.log(`[export] t${tid} ${key} · ${zip.fileCount}개 파일 · ${mb(bytes)} · ${Math.round((Date.now() - t0) / 1000)}s`);
    void zipBytes;
    return { key, url, expiresAt, bytes, files: zip.fileCount };
  } catch (e) {
    await sink.abort();                                    // 🔴 반쪽 업로드를 남기지 않는다
    throw e;
  }
}
