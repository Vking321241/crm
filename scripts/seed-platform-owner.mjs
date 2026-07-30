// Bootstraps the very first user — the platform owner. Without
// Supabase's signup flow, nothing else can create the first account:
// /admin requires an existing platform owner, and /accept requires an
// existing auth_tokens row created by one. This script is the only
// way that circle gets broken.
//
// Usage:
//   node scripts/seed-platform-owner.mjs <email> <fullName>
//
// Plain `pg` + raw SQL on purpose (not the Drizzle schema/session
// helpers) — this runs as a one-off command in the production
// container, which only ships compiled JS; importing the app's .ts
// modules directly would need a TS loader we don't otherwise need at
// runtime. Same reasoning as scripts/migrate.mjs.
//
// Idempotent: re-running with the same email reuses the existing
// platform account/user and just issues a fresh set-password link.
import { Pool } from "pg";
import { randomBytes, createHmac } from "node:crypto";

const [, , email, ...nameParts] = process.argv;
const fullName = nameParts.join(" ") || email;

if (!email) {
  console.error("Usage: node scripts/seed-platform-owner.mjs <email> [full name]");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET must be set (same value the app uses)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function generateRawToken() {
  const token = randomBytes(32).toString("hex");
  const hash = createHmac("sha256", process.env.SESSION_SECRET).update(token).digest("hex");
  return { token, hash };
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  let { rows: platformRows } = await client.query(
    `SELECT id FROM accounts WHERE is_platform = true LIMIT 1`,
  );
  let platformId = platformRows[0]?.id;
  if (!platformId) {
    const { rows } = await client.query(
      `INSERT INTO accounts (name, is_platform, max_agent_seats) VALUES ($1, true, 999) RETURNING id`,
      ["DivaryTalk"],
    );
    platformId = rows[0].id;
    console.log(`Created platform account ${platformId}`);
  }

  const normalizedEmail = email.toLowerCase();
  const { rows: userRows } = await client.query(`SELECT id FROM users WHERE email = $1`, [
    normalizedEmail,
  ]);
  let ownerId = userRows[0]?.id;
  if (!ownerId) {
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, account_id, account_role) VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [normalizedEmail, fullName, platformId],
    );
    ownerId = rows[0].id;
    await client.query(`UPDATE accounts SET owner_user_id = $1 WHERE id = $2`, [
      ownerId,
      platformId,
    ]);
    console.log(`Created platform owner user ${ownerId} (${normalizedEmail})`);
  } else {
    console.log(`Reusing existing user ${ownerId} (${normalizedEmail})`);
  }

  const { token, hash } = generateRawToken();
  await client.query(
    `INSERT INTO auth_tokens (purpose, token_hash, target_user_id, expires_at)
     VALUES ('set_password', $1, $2, now() + interval '7 days')`,
    [hash, ownerId],
  );

  await client.query("COMMIT");

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log("\nSet your password here (valid 7 days):");
  console.log(`${base}/accept/${token}`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
