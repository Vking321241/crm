import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSessionUser, hashPassword, verifyPassword } from "@/lib/auth/session";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MIN_PASSWORD_LENGTH = 8;

// POST /api/auth/change-password — replaces the old
// signInWithPassword-then-updateUser dance from Supabase Auth (which
// doesn't exist anymore). Verifies the current password server-side
// against users.password_hash before accepting the new one.
export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`auth:changePassword:${session.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;

  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (!currentPassword || !newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` },
      { status: 400 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  return NextResponse.json({ ok: true });
}
