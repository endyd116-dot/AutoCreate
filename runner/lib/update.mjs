/**
 * runner/lib/update.mjs — 스스로 갱신하기(계약 «러너 배포» ③ 자동 업데이트).
 *
 *   왜 필요한가: 네이버·티스토리가 화면을 바꾸면 **셀렉터 수리**를 고객 손을 빌리지 않고 밀어 넣어야 한다.
 *   안 그러면 «앱은 멀쩡한데 글이 안 올라가는» 날이 고객마다 다른 날에 시작되고, 고칠 방법이 «다시 받으세요» 뿐이다.
 *
 *   흐름: 하트비트 응답의 `update{version,url,sha256,bytes}` → 내려받기 → **sha256 대조** → zip 검사 →
 *         제자리에 풀기 → 종료코드 75 로 나간다(`run.bat`/`run.sh` 가 다시 띄운다).
 *
 *   🔴 **반쪽 업데이트로 죽지 않는다.** 이 파일의 모든 실패 경로는 «옛 판 그대로 두고 계속 돈다» 로 끝난다.
 *      받다 끊기든, 해시가 틀리든, 풀다 막히든 — 러너는 어제처럼 계속 일한다. 그리고 서버에 `update_failed` 를 알린다.
 *   🔴 **덮어쓰기는 마지막에 한 번**이다. 다 풀어 «검사까지 끝난» 임시 폴더를 만들고 그 다음에야 제자리로 옮긴다.
 *      파일을 하나씩 덮어쓰다 중간에 실패하면 새 파일과 옛 파일이 섞인 러너가 남는다 — 그게 제일 고치기 어렵다.
 *   🔴 고객 것은 안 건드린다: `.token` · `profiles/` · `node_modules/` · `.env` 는 갱신 대상이 아니다.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, VERSION } from "./api.mjs";
import { zipRead } from "./zip.mjs";

/** 갱신해도 되는 것 = 우리가 배포한 파일뿐. 그 밖은 **고객의 것**이라 건드리지 않는다. */
const KEEP = new Set([".token", ".env", "node_modules", "profiles", "_shots", "tmp"]);
export const RESTART_EXIT_CODE = 75;          // run.bat/run.sh 가 이 코드를 보고 다시 띄운다(EX_TEMPFAIL 관례)

const cmp = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};
/** 서버가 알려 준 판이 지금 것보다 **높을 때만** 받는다(같거나 낮으면 아무것도 안 한다). */
export const isNewer = (v) => /^\d+\.\d+\.\d+$/.test(String(v ?? "")) && cmp(v, VERSION) > 0;

async function download(url, expectBytes) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`내려받기 실패(HTTP ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    // 길이가 다르면 받다 끊긴 것이다 — 해시를 보기 전에 먼저 걸러 준다(사유가 더 또렷하다).
    if (expectBytes && buf.length !== Number(expectBytes)) throw new Error(`크기가 달라요(${buf.length}≠${expectBytes} · 받다 끊긴 듯)`);
    return buf;
  } finally { clearTimeout(timer); }
}

/**
 * 한 번의 업데이트 시도. **던지지 않는다** — `{ ok, version?, reason? }` 로만 답한다(러너 루프를 죽이지 않는다).
 * ok:true 면 호출부는 종료코드 75 로 나가야 한다(그래야 새 판으로 다시 뜬다).
 */
export async function applyUpdate(offer, log = console.log) {
  const version = String(offer?.version ?? "");
  const tmp = path.join(ROOT, `.update-${version}-${Date.now()}`);
  try {
    if (!isNewer(version)) return { ok: false, reason: `받을 게 없어요(지금 v${VERSION} · 서버 v${version || "?"})` };
    if (!offer?.url || !offer?.sha256) return { ok: false, reason: "서버가 준 업데이트 정보가 모자라요(url/sha256)" };

    log(`새 판이 있어요: v${VERSION} → v${version} · 받는 중…`);
    const zip = await download(offer.url, offer.bytes);

    /* 🔴 해시 대조가 이 파일의 **존재 이유**다. presigned URL 은 짧게 살지만 그 사이 중간에서 바뀔 수도,
       내가 엉뚱한 파일을 받았을 수도 있다. 여기서 안 막으면 남이 준 코드를 내 PC 에서 실행하게 된다. */
    const got = crypto.createHash("sha256").update(zip).digest("hex");
    if (got !== String(offer.sha256).toLowerCase()) return { ok: false, reason: `내려받은 파일이 서버가 말한 것과 달라요(sha256 불일치)` };

    const raw = zipRead(zip);                                    // CRC·크기까지 여기서 검사된다(깨졌으면 던진다)
    /* 배포 zip 은 사람이 풀 것을 생각해 **한 폴더로 감싸** 있다(`autocreate-runner/…`).
       제자리 갱신은 그 껍질을 벗기고 넣어야 한다 — 안 그러면 `runner/autocreate-runner/` 가 하나 더 생기고
       러너는 **옛 파일 그대로** 돈다(«업데이트했는데 아무것도 안 바뀐다»가 이렇게 생긴다). */
    const top = raw.length ? raw[0].name.split("/")[0] : "";
    const wrapped = top && raw.every((f) => f.name.startsWith(`${top}/`));
    const files = wrapped ? raw.map((f) => ({ ...f, name: f.name.slice(top.length + 1) })) : raw;
    if (!files.some((f) => f.name === "ac-runner.mjs")) return { ok: false, reason: "새 판에 ac-runner.mjs 가 없어요(수상한 묶음)" };

    // ① 임시 폴더에 **전부** 풀어 본다. 여기서 실패하면 제자리는 아직 손도 안 댄 상태다.
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of files) {
      const rel = f.name.replace(/\\/g, "/");
      // zip-slip 방어: «../» 로 폴더 밖에 쓰려는 묶음은 거부한다(우리 zip 이 아니다).
      const dest = path.resolve(tmp, rel);
      if (!dest.startsWith(path.resolve(tmp) + path.sep)) return { ok: false, reason: `수상한 경로가 들어 있어요(${rel})` };
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data, { mode: f.mode & 0o777 });
    }

    // ② 여기서부터가 제자리 교체 — 다 풀린 게 확인된 뒤에만 한다.
    let moved = 0;
    for (const f of files) {
      const rel = f.name.replace(/\\/g, "/");
      if (KEEP.has(rel.split("/")[0])) continue;                 // 고객 것은 건드리지 않는다
      const dest = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(tmp, rel), dest);
      try { fs.chmodSync(dest, f.mode & 0o777); } catch { /* 윈도우는 권한 개념이 달라 무시해도 된다 */ }
      moved++;
    }
    log(`v${version} 으로 갱신했어요(파일 ${moved}개) — 다시 시작합니다.`);
    return { ok: true, version, files: moved };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 160) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 남아도 다음 실행에 해가 없다 */ }
  }
}
