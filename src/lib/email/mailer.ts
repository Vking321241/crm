import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

// Transactional email — password reset links today, room for
// invite/notification emails later. Two providers, either one
// optional:
//   - RESEND_API_KEY (preferred — no server-to-server SMTP port to
//     get blocked, domain verification is a DNS TXT/CNAME add).
//   - SMTP_HOST/PORT/USER/PASS (generic fallback, e.g. Gmail app
//     password).
// When neither is set, `isEmailConfigured()` is false and callers
// fall back to the "hand the link to the admin" flow this app
// shipped with before.

let _resend: Resend | null | undefined;
let _transporter: Transporter | null | undefined;

function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function isEmailConfigured(): boolean {
  return resendConfigured() || smtpConfigured();
}

function getResend(): Resend | null {
  if (_resend !== undefined) return _resend;
  _resend = resendConfigured() ? new Resend(process.env.RESEND_API_KEY) : null;
  return _resend;
}

function getTransporter(): Transporter | null {
  if (_transporter !== undefined) return _transporter;
  if (!smtpConfigured()) {
    _transporter = null;
    return null;
  }
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

// Shared "who this comes from" — falls back to Resend's own
// no-verification-needed test sender when nothing else is set, so a
// bare RESEND_API_KEY (no domain verified yet) still works.
function fromAddress(): string {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "DivaryTalk <onboarding@resend.dev>";
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      console.error("[sendEmail] Resend failed:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const transporter = getTransporter();
  if (!transporter) return { ok: false, error: "No email provider configured" };

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    console.error("[sendEmail] SMTP failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

export function passwordResetEmailHtml(link: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Redefinir sua senha — DivaryTalk</h2>
      <p>Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha. Este link expira em 2 horas.</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Redefinir senha
        </a>
      </p>
      <p style="color:#666;font-size:13px;">Se você não pediu isso, pode ignorar este e-mail com segurança.</p>
    </div>
  `;
}
