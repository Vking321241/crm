import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/db/client";
import { effectiveModules, roleHasFullAccess } from "@/lib/auth/permissions";
import { getGrantedModules } from "@/lib/auth/permissions-data";

// GET /api/auth/me — replaces the browser calling Supabase directly
// for `auth.getUser()` + the profiles/accounts lookup. src/hooks/use-auth.tsx
// is the sole client-side consumer of this route.
export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ user: null, account: null }, { status: 200 });
  }

  const granted = roleHasFullAccess(session.accountRole)
    ? new Set<string>()
    : await getGrantedModules(db, session.userId);

  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      fullName: session.fullName,
      avatarUrl: session.avatarUrl,
      createdAt: session.createdAt.toISOString(),
      accountId: session.accountId,
      accountRole: session.accountRole,
    },
    account: session.account,
    permissions: effectiveModules(session.accountRole, granted),
  });
}
