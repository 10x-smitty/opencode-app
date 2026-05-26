import pg from "pg";
import { getEnv } from "./env";

const globalForPg = globalThis as typeof globalThis & {
  pgPool?: pg.Pool;
};

export function getPool() {
  const pool =
    globalForPg.pgPool ??
    new pg.Pool({
      connectionString: getEnv().databaseUrl,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPg.pgPool = pool;
  }

  return pool;
}
