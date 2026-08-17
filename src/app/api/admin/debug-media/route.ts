// ============================================================
// GET /api/admin/debug-media — TEMPORARY troubleshooting route for
// the inbound-media-not-rendering bug. Renders the last 20 media
// messages (any content_type except text) for the caller's own
// account as plain readable HTML, so whoever's diagnosing this can
// just open the URL in a browser they're already logged into and
// screenshot it — no DevTools/log access needed.
//
// Safe to delete once the underlying bug (src/lib/storage/server-
// files.ts saveInboundMedia) is confirmed fixed — this exposes
// media_url values (not the file bytes themselves) to any admin/
// owner of the account, gated by the same session auth as
// everything else.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, ne } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversations, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const rows = await ctx.db
      .select({
        id: messages.id,
        senderType: messages.senderType,
        contentType: messages.contentType,
        mediaUrl: messages.mediaUrl,
        messageId: messages.messageId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.accountId, ctx.accountId), ne(messages.contentType, "text")))
      .orderBy(desc(messages.createdAt))
      .limit(20);

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Debug mídia</title>
<style>
  body { font-family: ui-monospace, monospace; background: #0b0f16; color: #dfe6f0; padding: 24px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #2a3242; vertical-align: top; }
  th { color: #8891a1; font-weight: 600; }
  .in { color: #5b8dff; }
  .out { color: #4fce93; }
  .url { word-break: break-all; max-width: 480px; }
  .null { color: #e3ac52; }
</style></head>
<body>
<h2>Últimas 20 mensagens de mídia — conta atual</h2>
<p>senderType "customer" = recebida · "agent" = enviada</p>
<table>
<tr><th>Quando</th><th>De</th><th>Tipo</th><th>media_url</th><th>message_id (WhatsApp)</th></tr>
${rows
  .map(
    (r) => `<tr>
  <td>${r.createdAt.toISOString()}</td>
  <td class="${r.senderType === "customer" ? "in" : "out"}">${r.senderType}</td>
  <td>${r.contentType}</td>
  <td class="url">${r.mediaUrl ? escapeHtml(r.mediaUrl) : '<span class="null">null</span>'}</td>
  <td>${r.messageId ? escapeHtml(r.messageId) : '<span class="null">null</span>'}</td>
</tr>`,
  )
  .join("\n")}
</table>
</body></html>`;

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
