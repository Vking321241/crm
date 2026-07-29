// Runtime migration runner — deliberately NOT drizzle-kit (a
// devDependency, stripped from the standalone Docker image).
// `drizzle-orm/node-postgres/migrator` is a normal runtime
// dependency, so this script can run inside the production
// container (as the EasyPanel "pre-deploy command", or manually)
// without needing the dev toolchain.
//
// Usage: node scripts/migrate.mjs main | node scripts/migrate.mjs storage
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const target = process.argv[2];

const targets = {
  main: { url: process.env.DATABASE_URL, folder: "./drizzle" },
  storage: { url: process.env.STORAGE_DATABASE_URL, folder: "./drizzle-storage" },
};

if (!target || !targets[target]) {
  console.error(`Usage: node scripts/migrate.mjs <${Object.keys(targets).join("|")}>`);
  process.exit(1);
}

const { url, folder } = targets[target];
if (!url) {
  console.error(`Missing connection string for "${target}" migration target`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

console.log(`Applying ${target} migrations from ${folder} …`);
await migrate(db, { migrationsFolder: folder });
console.log(`${target} migrations applied.`);

await pool.end();
