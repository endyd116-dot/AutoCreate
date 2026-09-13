/** Drizzle DB 클라이언트 (Neon + postgres-js) — AM 원본: ../AutoMarketing/db/index.ts (복사 2026-09-14 · 주석 축약) */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || "";

// 서버리스 튜닝(AM 실측): prepare off · max 5(다중 SELECT 병렬) · idle 90s(워밍 인스턴스 재연결 제거).
const client = postgres(connectionString, { ssl: "require", prepare: false, max: 5, idle_timeout: 90, connect_timeout: 10 });

export const db = drizzle(client, { schema });
export { schema, client as pgClient };
