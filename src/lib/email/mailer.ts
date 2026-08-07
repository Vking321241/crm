import nodemailer, { type Transporter } from "nodemailer";

// SMTP-based transactional email — password reset links today, room
// for invite/notification emails later. Configured entirely via env
// vars (SMTP_HOST/PORT/USER/PASS/FROM); when they're absent
// `getTransporter()` returns null and callers fall back to the
// "hand the link to the admin" flow this app shipped with before.
let _transporter: Transporter | null | undefined;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): Transporter | null {
  if (_transporter !== undefined) return _transporter;
  if (!isEmailConfigured()) {
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

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, error: "SMTP not configured" };

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    console.error("[sendEmail] failed:", err);
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
