/**
 * scripts/read-never-touched.mjs — R11-16 «왜 시작조차 못 했나» **세는 자**(읽기 전용 · SELECT 만).
 *
 *   never_touched = `pieces.status='generating'` 인 채 **`created_at == updated_at`** —
 *   배경 함수가 «가다가» 죽은 게 아니라 **첫 갱신(`setStage`) 전에** 끝났다는 뜻이다.
 *   (`content-gen.generatePiece` 는 348줄 `setStage('writing')` 가 첫 쓰기 · 그 앞에서 던지면 catch 가 `failed` 로 적는다
 *    ⇒ `generating` 인 채 한 번도 안 건드려진 행은 **catch 도 못 돈 자리**다.)
 *
 *   🔴 이 자는 **원인을 말하지 않는다.** 갈라 주기만 한다 — 한 집에 몰렸나 · 고루 퍼졌나 · 언제 몰리나.
 *   🔴 쓰기 0. UPDATE·DELETE 한 줄도 없다(AC-50 — 라이브 쓰기는 사장님이 «해»라고 하실 때만).
 *
 *   쓰기: node scripts/read-never-touched.mjs          (.env 의 NETLIFY_DATABASE_URL_UNPOOLED 를 쓴다)
 */
import { readFileSync, existsSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { default: postgres } = await import("postgres");
const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
if (!url) { console.error("🔴 NETLIFY_DATABASE_URL 이 없다 — 못 쟀다."); process.exit(2); }
const s = postgres(url, { ssl: "require", max: 1 });
const P = (t) => console.log(`\n■ ${t}`);
const table = (rows) => { if (!rows.length) { console.log("  (0행)"); return; } for (const r of rows) console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v === null ? "∅" : String(v)}`).join(" · ")); };

try {
  /* ── ① 전체 지형 ── */
  P("① pieces 전체 — 상태별 · never_touched(생성 후 한 번도 안 건드려진 행) 수");
  table(await s`SELECT status, COUNT(*)::int AS rows,
      COUNT(*) FILTER (WHERE created_at = updated_at)::int AS never_touched,
      COUNT(DISTINCT tenant_id)::int AS tenants
    FROM pieces GROUP BY status ORDER BY rows DESC`);

  /* ── ② 지금 멈춘 것(20분 = 배경 함수 수명 15분보다 길다 = 붙들고 있는 일꾼이 없다) ── */
  P("② 지금 멈춰 있는 글 — status='generating' AND updated_at < now()-20분");
  table(await s`SELECT id, tenant_id, kind, origin, channel,
      (created_at = updated_at) AS never_touched,
      ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/60)::int AS age_min,
      meta->>'stage' AS stage,
      (meta ? 'affiliate') AS has_affiliate,
      (meta ? 'sweepResume') AS swept,
      (meta ? 'sweepSkipped') AS sweep_skipped,
      to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS created_kst
    FROM pieces WHERE status = 'generating' AND updated_at < NOW() - interval '20 minutes'
    ORDER BY created_at`);

  /* ── ③ 한 집에 몰렸나 · 고루 퍼졌나 ── */
  P("③ 테넌트별 — 만든 글 수 대비 never_touched 비율(만든 글 1건 이상인 집만)");
  table(await s`SELECT p.tenant_id, t.status AS tenant_status, t.plan_key,
      COUNT(*)::int AS pieces_all,
      COUNT(*) FILTER (WHERE p.created_at = p.updated_at AND p.status = 'generating')::int AS never_touched,
      ROUND(100.0 * COUNT(*) FILTER (WHERE p.created_at = p.updated_at AND p.status = 'generating') / COUNT(*), 1) AS pct,
      COUNT(*) FILTER (WHERE p.status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE p.status NOT IN ('generating','failed'))::int AS got_out
    FROM pieces p LEFT JOIN tenants t ON t.id = p.tenant_id
    GROUP BY p.tenant_id, t.status, t.plan_key ORDER BY never_touched DESC, pieces_all DESC LIMIT 40`);

  /* ── ④ 언제 몰리나 — KST 시각 분포 ── */
  P("④ never_touched 가 언제 만들어졌나(KST 시) vs 같은 시각에 만들어진 글 전체");
  table(await s`WITH x AS (SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::int AS kst_h,
      (created_at = updated_at AND status = 'generating') AS nt FROM pieces)
    SELECT kst_h, COUNT(*)::int AS all_rows, COUNT(*) FILTER (WHERE nt)::int AS never_touched
    FROM x GROUP BY kst_h HAVING COUNT(*) FILTER (WHERE nt) > 0 ORDER BY kst_h`);

  /* ── ⑤ 같은 시점에 여러 개(= 한꺼번에 불렀나) ── */
  P("⑤ 한 분(minute) 안에 여러 글이 같이 만들어졌나 — never_touched 가 낀 분만");
  table(await s`WITH x AS (SELECT date_trunc('minute', created_at) AS m, tenant_id,
      COUNT(*)::int AS made, COUNT(*) FILTER (WHERE created_at = updated_at AND status = 'generating')::int AS nt
    FROM pieces GROUP BY 1, 2)
    SELECT to_char(m AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS minute_kst,
      tenant_id, made, nt FROM x WHERE nt > 0 ORDER BY m`);

  /* ── ⑥ never_touched 행의 생김새 — 프롤로그(첫 쓰기 전)에서 밖으로 나가는 길이 실제로 있었나 ── */
  P("⑥ never_touched 행 낱낱 — 프롤로그에서 «밖으로 나갈 수 있는» 재료를 들고 있나");
  table(await s`SELECT p.id, p.tenant_id, p.origin, p.channel, p.kind,
      (p.meta ? 'affiliate') AS has_affiliate,        -- 쿠팡 검색(외부 HTTP)을 프롤로그에서 탄다
      (p.topic_id IS NOT NULL) AS has_topic,
      (p.brief_id IS NOT NULL) AS has_brief,
      (p.account_id IS NOT NULL) AS has_account,
      p.meta->>'stage' AS stage, p.meta->>'tier' AS tier,
      (SELECT COUNT(*)::int FROM ai_usage u WHERE u.ref = 'piece:' || p.id) AS ai_calls
    FROM pieces p WHERE p.status = 'generating' AND p.created_at = p.updated_at ORDER BY p.id`);

  /* ── ⑦ 🔴 갈림길: «불렀는데 안 돌았나» 를 가르는 유일한 흔적 = 그 글로 AI 를 한 번이라도 불렀나 ── */
  P("⑦ never_touched 행이 AI 를 한 번이라도 불렀나(불렀으면 «시작은 했다»는 뜻 · 0이면 «시작조차»)");
  table(await s`SELECT COUNT(*)::int AS never_touched_rows,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM ai_usage u WHERE u.ref = 'piece:' || p.id) > 0)::int AS with_ai_call
    FROM pieces p WHERE p.status = 'generating' AND p.created_at = p.updated_at`);

  /* ── ⑧ 대조군: 같은 집에서 «나간» 글은 몇 초 만에 첫 갱신이 있었나 ── */
  P("⑧ 대조군 — 빠져나간 글(in_review 이상)의 만들기~첫 갱신 간격(초) 분포");
  table(await s`SELECT tenant_id, COUNT(*)::int AS rows,
      ROUND(MIN(EXTRACT(EPOCH FROM (updated_at - created_at))))::int AS min_s,
      ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))))::int AS avg_s,
      ROUND(MAX(EXTRACT(EPOCH FROM (updated_at - created_at))))::int AS max_s
    FROM pieces WHERE status NOT IN ('generating') GROUP BY tenant_id ORDER BY rows DESC LIMIT 20`);

  /* ── ⑨ 집의 형편(몰려 있으면 «그 집에 무엇이 없나») ── */
  P("⑨ never_touched 를 가진 집의 형편 — 상태·플랜·계정 수·내 키");
  table(await s`WITH aff AS (SELECT DISTINCT tenant_id FROM pieces WHERE status = 'generating' AND created_at = updated_at)
    SELECT t.id, t.key, t.status, t.plan_key,
      (SELECT COUNT(*)::int FROM accounts a WHERE a.tenant_id = t.id) AS accounts,
      (SELECT COUNT(*)::int FROM accounts a WHERE a.tenant_id = t.id AND a.status = 'active') AS accounts_active,
      (SELECT COUNT(*)::int FROM tenant_ai_keys k WHERE k.tenant_id = t.id AND k.status = 'active') AS own_ai_keys,
      to_char(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS joined_kst
    FROM tenants t WHERE t.id IN (SELECT tenant_id FROM aff) ORDER BY t.id`);

  /* ── ⑩ 🔴 세기 전에 물어야 하는 것: **그 집이 고객인가, 우리 하니스인가** ──
     2026-09-19 R11-16 에서 이 줄이 답을 뒤집었다 — 멈춘 3건이 전부 우리 스윕 하니스가 심어 둔 행이었다.
     글을 가진 집을 사람 이메일 도메인까지 찍어 둔다(`test.local`·`autocreate.test` = 우리 것). */
  P("⑩ 글을 가진 집이 누구인가 — key · 사람 이메일 도메인(우리 것이면 «고객 표본»이 아니다)");
  table(await s`SELECT t.id, t.key, t.status, COUNT(DISTINCT p.id)::int AS pieces,
      COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'generating' AND p.created_at = p.updated_at)::int AS never_touched,
      COALESCE(split_part(MIN(u.email), '@', 2), '(사람없음)') AS owner_domain
    FROM tenants t JOIN pieces p ON p.tenant_id = t.id LEFT JOIN users u ON u.tenant_id = t.id
    GROUP BY t.id, t.key, t.status ORDER BY pieces DESC`);

  /* ── ⑪ 스윕이 실제로 본 것 — 다시 건 글(sweepResume) · 일부러 놔둔 글(sweepSkipped) ── */
  P("⑪ 스윕의 흔적 — 다시 걸었나 · 산출물이 있어 놔뒀나(놔둔 것은 «증상»이 아니다)");
  table(await s`SELECT p.id, p.tenant_id, p.status,
      p.meta->'sweepResume'->>'count' AS resume_n,
      p.meta->'sweepSkipped'->>'why' AS skip_why,
      (COALESCE(length(btrim(p.body)),0) > 0) AS has_body,
      EXISTS(SELECT 1 FROM piece_assets a WHERE a.piece_id = p.id) AS has_asset
    FROM pieces p WHERE p.meta ? 'sweepResume' OR p.meta ? 'sweepSkipped' ORDER BY p.id`);

  /* ── ⑫ 갈라 줄 장부가 있나 — AM 은 `bg_runs` 로 갈랐다 ── */
  P("⑫ 배경 실행 장부가 있나(없으면 «시작조차 못 했나»는 다음에도 못 가른다)");
  table(await s`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND (table_name LIKE '%run%' OR table_name LIKE '%job%') ORDER BY table_name`);
} finally { await s.end({ timeout: 5 }); }
