// ============================================================
// POST /api/public/signup-leads — public, no auth. Submitted from
// the "obrigado" page (src/app/assinar/obrigado) right after a
// visitor completes checkout on Kiwify: company name, domain
// (optional), email, phone. Stores the lead and notifies every
// admin/owner on the platform account so Divary's team can create
// the client (via /admin, same "Criar cliente" flow as always) and
// send them their access link — this form doesn't provision an
// account by itself.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, notifications, signupLeads, users } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { companyName?: unknown; domain?: unknown; email?: unknown; phone?: unknown }
    | null;

  const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : "";
  const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!companyName || !email || !phone) {
    return NextResponse.json(
      { error: "Nome da empresa, e-mail e telefone são obrigatórios." },
      { status: 400 },
    );
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  const limit = checkRateLimit(`public:signupLead:${email}`, RATE_LIMITS.publicSignupLead);
  if (!limit.success) return rateLimitResponse(limit);

  await db.insert(signupLeads).values({
    companyName,
    domain: domain || null,
    email,
    phone,
  });

  // Notify every admin/owner of the platform account (there's exactly
  // one is_platform=true row — see accounts schema comment).
  const [platformAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.isPlatform, true))
    .limit(1);

  if (platformAccount) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.accountId, platformAccount.id),
          inArray(users.accountRole, ["owner", "admin"]),
        ),
      );

    if (admins.length > 0) {
      await db.insert(notifications).values(
        admins.map((admin) => ({
          accountId: platformAccount.id,
          userId: admin.id,
          type: "signup_lead" as const,
          title: `Nova assinatura: ${companyName}`,
          body: `${phone} · ${email}${domain ? ` · domínio: ${domain}` : ""}`,
        })),
      );
    }
  } else {
    console.error("[signup-leads] no platform account found — lead saved but no notification sent");
  }

  return NextResponse.json({ ok: true });
}
