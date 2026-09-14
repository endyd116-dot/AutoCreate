/**
 * scripts/verify-api-channels.mts — API 채널(블로거·워드프레스) **«자격 없음» 정직 경로** 실증(계약 P1R4 · DESIGN §2·§8).
 *
 *   `npx tsx --env-file=.env scripts/verify-api-channels.mts`
 *
 *   왜 따로 있나: 네이버·티스토리는 **러너(브라우저)** 채널이지만 블로거·워드프레스는 **REST API** 채널이다
 *   (`lib/publish/index.ts` ④-B — 지금 바로 올리고 finalize 까지). 그래서 러너 하니스로는 이 둘을 못 본다.
 *
 *   🔴 이 스크립트가 증명하는 것 = «자격이 없을 때 우리가 어떻게 실패하는가».
 *      자격(account_creds)을 **일부러 0행**으로 두고 `publish()` 를 부른다. 통과 기준은 «성공»이 아니라 **정직**이다:
 *        ① `ok:false` + `reason:"no_creds"`(사람말 메시지 동반) — 조용한 0건도, 가짜 성공도 아니다(AC-9).
 *        ② piece 가 published 로 바뀌지 않는다 · `external_url` 이 안 생긴다.
 *        ③ `posts` 0행 — 남의 서버에 아무것도 안 올라갔고 우리도 올라간 척하지 않는다.
 *        ④ 감사에 `publish_failed` 가 남는다(무슨 일이 있었는지 사라지지 않는다).
 *      🔴 발행은 일어나지 않는다 — 자격이 없으므로 네트워크 호출 전에 멈춘다(남의 계정에 글 0건).
 *   끝나면 만든 테넌트를 지운다.
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { publish, loadPublishPiece, loadPublishAccount } from "../lib/publish/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 자격 종류만 다르고 «자격 없음»은 같다. handle 은 형식만 갖춘 가짜(호출까지 가지 않는다). */
const CHANNELS = [
  { channel: "blogger", handle: "ac-verify.blogspot.com", authMethod: "oauth" },
  { channel: "wordpress", handle: "https://ac-verify.example.com", authMethod: "app_password" },
];

async function main() {
  const stamp = Date.now();
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status)
    VALUES (${`apiver${stamp}`.slice(0, 40)}, ${"API채널실증"}, 'starter', 'active') RETURNING id`);
  const tid = n(t?.id);

  console.log(`\n── API 채널 «자격 없음» 정직 경로 실증 (테넌트 ${tid}) ──`);
  console.log("   🔴 account_creds 를 일부러 0행으로 둔다 — 발행은 일어나지 않는다.\n");

  let allHonest = true;
  try {
    for (const c of CHANNELS) {
      const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, daily_cap, min_gap_min, posts_today)
        VALUES (${tid}, ${c.channel}, ${c.handle}, ${c.authMethod}, 'active', 3, 60, 0) RETURNING id`);
      const accountId = n(a?.id);
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
        VALUES (${tid}, ${accountId}, ${c.channel}, 'post', 'info', ${`[실증] 자격없음 ${c.channel} ${stamp}`},
                ${"<p>자격 없음 경로 확인용 본문입니다.</p>"}, ${jsonb([])}, ${jsonb({ tags: [] })}, 'scheduled') RETURNING id`);
      const pieceId = n(p?.id);

      const piece = await loadPublishPiece(tid, pieceId);
      const account = await loadPublishAccount(tid, accountId);
      const r = await publish(piece!, account!, { actor: "user" }) as Record<string, unknown>;

      const [after] = await q(sql`SELECT status, external_url FROM pieces WHERE id = ${pieceId}`);
      const posts = (await q(sql`SELECT id FROM posts WHERE tenant_id = ${tid} AND piece_id = ${pieceId}`)).length;
      // 정직 = 실패를 실패라 말하고(사람말 포함) · 발행 흔적을 만들지 않았다.
      const honest = r.ok !== true && !!r.error && posts === 0 && !after?.external_url && String(after?.status ?? "") !== "published";
      if (!honest) allHonest = false;

      console.log(`   ${c.channel}`);
      console.log(`     publish() → ok=${r.ok} reason=${String(r.reason ?? "-")} retriable=${String(r.retriable ?? "-")}`);
      console.log(`     메시지   : ${String(r.error ?? "-")}`);
      console.log(`     piece    : status=${String(after?.status ?? "?")} external_url=${after?.external_url ?? "null"} · posts ${posts}행`);
      console.log(`     판정     : ${honest ? "✓ 정직(가짜 성공·조용한 0건 아님)" : "✗ 정직하지 않다"}\n`);
    }

    const aud = await q(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tid} ORDER BY id`);
    console.log(`   감사 ${aud.length}행: ${aud.map((x) => String(x.action)).join(", ") || "(없음)"}`);
  } finally {
    for (const table of ["posts", "runner_jobs", "account_creds", "piece_assets", "pieces", "accounts", "notifications", "audit_logs"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tid}`).catch(() => {});
    console.log(`   (테넌트 ${tid} 정리 완료)`);
    await pgClient.end({ timeout: 5 });
  }

  console.log(allHonest
    ? "\n   ✓ 두 채널 모두 «자격 없음»을 정직하게 멈춘다(발행 0건).\n"
    : "\n   ✗ 정직하지 않은 채널이 있다 — 위 판정을 보고 고친다.\n");
  process.exit(allHonest ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
