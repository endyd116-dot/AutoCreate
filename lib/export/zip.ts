/**
 * lib/export/zip.ts — 최소 ZIP 라이터(계약 P1R6 §2.1 · 외부 의존 0 · `node:zlib` 만).
 *   왜 손으로 짜나: 이 리포의 deps 는 9개뿐이고(archiver·jszip 없음), 내보내기 하나 때문에 마지막 라운드에
 *   의존을 늘리지 않는다. 하니스가 PNG 인코더를 손으로 짠 것과 같은 결.
 *
 *   🔴 **메모리에 다 쌓지 않는다.** `sink(chunk)` 로 흘려보내고, 호출부(`r2-multipart.ts`)가 8MB 씩 R2 에 올린다.
 *      영상 mp4 가 편당 5~30MB 라 «다 만들어서 한 번에 올리기»는 배경 함수 메모리를 넘긴다.
 *   구조: [로컬 헤더 + 데이터] × N → [중앙 디렉터리] → [끝 레코드]. ZIP64 는 쓰지 않는다(총 4GB·6.5만 파일 미만 —
 *   플랜 상한이 그보다 훨씬 아래다. 넘으면 `finish()` 가 정직하게 던진다).
 *   파일명은 UTF-8(플래그 0x0800) — 한글 제목이 그대로 보인다.
 *   🔎 출처: AC 신규(계약 P1R6-B-1 §2.1 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let k = 0; k < 256; k++) { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[k] = c; }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** DOS 시각(2초 단위) — 압축 파일 목록의 «수정한 날짜». KST 로 적는다(사람이 보는 값 · CLAUDE §4.5b). */
function dosTime(d: Date): { time: number; date: number } {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const y = Math.max(1980, k.getUTCFullYear());
  return {
    time: (k.getUTCHours() << 11) | (k.getUTCMinutes() << 5) | (k.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((k.getUTCMonth() + 1) << 5) | k.getUTCDate(),
  };
}

/** 이미 압축된 것(mp4·jpg·png·mp3·webp)은 다시 줄지 않는다 — CPU 만 쓰고 커지기도 한다. 그대로 담는다(store). */
export function shouldStore(name: string): boolean {
  return /\.(mp4|m4a|mp3|jpg|jpeg|png|webp|gif|zip|woff2?)$/i.test(name);
}

interface Entry { name: Buffer; crc: number; csize: number; usize: number; offset: number; method: number; time: number; date: number }

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private closed = false;
  constructor(private readonly sink: (chunk: Buffer) => Promise<void>) {}

  /** 파일 하나 추가. `at` 은 압축 파일 목록에 보일 수정 시각(KST 로 적힌다). */
  async add(name: string, data: Buffer, at: Date = new Date()): Promise<void> {
    if (this.closed) throw new Error("[zip] 이미 닫힌 아카이브에 추가할 수 없습니다");
    const nameBuf = Buffer.from(name.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    const store = shouldStore(name) || data.length < 64;
    const body = store ? data : deflateRawSync(data, { level: 6 });
    const method = store ? 0 : 8;
    const { time, date } = dosTime(at);
    const crc = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);            // version needed
    head.writeUInt16LE(0x0800, 6);        // UTF-8 파일명
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);

    this.entries.push({ name: nameBuf, crc, csize: body.length, usize: data.length, offset: this.offset, method, time, date });
    await this.sink(head); await this.sink(nameBuf); await this.sink(body);
    this.offset += head.length + nameBuf.length + body.length;
  }

  /** 중앙 디렉터리 + 끝 레코드. 반환 = 최종 바이트 수. */
  async finish(): Promise<number> {
    if (this.closed) return this.offset;
    this.closed = true;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34);
      c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38);
      c.writeUInt32LE(e.offset, 42);
      await this.sink(c); await this.sink(e.name);
      this.offset += c.length + e.name.length;
    }
    const cdSize = this.offset - cdStart;
    if (cdStart > 0xffffffff || this.offset > 0xffffffff || this.entries.length > 0xffff) {
      throw new Error(`[zip] ZIP64 가 필요한 크기입니다(파일 ${this.entries.length}개 · ${this.offset} 바이트) — 기간을 좁혀 주세요`);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    await this.sink(end);
    this.offset += end.length;
    return this.offset;
  }

  get fileCount(): number { return this.entries.length; }
  get bytesWritten(): number { return this.offset; }
}
