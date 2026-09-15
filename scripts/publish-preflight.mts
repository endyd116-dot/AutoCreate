/**
 * scripts/publish-preflight.mts — 🔴 **«올려» 하기 직전에 사장님께 보여 드리는 한 화면**(계약 P1R7 §2.1).
 *
 *   `npx --yes tsx --env-file=.env scripts/publish-preflight.mts --piece=<id>`
 *   `… --piece=<id> --go`      ← 🔴 **이것만이 실제로 올린다**(사장님 «올려» 뒤에만)
 *
 *   왜 이 파일이 있나: 실발행은 **되돌릴 수 없다**. 남의 눈에 보이는 글이 사장님 블로그에 올라간다.
 *   그래서 누르기 전에 **판단에 필요한 것 전부를 한 화면**에 모은다 —
 *     ① 어디에 올라가나(채널·계정·블로그 주소)  ② 게이트 전수 결과  ③ **고지 문구 첫 줄**
 *     ④ 제목·본문 미리보기  ⑤ **되돌리는 법**(올린 뒤 지우는 절차)  ⑥ 지금 막는 것이 있나
 *
 *   🔴 기본은 **보여 주기만** 한다. `--go` 없이는 **아무것도 올라가지 않는다** —
 *      «실수로 엔터를 한 번 더 쳤다»로 실발행이 되면 안 된다.
 *   🔴 게이트가 하나라도 걸리면 `--go` 를 줘도 **멈춘다**(§16B 는 발행 직전 재검사가 정본이다).
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { loadPublishPiece, loadPublishAccount, publish, runPublishGate } from "../lib/publish";
import { warmupState } from "../lib/warmup";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const GO = process.argv.includes("--go");

const line = (s = "") => console.log(s);
const rule = () => line("─".repeat(72));
const strip = (html: string) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const pieceId = n(arg("piece"));
  if (!pieceId) { console.error("\n  쓰는 법: --piece=<id> [--go]\n"); process.exit(2); }

  const [p0] = await q(sql`SELECT tenant_id FROM pieces WHERE id = ${pieceId}`);
  if (!p0) { console.error(`\n  piece ${pieceId} 이 없어요.\n`); process.exit(1); }
  const tid = n(p0.tenant_id);

  const piece = await loadPublishPiece(tid, pieceId);
  if (!piece) { console.error(`\n  piece ${pieceId} 을 읽지 못했어요.\n`); process.exit(1); }
  const account = piece.accountId ? await loadPublishAccount(tid, piece.accountId) : null;

  line();
  rule();
  line(`  올리기 직전 확인 — piece #${pieceId}`);
  rule();

  /* ① 어디에 올라가나 */
  line();
  line("① 어디에 올라가나");
  line(`   채널   ${piece.channel}`);
  line(`   계정   ${account ? `@${account.handle}${account.displayName ? ` (${account.displayName})` : ""}` : "🔴 없음 — 올릴 수 없다"}`);
  line(`   상태   piece=${piece.status}${account ? ` · 계정=${account.status}` : ""}`);
  if (account) {
    const [a] = await q(sql`SELECT created_at, opened_at, warmup_off FROM accounts WHERE id = ${account.id}`);
    const w = warmupState({ openedAt: a?.opened_at as string, createdAt: a?.created_at as string, off: a?.warmup_off === true });
    line(`   오늘   ${account.postsToday}/${account.dailyCap}건${w.active ? ` · ⚠️ ${w.label}` : ""}`);
  }
  if (piece.externalUrl || piece.channelRef) {
    line(`   🔴 이미 올라가 있다: ${piece.externalUrl ?? piece.channelRef} — 다시 올리지 않는다(멱등).`);
  }

  /* ② 게이트 전수 */
  line();
  line("② 발행 직전 게이트(§16B)");
  const gate = runPublishGate(
    { bodyHtml: piece.bodyHtml, title: piece.title, blocks: piece.blocks, ...(piece.affiliate ? { affiliate: piece.affiliate } : {}) } as never,
    account ? ({ channel: account.channel, monetize: account.monetize } as never) : undefined,
  );
  /* 🔴 칸 이름은 `pass` 다(`ok` 가 아니다 · `lib/ai-tell-gate.ts:38`).
     처음에 `c.ok` 를 읽어 **항목은 전부 ✗ 인데 판정은 ✓ 전부 통과**로 찍혔다 —
     사장님이 «올릴까 말까»를 정하는 바로 그 화면에서 앞뒤가 안 맞는 표를 보여 줄 뻔했다.
     ⚠️ 게이트 입력을 `as never` 로 캐스트해 둔 탓에 컴파일러가 못 잡았다. 그래서 **눈으로 돌려 보고** 잡았다. */
  const checks = gate.report?.checks ?? [];
  for (const c of checks) line(`   ${c.pass ? "✓" : "✗"} ${c.label ?? c.key}${c.detail ? ` — ${c.detail}` : ""}`);
  if (!checks.length) line("   (게이트가 검사 항목을 돌려주지 않았다 — 확인 필요)");
  // 표와 판정이 어긋나면 그 사실 자체를 말한다(둘 중 하나가 틀린 것이므로 조용히 넘기지 않는다).
  const allPass = checks.length > 0 && checks.every((c) => c.pass);
  if (checks.length && allPass !== !!gate.report?.ok) line("   🔴 항목과 판정이 어긋난다 — 올리지 말고 담당에게 알려 주세요.");
  line(`   판정: ${gate.report?.ok ? "✓ 전부 통과" : "🔴 걸린 것이 있다 — 올리지 않는다"}${gate.report?.rewritten ? " · 본문이 자동 수정됐다(고지 복원 등)" : ""}`);

  /* ③ 고지 문구 첫 줄 — 사장님이 눈으로 확인할 자리 */
  line();
  line("③ 고지 문구(본문 첫머리)");
  const firstLine = strip(gate.bodyHtml ?? piece.bodyHtml).slice(0, 160);
  line(`   ${firstLine || "(본문이 비어 있다)"}`);
  line(`   제휴: ${piece.affiliate ? `${piece.affiliate.provider} · ${piece.affiliate.url.slice(0, 60)}` : "없음"}`);
  if (piece.disclosure) line(`   고지 원문: ${piece.disclosure}`);

  /* ④ 미리보기 */
  line();
  line("④ 올라갈 글");
  line(`   제목   ${piece.title}`);
  const body = strip(gate.bodyHtml ?? piece.bodyHtml);
  line(`   본문   ${body.length}자 · 사진 ${piece.images.length}장 · 태그 ${piece.tags.length}개`);
  line(`   ┌${"─".repeat(68)}`);
  for (const chunk of (body.slice(0, 400).match(/.{1,66}/g) ?? [])) line(`   │ ${chunk}`);
  if (body.length > 400) line(`   │ … (${body.length - 400}자 더)`);
  line(`   └${"─".repeat(68)}`);

  /* ⑤ 되돌리는 법 — 누르기 전에 알아야 한다 */
  line();
  line("⑤ 올린 뒤 되돌리는 법");
  if (piece.channel === "naver_blog") {
    line("   네이버 블로그 → 그 글 → 오른쪽 위 «…» → 삭제. (검색 반영은 며칠 남을 수 있다)");
  } else if (piece.channel === "tistory") {
    line("   티스토리 관리 → 글 관리 → 그 글 → 삭제.");
  } else {
    line(`   ${piece.channel} 채널의 글 관리 화면에서 삭제.`);
  }
  line("   🔴 우리 쪽 기록(posts 행·piece 상태)은 남는다 — 지우려면 말해 주세요(수동 정리).");
  line("   🔴 이미 검색·피드에 퍼진 것은 되돌릴 수 없다. 그래서 올리기 전에 이 화면을 본다.");

  /* ⑥ 지금 막는 것 */
  line();
  line("⑥ 지금 막는 것");
  const blockers: string[] = [];
  if (!account) blockers.push("계정이 없다");
  if (account && ["suspended", "disconnected", "pending_login", "limited"].includes(account.status)) blockers.push(`계정 상태 ${account.status}`);
  if (!gate.report?.ok) blockers.push("게이트에 걸린 항목이 있다");
  if (piece.externalUrl || piece.channelRef) blockers.push("이미 발행됐다(멱등)");
  if (account && account.postsToday >= account.dailyCap) blockers.push(`오늘 상한 도달(${account.postsToday}/${account.dailyCap})`);
  line(blockers.length ? blockers.map((b) => `   🔴 ${b}`).join("\n") : "   ✓ 막는 것 없음");

  rule();
  if (!GO) {
    line();
    line("  지금은 **아무것도 올리지 않았다**(보여 주기만).");
    line(`  사장님이 «올려» 하시면:  npx --yes tsx --env-file=.env scripts/publish-preflight.mts --piece=${pieceId} --go`);
    line();
    await pgClient.end({ timeout: 5 });
    process.exit(blockers.length ? 1 : 0);
  }

  /* ───── 여기부터가 실발행 ───── */
  if (blockers.length) {
    line();
    line("  🔴 막는 것이 있어 --go 를 무시하고 멈춘다. 위 ⑥ 을 먼저 풀어 주세요.");
    line();
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  }
  line();
  line("  올립니다…");
  const r = await publish(piece, account, { actor: "ops" });
  line();
  if (r.ok) {
    line(`  ✓ ${r.already ? "이미 올라가 있었다" : r.via === "runner" ? "러너 잡을 넣었다(러너가 올린다)" : "올렸다"}`);
    if (r.externalUrl) line(`  주소: ${r.externalUrl}`);
    if (r.jobId) line(`  러너 잡 #${r.jobId} — 러너 창에서 진행이 보인다. 끝나면 발행함에 주소가 뜬다.`);
  } else {
    line(`  ✗ 못 올렸다 — ${r.error}`);
    line(`  사유: ${r.reason}${r.detail ? ` · ${r.detail}` : ""} · 재시도 ${r.retriable ? "의미 있음" : "무의미"}`);
  }
  line();
  await pgClient.end({ timeout: 5 });
  process.exit(r.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\n  ✗ ${String((e as Error)?.stack ?? e)}\n`);
  await pgClient.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
