import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { parseUazapiWebhook } from "@/lib/whatsapp/uazapi-client";

// The UAZAPI webhook is registered per-instance
// (`/api/whatsapp/uazapi/webhook/<instanceId>`, wired up by
// configureWebhook() right after a successful connect — see
// src/app/api/whatsapp/instance/status/route.ts). The instance id
// in the URL is how we resolve which client account owns an
// inbound event, without depending on UAZAPI's payload to name the
// instance itself.
//
// Mirrors the shape of the Meta webhook handler
// (src/app/api/whatsapp/webhook/route.ts) for the parts that
// still apply here — service-role client, ack-then-process via
// `after()`, shared contact/conversation dedupe helpers — but
// deliberately does not wire up automations, flows, or the AI
// auto-reply engine: those modules are not part of DivaryTalk.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  const body = await request.json().catch(() => null);

  // Ack immediately, process after — same reasoning as the Meta
  // handler: `after()` keeps the function alive for the DB writes
  // below even on a serverless runtime that could otherwise freeze
  // right after the response is sent.
  after(async () => {
    try {
      await processInbound(instanceId, body);
    } catch (err) {
      console.error("[uazapi webhook] processing error:", err);
    }
  });

  return NextResponse.json({ status: "received" }, { status: 200 });
}

async function processInbound(instanceId: string, body: unknown) {
  const parsed = parseUazapiWebhook(body);
  if (!parsed) return;

  const { data: instance, error: instanceErr } = await supabaseAdmin()
    .from("whatsapp_instances")
    .select("account_id, accounts(owner_user_id)")
    .eq("id", instanceId)
    .maybeSingle();

  if (instanceErr || !instance) {
    console.error(
      "[uazapi webhook] unknown instance id:",
      instanceId,
      instanceErr,
    );
    return;
  }

  const accountId = instance.account_id as string;
  const account = instance.accounts as unknown as { owner_user_id: string } | null;
  const ownerUserId = account?.owner_user_id;
  if (!ownerUserId) {
    console.error("[uazapi webhook] instance has no resolvable account owner:", instanceId);
    return;
  }

  // Group chats aren't modeled as contacts/conversations in this
  // slice — same scope boundary as everything else in this fatia.
  if (parsed.isGroup) return;
  if (!parsed.phone) return;

  const contact = await findOrCreateContact(
    accountId,
    ownerUserId,
    parsed.phone,
    parsed.contactName,
  );
  if (!contact) return;

  const conversation = await findOrCreateConversation(accountId, ownerUserId, contact.id);
  if (!conversation) return;

  const contentText =
    parsed.type === "location" ? parsed.text : parsed.text ?? null;

  const { error: msgError } = await supabaseAdmin()
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: parsed.fromMe ? "agent" : "customer",
      content_type: parsed.type,
      content_text: contentText,
      media_url: parsed.mediaUrl,
      message_id: parsed.externalId,
      status: "delivered",
    });

  if (msgError) {
    console.error("[uazapi webhook] message insert error:", msgError);
    return;
  }

  const { error: convError } = await supabaseAdmin()
    .from("conversations")
    .update({
      last_message_text: contentText || `[${parsed.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: parsed.fromMe
        ? conversation.unread_count
        : (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  if (convError) {
    console.error("[uazapi webhook] conversation update error:", convError);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function findOrCreateContact(
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string | null,
): Promise<Row | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await supabaseAdmin()
        .from("contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return existing;
  }

  const { data: created, error } = await supabaseAdmin()
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return findExistingContact(supabaseAdmin(), accountId, phone);
    }
    console.error("[uazapi webhook] contact insert error:", error);
    return null;
  }
  return created;
}

async function findOrCreateConversation(
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<Row | null> {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from("conversations")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findError) {
    console.error("[uazapi webhook] conversation lookup error:", findError);
    return null;
  }
  if (existingRows && existingRows.length > 0) return existingRows[0];

  const { data: created, error: createError } = await supabaseAdmin()
    .from("conversations")
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from("conversations")
        .select("*")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) return raced[0];
    }
    console.error("[uazapi webhook] conversation insert error:", createError);
    return null;
  }
  return created;
}
