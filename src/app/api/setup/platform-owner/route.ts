import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, authTokens, users } from "@/db/schema";
import { generateRawToken } from "@/lib/auth/session";

const SET_PASSWORD_TOKEN_TTL_DAYS = 7;

// POST /api/setup/platform-owner
//
// One-time bootstrap for the very first user. Without Supabase's
// signup flow there is no other way to create the platform owner:
// /admin requires an existing one, and /accept requires a token
// issued by one. This is that circle-breaker, reachable over HTTP
// (rather than a container exec/log-reading step, which EasyPanel's
// API doesn't expose) — guarded by a build-time secret
// (SETUP_TOKEN) and self-disabling once the platform owner already
// has a password set.
export async function POST(request: Request) {
  const setupToken = process.env.SETUP_TOKEN;
  if (!setupToken) {
    return NextResponse.json({ error: "Setup is not enabled" }, { status: 404 });
  }
  if (request.headers.get("x-setup-token") !== setupToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    fullName?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const fullName = body?.fullName?.trim() || email;
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const [platform] = await db.select().from(accounts).where(eq(accounts.isPlatform, true)).limit(1);

  if (platform?.ownerUserId) {
    const [owner] = await db.select().from(users).where(eq(users.id, platform.ownerUserId)).limit(1);
    if (owner?.passwordHash) {
      return NextResponse.json(
        { error: "Platform owner already configured" },
        { status: 403 },
      );
    }
  }

  const platformId = platform
    ? platform.id
    : (
        await db
          .insert(accounts)
          .values({ name: "DivaryTalk", isPlatform: true, maxAgentSeats: 999 })
          .returning({ id: accounts.id })
      )[0].id;

  let [owner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!owner) {
    [owner] = await db
      .insert(users)
      .values({ email, fullName: fullName ?? email, accountId: platformId, accountRole: "owner" })
      .returning();
    await db.update(accounts).set({ ownerUserId: owner.id }).where(eq(accounts.id, platformId));
  }

  const { token, hash } = generateRawToken();
  await db.insert(authTokens).values({
    purpose: "set_password",
    tokenHash: hash,
    targetUserId: owner.id,
    expiresAt: new Date(Date.now() + SET_PASSWORD_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
  return NextResponse.json({ setPasswordLink: `${base}/accept/${token}` });
}
