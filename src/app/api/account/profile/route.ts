// PATCH /api/account/profile — update the CALLER's own name / avatar /
// email. Fatia 3: no Supabase Auth updateUser() confirmation-email
// flow anymore (no email sending in this deployment) — email changes
// apply immediately after a uniqueness check.
import { NextResponse } from "next/server";
import { eq, ne, and } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { users } from "@/db/schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as
      | { fullName?: unknown; email?: unknown; avatarUrl?: unknown }
      | null;

    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const avatarUrl =
      body?.avatarUrl === null ? null : typeof body?.avatarUrl === "string" ? body.avatarUrl : undefined;

    if (fullName !== undefined && fullName.length === 0) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    if (email !== undefined && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    try {
      const [updated] = await ctx.db
        .update(users)
        .set({
          ...(fullName !== undefined ? { fullName } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.userId))
        .returning({ id: users.id, fullName: users.fullName, email: users.email, avatarUrl: users.avatarUrl });

      return NextResponse.json({ profile: updated });
    } catch (err) {
      const pgErr = err as { code?: string; cause?: { code?: string } };
      if (pgErr?.code === "23505" || pgErr?.cause?.code === "23505") {
        return NextResponse.json({ error: "Já existe uma conta com este e-mail" }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Referenced only for the unused-import guard below in case a future
// edit needs an "exclude self" uniqueness check instead of relying on
// the DB constraint.
void ne;
void and;
