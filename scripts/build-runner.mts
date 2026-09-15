/**
 * scripts/build-runner.mts — 「내 PC 러너」 배포 묶음 만들기(계약 «러너 배포» ①).
 *
 *   npx --yes tsx --env-file=.env scripts/build-runner.mts            빌드 + R2 업로드
 *   npx --yes tsx --env-file=.env scripts/build-runner.mts --dry-run  묶기·검증까지만(업로드 안 함)
 *   npx --yes tsx --env-file=.env scripts/build-runner.mts --force    같은 버전 덮어쓰기(사고 수습용)
 *
 *   하는 일: `runner/**` 를 zip 으로 묶어 R2 `autocreate/runner/v{version}.zip` + `autocreate/runner/latest.json` 에 올린다.
 *   고객은 이 zip 을 `/api/runner-download`(로그인·플랜 확인 후 presigned 10분)로만 받는다.
 *
 *   🔴 **같은 버전 재업로드 금지**. 이미 올라간 v1.2.0 의 내용이 바뀌면, 이미 받은 사람과 새로 받는 사람이
 *      «같은 버전인데 다른 프로그램»을 쓰게 된다 — 사고가 났을 때 무엇이 돌고 있었는지 영영 모른다.
 *      고칠 게 있으면 **버전을 올린다**(runner/package.json).
 *   🔴 **zip 안에 비밀 0.** 토큰은 실행 인자로 받고 `.env` 는 넣지 않는다. 주석으로 약속하지 않고 **스캔해서 막는다**.
 *   🔴 만든 zip 을 **되읽어 원본과 바이트 대조**한 뒤에만 올린다(PITFALLS #9 — 「만들었다」는 「열린다」가 아니다).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { contentDisposition, r2Configured, r2Head, r2Put, R2_BUCKET } from "../lib/r2";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER = path.join(ROOT, "runner");
const OUT_DIR = path.join(ROOT, "dist");

/** zip 코덱은 **러너가 쓰는 그 파일**을 그대로 쓴다 — 쓰는 쪽과 푸는 쪽이 갈리면 형식이 어긋난다. */
const { zipWrite, zipRead } = await import(pathToFileURL(path.join(RUNNER, "lib/zip.mjs")).href) as {
  zipWrite: (e: { name: string; data: Buffer; mode?: number }[]) => Buffer;
  zipRead: (b: Buffer) => { name: string; data: Buffer; mode: number }[];
};

/* ── 무엇을 넣고 무엇을 뺄 것인가 ──
   🔴 뺄 것을 «폴더 이름»으로만 거르면 새 폴더가 생겼을 때 조용히 새어 나간다. 넣을 것도 확장자로 못 박는다. */
const SKIP_DIRS = new Set(["node_modules", "profiles", "_shots", "tmp", ".git"]);
const SKIP_FILES = new Set([".token", ".env", ".DS_Store", "Thumbs.db"]);
const SKIP_PATTERNS = [/^probe-.*\.mjs$/];      // 개발용 탐침 — 고객 PC 에 갈 물건이 아니다(셀렉터 노출도 덜한다)
const ALLOW_EXT = new Set([".mjs", ".js", ".json", ".md", ".bat", ".sh", ".txt"]);

interface Entry { name: string; data: Buffer; mode: number }

