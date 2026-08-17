// ============================================================
// Outbound sending for the automations engine.
//
// The engine used to send through the Meta Cloud API (this file
// used to be `meta-send.ts`). The product now sends everything
// through UAZAPI (see src/lib/whatsapp/uazapi-client.ts), which has
// no template or native-interactive-message concept — only
// send/text and send/media. `send_buttons` / `send_list` /
// `send_template` steps stay in the automation builder (accounts may
// already have them saved) but render down to plain text at send
// time via `interactivePayloadToText` / a `{{n}}`-placeholder fill,
// same as broadcasts and quick replies already do for interactive
// payloads sent over UAZAPI.
// ============================================================

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts, conversations, messages, whatsappInstances } from "@/db/schema";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendText, type UazapiInstanceConfig } from "@/lib/whatsapp/uazapi-client";
import { interactivePayloadToText, type InteractiveMessagePayload } from "@/lib/whatsapp/interactive";

interface SendArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
}

async function loadUazapiConfig(accountId: string): Promise<UazapiInstanceConfig> {
  const [instance] = await db
    .select()
    .from(whatsappInstances)
    .where(eq(whatsappInstances.accountId, accountId))
    .limit(1);

  if (!instance || instance.status !== "connected" || !instance.uazapiToken) {
    throw new Error("WhatsApp instance is not connected for this account");
  }

  return { baseUrl: instance.uazapiUrl ?? "", token: decrypt(instance.uazapiToken) };
}

async function loadContactPhone(accountId: string, contactId: string): Promise<string> {
  const [contact] = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contact) throw new Error("Contact not found");
  return contact.phone;
}

/** Sends the text, persists the `messages` row, and bumps the conversation's preview — shared by every engineSend* below. */
async function sendAndPersist(
  args: SendArgs,
  text: string,
  extra: { contentType?: (typeof messages.$inferInsert)["contentType"]; interactivePayload?: unknown } = {},
): Promise<{ whatsapp_message_id: string }> {
  const cfg = await loadUazapiConfig(args.accountId);
  const phone = await loadContactPhone(args.accountId, args.contactId);

  const result = await sendText(cfg, phone, text);
  if (!result.ok) throw new Error(result.error || "UAZAPI send failed");
  const messageId = result.data?.externalId ?? null;

  await db.insert(messages).values({
    conversationId: args.conversationId,
    senderType: "bot",
    senderId: args.userId,
    contentType: extra.contentType ?? "text",
    contentText: text,
    messageId,
    status: "sent",
    interactivePayload: extra.interactivePayload ?? null,
  });

  await db
    .update(conversations)
    .set({ lastMessageText: text, lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, args.conversationId));

  return { whatsapp_message_id: messageId ?? "" };
}

export async function engineSendText(
  args: SendArgs & { text: string },
): Promise<{ whatsapp_message_id: string }> {
  return sendAndPersist(args, args.text);
}

export async function engineSendInteractive(
  args: SendArgs & { payload: InteractiveMessagePayload },
): Promise<{ whatsapp_message_id: string }> {
  return sendAndPersist(args, interactivePayloadToText(args.payload), {
    contentType: "interactive",
    interactivePayload: args.payload,
  });
}

export async function engineSendTemplate(
  args: SendArgs & {
    templateName: string;
    language?: string;
    params: string[];
  },
): Promise<{ whatsapp_message_id: string }> {
  // No template engine on UAZAPI — render the name + positional params
  // as a plain-text stand-in so the step still sends *something*
  // useful instead of silently no-oping.
  const text =
    args.params.length > 0
      ? `${args.templateName}: ${args.params.join(", ")}`
      : args.templateName;
  return sendAndPersist(args, text);
}
