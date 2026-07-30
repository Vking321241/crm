import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { destroyCurrentSession, getSessionUser } from "@/lib/auth/session";

// POST /api/auth/logout-all — replaces
// `supabase.auth.signOut({ scope: 'global' })`. Deletes every
// sessions row for this user (every device/tab), then clears the
// caller's own cookie the normal way.
export async function POST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.delete(sessions).where(eq(sessions.userId, session.userId));
  await destroyCurrentSession();

  return NextResponse.json({ ok: true });
}
