// ============================================================
// DivaryTalk's own session layer — replaces Supabase Auth.
//
// Sessions are DB-backed rows (src/db/schema.ts: `sessions`), not
// JWTs, so a logout or a password change can actually revoke access
// immediately instead of waiting out a token's lifetime.
//
// The cookie holds `<sessionId>.<hmac>` — the HMAC (keyed by
// SESSION_SECRET) lets a tampered/forged session id be rejected
// before it ever reaches the database, the same defense-in-depth
// role Supabase's signed JWT played, just applied to an opaque id
// instead of a self-contained token.
// ============================================================

import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "@/db/client";
import { sessions, users, accounts } from "@/db/schema";

export const SESSION_COOKIE_NAME = "divarytalk_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 12;

function secret(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is not configured");
  return key;
}

function sign(sessionId: string): string {
  return createHmac("sha256", secret()).update(sessionId).digest("hex");
}

function packCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

/** Returns the session id iff the signature is valid; null otherwise. */
function unpackCookie(cookieValue: string): string | null {
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);
  const expectedSig = sign(sessionId);
  // Both hex strings of the same known length (HMAC-SHA256 = 64 hex
  // chars) — timingSafeEqual requires equal-length buffers, so a
  // length mismatch (a garbage cookie) is checked first.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Creates a session row and sets the signed cookie on the response. */
export async function createSession(userId: string): Promise<void> {
  const [row] = await db
    .insert(sessions)
    .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning({ id: sessions.id });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, packCookie(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionId = raw ? unpackCookie(raw) : null;
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: Date;
  accountId: string;
  accountRole: "owner" | "admin" | "agent" | "viewer";
  account: { id: string; name: string; isPlatform: boolean; maxAgentSeats: number };
}

/**
 * Resolves the current request's session cookie into the user +
 * account row, or null if there's no valid/unexpired session.
 * This is the sole read path other server code should use to learn
 * "who is calling" — see `getCurrentAccount()` in ./account.ts.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;

  const sessionId = unpackCookie(raw);
  if (!sessionId) return null;

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      accountId: users.accountId,
      accountRole: users.accountRole,
      sessionExpiresAt: sessions.expiresAt,
      accountName: accounts.name,
      isPlatform: accounts.isPlatform,
      maxAgentSeats: accounts.maxAgentSeats,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.sessionExpiresAt.getTime() < Date.now()) return null;

  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
    accountId: row.accountId,
    accountRole: row.accountRole,
    account: {
      id: row.accountId,
      name: row.accountName,
      isPlatform: row.isPlatform,
      maxAgentSeats: row.maxAgentSeats,
    },
  };
}

export function generateRawToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  const hash = createHmac("sha256", secret()).update(token).digest("hex");
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}