function collect(dir: string, base = ""): Entry[] {
  const out: Entry[] = [];
  for (const de of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${de.name}` : de.name;
    if (de.isDirectory()) {
      if (SKIP_DIRS.has(de.name)) continue;
      out.push(...collect(path.join(dir, de.name), rel));
      continue;
    }
    if (!de.isFile()) continue;                                  // 심링크·장치는 배포물이 아니다
    if (SKIP_FILES.has(de.name) || SKIP_PATTERNS.some((re) => re.test(de.name))) continue;
    const ext = path.extname(de.name).toLowerCase();
    if (!ALLOW_EXT.has(ext)) { console.log(`   · 건너뜀(확장자 밖): ${rel}`); continue; }
    const full = path.join(dir, de.name);
    // `.sh` 는 실행 권한을 살려 넣는다 — 안 그러면 mac·리눅스에서 «실행이 안 돼요»가 된다.
    out.push({ name: rel, data: readFileSync(full), mode: ext === ".sh" ? 0o755 : 0o644 });
  }
  return out;
}

/** 🔴 비밀 스캔 — 「안 넣었겠지」를 믿지 않는다. 하나라도 걸리면 **빌드를 세운다**. */
const SECRET_RULES: { name: string; re: RegExp }[] = [
  { name: "러너 토큰", re: /acr_[A-Za-z0-9_-]{16,}/ },
  { name: "DB 접속 문자열", re: /postgres(ql)?:\/\/[^\s"']+/i },
  { name: "R2·AWS 비밀키", re: /R2_SECRET_ACCESS_KEY\s*=|AWS_SECRET_ACCESS_KEY\s*=/ },
  { name: "Gemini·API 키", re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "JWT 시크릿", re: /JWT_SECRET\s*=\s*\S/ },
  { name: "개인 키", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];
function scanSecrets(entries: Entry[]): string[] {
  const hits: string[] = [];
  for (const e of entries) {
    const text = e.data.toString("utf8");
    for (const r of SECRET_RULES) if (r.re.test(text)) hits.push(`${e.name} → ${r.name}`);
  }
  return hits;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");

  const pkg = JSON.parse(readFileSync(path.join(RUNNER, "package.json"), "utf8")) as { version?: string };
  const version = String(pkg.version ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`runner/package.json 의 version 이 semver 가 아니에요: «${version}»`);

  console.log(`\n── 러너 묶기 v${version} ──`);
  const entries = collect(RUNNER);
  if (!entries.length) throw new Error("넣을 파일이 하나도 없어요(경로가 맞나요?)");
  for (const must of ["ac-runner.mjs", "core.mjs", "package.json", "run.bat", "run.sh", "install.md", "lib/api.mjs", "lib/zip.mjs", "lib/update.mjs"]) {
    if (!entries.some((e) => e.name === must)) throw new Error(`꼭 있어야 할 «${must}» 가 빠졌어요 — 이 zip 으로는 러너가 못 돕니다.`);
  }

  const leaks = scanSecrets(entries);
  if (leaks.length) { console.error("\n  ✗ zip 에 비밀이 섞였어요 — 빌드를 세웁니다:"); for (const l of leaks) console.error(`     · ${l}`); process.exit(1); }
  console.log(`   파일 ${entries.length}개 · 원본 ${entries.reduce((s, e) => s + e.data.length, 0).toLocaleString()} bytes · 비밀 스캔 ✓`);

  /* 🔴 zip 안을 **한 폴더로 감싼다**. 안 그러면 «여기에 압축 풀기» 를 누른 고객의 다운로드 폴더에
     파일 28개가 쏟아진다 — 그 뒤엔 어느 게 우리 건지 아무도 모른다. 폴더 이름에 버전을 넣지 않는 이유는,
     업데이트가 **제자리 갱신**이라 폴더 이름이 버전마다 바뀌면 바로가기·시작프로그램이 매번 끊기기 때문이다. */
  const PREFIX = "autocreate-runner";
  /* 🔴 **재현 가능한 빌드**: 파일 시각을 «지금»으로 박으면 같은 소스를 두 번 묶어도 sha256 이 달라진다(실측).
     그러면 `latest.json.sha256` — 러너가 목숨 걸고 대조하는 그 값 — 을 소스에서 되만들어 확인할 길이 없다.
     시각을 **고정값**으로 둔다: 같은 소스 → 같은 바이트 → 같은 해시(누가 어디서 묶든). */
  const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");
  const zip = zipWrite(entries.map((e) => ({ ...e, name: `${PREFIX}/${e.name}`, mtime: FIXED_MTIME })));

  /* 🔴 되읽기 검증: 내가 만든 zip 을 **내가 다시 풀어** 원본과 한 바이트도 다르지 않은지 본다.
     여기를 건너뛰면 «업로드는 됐는데 고객 PC 에서 안 풀리는» 사고를 고객이 먼저 발견한다. */
  const back = zipRead(zip);
  if (back.length !== entries.length) throw new Error(`되읽기 개수 불일치(${back.length}≠${entries.length})`);
  if (!back.every((b) => b.name.startsWith(`${PREFIX}/`))) throw new Error("zip 이 한 폴더로 감싸지지 않았어요");
  for (const e of entries) {
    const got = back.find((b) => b.name === `${PREFIX}/${e.name}`);
    if (!got) throw new Error(`되읽기에 «${e.name}» 가 없어요`);
    if (Buffer.compare(got.data, e.data) !== 0) throw new Error(`«${e.name}» 내용이 달라졌어요`);
    if ((got.mode & 0o777) !== e.mode) throw new Error(`«${e.name}» 권한이 달라졌어요(${got.mode.toString(8)}≠${e.mode.toString(8)})`);
  }
  const hash = sha256(zip);
  console.log(`   zip ${zip.length.toLocaleString()} bytes · sha256 ${hash.slice(0, 16)}… · 되읽기 대조 ✓`);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const localPath = path.join(OUT_DIR, `autocreate-runner-v${version}.zip`);
  writeFileSync(localPath, zip);
  console.log(`   → ${path.relative(ROOT, localPath)}`);

  if (dryRun) { console.log("\n   --dry-run 이라 올리지 않았어요.\n"); return; }
  if (!r2Configured()) throw new Error("R2 설정이 없어요(.env R2_*) — 올릴 수 없습니다.");

  const key = `autocreate/runner/v${version}.zip`;
  const exists = await r2Head(key);
  if (exists && !force) {
    console.error(`\n  ✗ 이미 올라가 있어요: ${R2_BUCKET}/${key} (${exists.bytes.toLocaleString()} bytes)`);
    console.error("    같은 버전을 덮어쓰면 «같은 버전인데 다른 프로그램»이 돌아다닙니다.");
    console.error("    고칠 게 있으면 runner/package.json 의 version 을 올려 주세요(정말 수습이 필요하면 --force).\n");
    process.exit(1);
  }

  // 서명 없이 열릴 때를 위한 보루로 이름을 오브젝트에도 박아 둔다(presign 의 ResponseContentDisposition 이 우선).
  await r2Put(key, zip, "application/zip", undefined, contentDisposition(`autocreate-runner-v${version}.zip`));
  const latest = { version, sha256: hash, bytes: zip.length, releasedAt: new Date().toISOString(), notes: String(process.env.RUNNER_NOTES ?? "").slice(0, 200) };
  /* 🔴 `latest.json` 은 **바뀌는 파일**이다 — r2Put 의 기본 immutable 캐시를 그대로 쓰면
        새 버전을 올려도 한동안 옛 값이 읽힌다(자동 업데이트가 조용히 멈춘다). 짧은 캐시로 올린다. */
  await r2Put("autocreate/runner/latest.json", Buffer.from(JSON.stringify(latest, null, 2), "utf8"), "application/json", "public, max-age=60");

  // 쓴 직후 되읽기까지가 쓰기다(CLAUDE §4.5 의 jsonb 규율과 같은 정신).
  const head = await r2Head(key);
  console.log(`\n   ✓ 올렸어요: ${R2_BUCKET}/${key} (${head?.bytes?.toLocaleString() ?? "?"} bytes)`);
  console.log(`   ✓ latest.json → v${version} · sha256 ${hash.slice(0, 16)}…`);
  console.log(`\n   고객 경로: GET /api/runner-download (로그인 · 플랜 확인 · presigned 10분)\n`);
}

main().catch((e) => { console.error(`\n  ✗ ${String((e as Error)?.message ?? e)}\n`); process.exit(1); });
