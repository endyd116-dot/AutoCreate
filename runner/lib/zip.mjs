/**
 * runner/lib/zip.mjs — 의존성 0 ZIP 읽기·쓰기(계약 «묶기/자동 업데이트» · 2026-09-15 B2).
 *
 *   왜 직접 쓰나: 러너는 **고객 PC**에서 자기 자신을 갱신한다. 그 자리에서 쓸 수 있는 건 node 뿐이다.
 *     · `tar`/`Expand-Archive` 에 기대면 PC 마다 갈린다 — Git Bash 의 GNU tar 는 zip 을 못 풀고(실측),
 *       Windows 의 bsdtar 는 되지만 PATH 순서에 따라 어느 쪽이 잡힐지 모른다. 「대부분 된다」는 배포 도구가 아니다.
 *     · npm 의존성을 더하면 **업데이트가 npm install 에 목숨을 건다** — 갱신은 네트워크가 나쁜 날에도 돼야 한다.
 *   그래서 node 기본(zlib·fs)만으로 ZIP 을 읽고 쓴다. 쓰는 쪽과 읽는 쪽이 **같은 파일**에 있어야
 *   형식이 어긋날 길이 없다(빌더가 이 writer 로 쓰고 이 reader 로 되읽어 검증한다 · PITFALLS #9 거짓 초록 방지).
 *
 *   지원 범위는 **우리가 쓰는 만큼만**이다: 파일 엔트리 · deflate(8)/stored(0) · UTF-8 이름 · ZIP64 아님(우리 zip 은 수백 KB).
 *   암호화·멀티디스크·심링크는 다루지 않는다 — 만나면 정직하게 던진다(조용히 건너뛰면 반쪽 업데이트가 된다).
 */
import zlib from "node:zlib";

/* ── CRC-32 (ZIP 이 요구하는 무결성 값) ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** JS Date → DOS 시각·날짜 2바이트씩. ZIP 은 1980년 이전을 표현하지 못한다(하한으로 눌러 둔다).
 *  🔴 **UTC 로 읽는다.** 지역시로 읽으면 같은 소스·같은 시각인데 **빌드한 컴퓨터의 시간대에 따라 zip 바이트가 달라진다** —
 *     그러면 `latest.json.sha256` 을 소스에서 다시 만들어 대조할 수가 없다. */
function dosTime(d) {
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    time: ((d.getUTCHours() & 31) << 11) | ((d.getUTCMinutes() & 63) << 5) | ((d.getUTCSeconds() / 2) & 31),
    date: (((y - 1980) & 127) << 9) | (((d.getUTCMonth() + 1) & 15) << 5) | (d.getUTCDate() & 31),
  };
}

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

/**
 * 파일 목록 → ZIP 바이트.
 *   `entries` = [{ name, data:Buffer, mode?, mtime? }] — name 은 **슬래시 구분 상대경로**(«dist/x.mjs»).
 *   mode 는 유닉스 권한(기본 0o644). 🔴 `run.sh` 같은 실행 파일은 0o755 로 넣어야 mac·리눅스에서 바로 돈다 —
 *      zip 이 권한을 잃으면 고객은 «실행이 안 돼요»만 보게 된다.
 */
export function zipWrite(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(String(e.name).replace(/\\/g, "/"), "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(raw);
    /* deflate 가 원본보다 커질 수 있다(이미 압축된 파일·아주 짧은 파일). 그럴 땐 stored 로 넣는다 —
       «압축했는데 더 커졌다»를 그대로 두면 업데이트 용량이 이유 없이 늘어난다. */
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosTime(e.mtime instanceof Date ? e.mtime : new Date());

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // flag: 이름이 UTF-8 이다(한글 파일명을 넣게 되면 이 비트가 지켜 준다)
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CENTRAL, 0);
    ch.writeUInt16LE(0x031E, 4);        // made by: unix(3) · 버전 30 — 이래야 아래 권한 비트를 읽어 준다
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.mode ?? 0o644) & 0xFFFF) << 16, 38);   // external attrs 상위 16비트 = 유닉스 권한
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

/**
 * ZIP 바이트 → [{ name, data, mode }].
 *   🔴 **중앙 디렉터리**를 정본으로 읽는다(로컬 헤더만 훑으면 지워진 엔트리·덧붙인 쓰레기를 같이 집는다).
 *   🔴 CRC 를 **반드시** 대조한다. 안 맞으면 던진다 — 반쯤 깨진 파일로 자기 자신을 덮어쓰는 게 최악이다.
 */
export function zipRead(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xFFFF; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip 이 아니거나 끝이 잘렸어요(EOCD 없음)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`중앙 디렉터리가 깨졌어요(${i}번째)`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const mode = (buf.readUInt32LE(p + 38) >>> 16) & 0xFFFF;
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(lho) !== SIG_LOCAL) throw new Error(`«${name}» 의 로컬 헤더가 없어요`);
    if (buf.readUInt16LE(lho + 6) & 1) throw new Error(`«${name}» 는 암호가 걸려 있어요(우리 zip 이 아니에요)`);
    const dataAt = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const body = buf.subarray(dataAt, dataAt + compSize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = zlib.inflateRawSync(body);
    else throw new Error(`«${name}» 의 압축 방식(${method})을 모르겠어요`);

    if (data.length !== rawSize) throw new Error(`«${name}» 크기가 안 맞아요(${data.length}≠${rawSize})`);
    if (crc32(data) !== crc) throw new Error(`«${name}» 내용이 깨졌어요(CRC 불일치)`);
    out.push({ name, data, mode: mode || 0o644 });
  }
  return out;
}
