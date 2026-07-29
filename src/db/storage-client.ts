import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as storageSchema from "./storage-schema";

// Separate connection pool from src/db/client.ts on purpose — a
// distinct Postgres service (`STORAGE_DATABASE_URL`), per the
// requirement to keep file metadata out of the main app database.
let _pool: Pool | null = null;

function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.STORAGE_DATABASE_URL });
  }
  return _pool;
}

export const storageDb = drizzle(pool(), { schema: storageSchema });
