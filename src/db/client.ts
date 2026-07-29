import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Single pooled connection, shared across the process. `DATABASE_URL`
// points at the app's own Postgres service on the VPS (see
// .env.local.example) — never the storage database (src/db/storage-schema.ts
// + src/db/storage-client.ts), which is intentionally a separate
// service/connection per the "segundo banco só pra isso" requirement.
let _pool: Pool | null = null;

function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export const db = drizzle(pool(), { schema });
export type Db = typeof db;
