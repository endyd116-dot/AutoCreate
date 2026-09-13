import { json, jsonError } from "../../lib/response";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
export const config = { path: "/api/health" };
export default async (): Promise<Response> => {
  try {
    const r = (await db.execute(sql`SELECT 1 AS ok`)) as unknown as { ok: number }[];
    return json({ ok: true, db: r[0]?.ok === 1, ts: new Date().toISOString() });
  } catch (err) { return jsonError("db", err); }
};
