/**
 * lib/export/r2-multipart.ts — R2 멀티파트 업로드 싱크(계약 P1R6 §2.1).
 *   ZIP 을 만들면서 **8MB 씩 올린다** — 편당 5~30MB 인 영상이 여러 편이면 «다 만들어 한 번에 올리기»는 배경 함수 메모리를 넘긴다.
 *   S3 규약: 마지막을 뺀 모든 파트는 **5MB 이상**이어야 한다 → 8MB 로 모았다가 보낸다.
 *   🔴 실패하면 `abort()` 로 **반쪽 업로드를 지운다**(R2 에 미완성 조각이 남아 요금만 먹는 일 0 · 조용한 실패 0).
 *   🔎 출처: AC 신규(계약 P1R6-B-1 §2.1 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET } from "../r2";

/** S3 최소 파트 5MB + 여유. */
export const PART_SIZE = 8 * 1024 * 1024;

export class R2MultipartSink {
  private buf: Buffer[] = [];
  private buffered = 0;
  private parts: { ETag: string; PartNumber: number }[] = [];
  private uploadId: string | null = null;
  private partNo = 0;
  private total = 0;
  constructor(private readonly key: string, private readonly contentType = "application/zip") {}

  private get client() { return getR2Client(); }

  async start(): Promise<void> {
    const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: this.key, ContentType: this.contentType }));
    if (!r.UploadId) throw new Error("[export] 멀티파트 업로드를 시작하지 못했습니다");
    this.uploadId = r.UploadId;
  }

  /** ZipWriter 의 sink 로 넘긴다. */
  readonly write = async (chunk: Buffer): Promise<void> => {
    if (!chunk.length) return;
    this.buf.push(chunk); this.buffered += chunk.length; this.total += chunk.length;
    while (this.buffered >= PART_SIZE) await this.flush(PART_SIZE);
  };

  private async flush(size: number): Promise<void> {
    if (!this.uploadId) throw new Error("[export] start() 를 먼저 불러야 합니다");
    const all = Buffer.concat(this.buf, this.buffered);
    const body = all.subarray(0, size);
    const rest = all.subarray(size);
    this.buf = rest.length ? [rest] : []; this.buffered = rest.length;
    this.partNo += 1;
    const r = await this.client.send(new UploadPartCommand({ Bucket: R2_BUCKET, Key: this.key, UploadId: this.uploadId, PartNumber: this.partNo, Body: body }));
    if (!r.ETag) throw new Error(`[export] 파트 ${this.partNo} 업로드 실패`);
    this.parts.push({ ETag: r.ETag, PartNumber: this.partNo });
  }

  /** 남은 것을 마지막 파트로 보내고 합친다. 반환 = 올린 총 바이트. */
  async complete(): Promise<number> {
    if (!this.uploadId) throw new Error("[export] start() 를 먼저 불러야 합니다");
    if (this.buffered > 0) await this.flush(this.buffered);
    if (!this.parts.length) throw new Error("[export] 올릴 내용이 없습니다");
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET, Key: this.key, UploadId: this.uploadId,
      MultipartUpload: { Parts: this.parts },
    }));
    this.uploadId = null;
    return this.total;
  }

  /** 실패 경로 — 미완성 조각을 지운다. 이 호출의 실패는 원래 오류를 덮지 않는다. */
  async abort(): Promise<void> {
    if (!this.uploadId) return;
    const id = this.uploadId; this.uploadId = null;
    try { await this.client.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: this.key, UploadId: id })); }
    catch (e) { console.warn("[export] 멀티파트 abort 실패(무시):", String((e as Error)?.message ?? e).slice(0, 120)); }
  }

  get bytes(): number { return this.total; }
}
