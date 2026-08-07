// ============================================================
// POST /api/auth/forgot-password — { email }
//
// Always responds with the same generic message regardless of
// whether the email matches a user, so the endpoint can't be used
// to enumerate accounts. If SMTP isn't configured (isEmailConfigured
// false), silently no-ops past validation — the old "ask your admin"
// flow stays the fallback (see the forgot-password page).
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import { generateRawToken } from "@/lib/auth/session";
import { isEmailConfigured, passwordResetEmailHtml, sendEmail } from "@/lib/email/mailer";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const RESET_TOKEN_TTL_HOURS = 2;

function baseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

const GENERIC_RESPONSE = {
  ok: true,
  message: "Se este e-mail existir na nossa base, enviamos um link de redefinição de senha.",
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Informe o e-mail" }, { status: 400 });
  }

  const limit = checkRateLimit(`auth:forgotPassword:${email}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  if (!isEmailConfigured()) {
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const { token, hash } = generateRawToken();
    await db.insert(authTokens).values({
      purpose: "set_password",
      tokenHash: hash,
      targetUserId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      label: "Redefinição de senha (self-service)",
    });

    const link = `${baseUrl(request)}/accept/${token}`;
    await sendEmail({
      to: user.email,
      subject: "Redefinir sua senha — DivaryTalk",
      html: passwordResetEmailHtml(link),
    });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
