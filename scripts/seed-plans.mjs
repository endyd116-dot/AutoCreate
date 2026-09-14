// scripts/seed-plans.mjs — plans(코드 기본값 → DB · 없는 키만) + channel_registry(DESIGN §2) + emotion_profiles 기본 시드. 멱등.
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 });

// ── 플랜(lib/plans.ts PLAN_DEFAULTS 와 값 동일 — 두 벌이지만 시드는 1회·이후 DB가 정본)
const plans = [
  ["trial", "체험", 0, 0, { maxAccounts: 5, coinsIncluded: 0, runnerDevices: 1, teamSeats: 1, horizonDays: 14, maxRules: null }, { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "no", runnerRevenue: true, teamApproval: false }, false, false, 0],
  ["starter", "Starter", 19000, 190000, { maxAccounts: 3, coinsIncluded: 40, runnerDevices: 1, teamSeats: 1, horizonDays: 7, maxRules: 3 }, { directorEdit: false, autoSchedule: true, failover: false, managedRunner: "no", runnerRevenue: false, teamApproval: false }, true, false, 1],
  ["pro", "Pro", 49000, 490000, { maxAccounts: 15, coinsIncluded: 150, runnerDevices: 2, teamSeats: 2, horizonDays: 30, maxRules: null }, { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "option", runnerRevenue: true, teamApproval: false }, true, true, 2],
  ["agency", "Agency", 149000, 1490000, { maxAccounts: 50, coinsIncluded: 500, runnerDevices: 5, teamSeats: 5, horizonDays: 30, maxRules: null }, { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "included", runnerRevenue: true, teamApproval: true }, true, false, 3],
];
for (const [key, name, pm, py, limits, features, pub, rec, sort] of plans) {
  await sql`INSERT INTO plans (key, name, price_month, price_year, limits, features, public, recommended, sort)
    VALUES (${key}, ${name}, ${pm}, ${py}, ${sql.json(limits)}, ${sql.json(features)}, ${pub}, ${rec}, ${sort}) ON CONFLICT (key) DO NOTHING`;
}

// ── 채널 레지스트리(DESIGN §2 · 상태는 «라이브 검증 전 전부 planned» — AM 정책)
const channels = [
  ["naver_blog", "네이버 블로그", "text", "runner", [7.5, 12, 21], ["adpost", "coupang", "shoppingconnect"], 1],
  ["tistory", "티스토리", "text", "runner", [8, 13], ["adsense", "adfit", "coupang"], 2],
  ["blogger", "블로거", "text", "api", [9], ["adsense"], 3],
  ["wordpress", "워드프레스", "text", "api", [9], ["adsense", "coupang"], 4],
  ["threads", "쓰레드", "text", "api", [8, 22], ["traffic"], 5],
  ["instagram", "인스타그램", "text", "api", [12, 19], ["affiliate"], 6],
  ["youtube_shorts", "유튜브 쇼츠", "video", "api", [18, 21], ["ypp", "youtube_shopping", "coupang"], 10],
  ["naver_clip", "네이버 클립", "video", "runner", [19, 22], ["clip_incentive", "shoppingconnect"], 11],
  ["reels", "릴스", "video", "api", [12, 19], ["affiliate"], 12],
  ["tiktok", "틱톡", "video", "api", [19, 22], ["affiliate"], 13],
];
// 발행 경로가 실제로 있는 채널만 active(고객 «계정 연결» 그리드는 active 만 그린다 · ui-v4). 영상·SNS 는 Phase 3 에서 켠다(운영센터 «채널» 메뉴).
const ACTIVE_CHANNELS = new Set(["naver_blog", "tistory", "blogger", "wordpress"]);
for (const [key, label, cat, via, hours, mon, sort] of channels) {
  await sql`INSERT INTO channel_registry (key, label, category, publish_via, status, best_hours, monetize, sort)
    VALUES (${key}, ${label}, ${cat}, ${via}, ${ACTIVE_CHANNELS.has(key) ? "active" : "planned"}, ${sql.json(hours)}, ${sql.json(mon)}, ${sort}) ON CONFLICT (key) DO NOTHING`;
}

// ── 감성 프로파일 기본(DESIGN §5C.1 요약 · 운영센터에서 조정)
const profiles = [
  ["naver_blog.story", "naver_blog", "경험담·친근", { tone: "구어 존댓말(~했어요/~더라고요)", structure: ["hook", "photo+caption", "quote", "body", "photos", "checklist", "body", "divider", "tip", "hashtags"], images: [6, 10], length: [1500, 2500], titleStyle: "naver" }],
  ["tistory.info", "tistory", "정보·정리", { tone: "격식 존댓말(~합니다)", structure: ["toc", "h2", "table|list", "h2", "adsense", "h2", "summary", "faq", "adsense"], images: [2, 4], length: [1800, 3000], titleStyle: "google" }],
  ["threads.hook", "threads", "훅·짧게", { tone: "가벼운 반말/존댓말", structure: ["hook", "3-5lines", "link-in-reply"], length: [0, 500] }],
  ["youtube_shorts.graphic", "youtube_shorts", "3초 훅·자막 본체", { tone: "구어체", cuts: [4, 8], seconds: [15, 60], captionsPrimary: true }],
];
for (const [key, ch, label, contract] of profiles) {
  await sql`INSERT INTO emotion_profiles (key, channel, label, contract) VALUES (${key}, ${ch}, ${label}, ${sql.json(contract)}) ON CONFLICT (key) DO NOTHING`;
}
const [{ c: pc }] = await sql`SELECT COUNT(*)::int AS c FROM plans`;
const [{ c: cc }] = await sql`SELECT COUNT(*)::int AS c FROM channel_registry`;
console.log(`plans ${pc} · channels ${cc} · profiles seeded`);
await sql.end();
