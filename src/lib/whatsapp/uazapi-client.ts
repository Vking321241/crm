// ============================================================
// DivaryTalk — UAZAPI adapter (ISOLATED layer)
// ------------------------------------------------------------
// Every call to the UAZAPI HTTP API goes through this file. If a
// field name differs on your UAZAPI installation/version, this is
// the only file to touch — nothing else in the CRM knows the wire
// format.
//
// Two distinct tokens:
//   - `admintoken` — the UAZAPI *server* token (not tied to a
//     client). Only used to create a new instance.
//   - `token` — per-instance token, returned by instance creation.
//     Used for everything that operates on ONE instance: connect/
//     QR, status, disconnect, delete, send, webhook config.
//
// Endpoint set confirmed against a live legacy integration
// (send/text, send/media, message/download, message/delete,
// instance/status, webhook config) plus the documented UAZAPI
// instance-lifecycle contract (instance/init, instance/connect,
// instance/disconnect). Response parsing is deliberately
// tolerant — tries several common field names and uses the first
// that exists — because UAZAPI's payload shape has been observed
// to vary across versions/installs. If your account's exact field
// names differ, adjust the `pick*` helpers below; call sites don't
// need to change.
// ============================================================

export interface UazapiInstanceConfig {
  /** e.g. https://SEUSERVIDOR.uazapi.com */
  baseUrl: string;
  /** Per-instance token. Absent only before the instance is created. */
  token?: string;
}

export interface UazapiAdminConfig {
  /** e.g. https://SEUSERVIDOR.uazapi.com */
  baseUrl: string;
  /** Server-wide admin token, used only to create instances. */
  adminToken: string;
}

interface UazapiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function request<T = unknown>(
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = "POST",
): Promise<UazapiResult<T>> {
  try {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const raw = await resp.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }

    if (!resp.ok) {
      const d = data as { error?: string; message?: string } | null;
      const msg =
        d?.error || d?.message || (typeof data === "string" ? data : "") || `HTTP ${resp.status}`;
      return { ok: false, error: String(msg) };
    }

    return { ok: true, data: data as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error calling UAZAPI",
    };
  }
}

function pick(obj: unknown, ...paths: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === "string" && cur.length > 0) return cur;
  }
  return undefined;
}

// ------------------------------------------------------------
// Instance lifecycle (admintoken-scoped: only creation)
// ------------------------------------------------------------

export interface CreateInstanceResult {
  instanceToken: string;
  instanceName: string;
}

/**
 * Creates a new UAZAPI instance for a client account. Requires the
 * server-wide admin token — never the per-instance one, since no
 * instance exists yet.
 */
export async function createInstance(
  admin: UazapiAdminConfig,
  instanceName: string,
): Promise<UazapiResult<CreateInstanceResult>> {
  const res = await request<Record<string, unknown>>(
    `${trimBase(admin.baseUrl)}/instance/init`,
    { admintoken: admin.adminToken },
    { name: instanceName, instanceName },
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const instanceToken = pick(res.data, "token", "instance.token", "data.token");
  if (!instanceToken) {
    return { ok: false, error: "UAZAPI response had no instance token" };
  }

  return {
    ok: true,
    data: {
      instanceToken,
      instanceName: pick(res.data, "name", "instance.name", "instanceName") ?? instanceName,
    },
  };
}

export interface UazapiInstanceSummary {
  /** Human-recognizable name — the identifier used to pick an
   *  instance from the list and match it back server-side when
   *  assigning it to a client (see /api/admin/clients/[accountId]/instance). */
  name: string;
  status: InstanceStatusResult["status"];
  phoneNumber?: string;
  /** Per-instance token. Kept out of API responses sent to the
   *  browser (see the admin instances route) — resolved server-side
   *  by re-calling this function and matching on `name`. */
  token: string;
}

/**
 * Lists every instance that exists under this UAZAPI server/admin
 * token — lets the platform owner browse what's already provisioned
 * (in UAZAPI itself, not just in this app's DB) before assigning one
 * to a client. Endpoint path is a best guess (`/instance/all`,
 * mirroring the `instance/init|connect|status` naming already used
 * here) — UAZAPI's exact list endpoint/response shape varies by
 * install; adjust the URL and the `pick()` field names below if your
 * server differs, same as every other call in this file.
 */
export async function listInstances(
  admin: UazapiAdminConfig,
): Promise<UazapiResult<UazapiInstanceSummary[]>> {
  const res = await request<unknown>(
    `${trimBase(admin.baseUrl)}/instance/all`,
    { admintoken: admin.adminToken },
    undefined,
    "GET",
  );
  if (!res.ok) return { ok: false, error: res.error };

  const rawList: unknown[] = Array.isArray(res.data)
    ? res.data
    : Array.isArray((res.data as Record<string, unknown> | null)?.instances)
      ? ((res.data as Record<string, unknown>).instances as unknown[])
      : Array.isArray((res.data as Record<string, unknown> | null)?.data)
        ? ((res.data as Record<string, unknown>).data as unknown[])
        : [];

  const items: UazapiInstanceSummary[] = [];
  for (const raw of rawList) {
    const token = pick(raw, "token", "instance.token", "apikey");
    const name = pick(raw, "name", "instance.name", "instanceName");
    if (!token || !name) continue;
    const rawStatus = (pick(raw, "status", "instance.status", "connectionStatus") ?? "").toLowerCase();
    items.push({
      name,
      token,
      status: STATUS_MAP[rawStatus] ?? "disconnected",
      phoneNumber: pick(raw, "phone", "phoneNumber", "instance.phone", "owner"),
    });
  }

  return { ok: true, data: items };
}

export interface ConnectInstanceResult {
  qrCodeBase64?: string;
  pairingCode?: string;
  status: string;
}

/**
 * Starts (or refreshes) the QR-code connection flow for an
 * instance. The caller polls `getInstanceStatus` until `connected`.
 */
export async function connectInstance(
  cfg: UazapiInstanceConfig,
): Promise<UazapiResult<ConnectInstanceResult>> {
  if (!cfg.token) return { ok: false, error: "Instance has no token yet" };

  const res = await request<Record<string, unknown>>(
    `${trimBase(cfg.baseUrl)}/instance/connect`,
    { token: cfg.token },
    {},
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const qrRaw = pick(res.data, "qrcode", "qrCode", "instance.qrcode", "base64");
  const qrCodeBase64 = qrRaw ? qrRaw.replace(/^data:image\/[a-z]+;base64,/i, "") : undefined;

  return {
    ok: true,
    data: {
      qrCodeBase64,
      pairingCode: pick(res.data, "pairingCode", "pairing_code"),
      status: pick(res.data, "status", "instance.status", "connectionStatus") ?? "qrcode",
    },
  };
}

export interface InstanceStatusResult {
  status: "not_created" | "qrcode" | "connecting" | "connected" | "disconnected";
  phoneNumber?: string;
}

const STATUS_MAP: Record<string, InstanceStatusResult["status"]> = {
  connected: "connected",
  open: "connected",
  online: "connected",
  connecting: "connecting",
  qrcode: "qrcode",
  qr: "qrcode",
  disconnected: "disconnected",
  close: "disconnected",
  closed: "disconnected",
};

export async function getInstanceStatus(
  cfg: UazapiInstanceConfig,
): Promise<UazapiResult<InstanceStatusResult>> {
  if (!cfg.token) return { ok: true, data: { status: "not_created" } };

  const res = await request<Record<string, unknown>>(
    `${trimBase(cfg.baseUrl)}/instance/status`,
    { token: cfg.token },
    undefined,
    "GET",
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const rawStatus = (
    pick(res.data, "status", "instance.status", "connectionStatus") ?? "disconnected"
  ).toLowerCase();

  return {
    ok: true,
    data: {
      status: STATUS_MAP[rawStatus] ?? "disconnected",
      phoneNumber: pick(res.data, "phone", "phoneNumber", "instance.phone", "owner"),
    },
  };
}

export async function disconnectInstance(
  cfg: UazapiInstanceConfig,
): Promise<UazapiResult<null>> {
  if (!cfg.token) return { ok: true, data: null };
  const res = await request(
    `${trimBase(cfg.baseUrl)}/instance/disconnect`,
    { token: cfg.token },
    {},
  );
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

export async function deleteInstance(cfg: UazapiInstanceConfig): Promise<UazapiResult<null>> {
  if (!cfg.token) return { ok: true, data: null };
  const res = await request(
    `${trimBase(cfg.baseUrl)}/instance`,
    { token: cfg.token },
    undefined,
    "DELETE",
  );
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

// ------------------------------------------------------------
// Messaging
// ------------------------------------------------------------

/** Group/JID destinations pass through untouched; bare numbers get digit-stripped. */
function toDestination(numberOrJid: string): string {
  const s = numberOrJid.trim();
  return s.includes("@") ? s : s.replace(/\D+/g, "");
}

export interface SendResult {
  externalId?: string;
}

export async function sendText(
  cfg: UazapiInstanceConfig,
  to: string,
  text: string,
): Promise<UazapiResult<SendResult>> {
  if (!cfg.token) return { ok: false, error: "Instance is not connected" };
  const res = await request<Record<string, unknown>>(
    `${trimBase(cfg.baseUrl)}/send/text`,
    { token: cfg.token },
    { number: toDestination(to), text },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: { externalId: pick(res.data, "messageid", "messageId", "id", "message.id", "key.id") },
  };
}

export type UazapiMediaType = "image" | "audio" | "ptt" | "video" | "document";

export async function sendMedia(
  cfg: UazapiInstanceConfig,
  to: string,
  type: UazapiMediaType,
  fileBase64OrUrl: string,
  caption?: string,
  docName?: string,
): Promise<UazapiResult<SendResult>> {
  if (!cfg.token) return { ok: false, error: "Instance is not connected" };

  const file = /^data:/i.test(fileBase64OrUrl)
    ? fileBase64OrUrl.replace(/^data:[^,]*;base64,/i, "")
    : fileBase64OrUrl;

  const res = await request<Record<string, unknown>>(
    `${trimBase(cfg.baseUrl)}/send/media`,
    { token: cfg.token },
    {
      number: toDestination(to),
      type,
      file,
      ...(caption ? { text: caption } : {}),
      ...(docName ? { docName } : {}),
    },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: { externalId: pick(res.data, "messageid", "messageId", "id", "message.id", "key.id") },
  };
}

/**
 * Looks up a contact's current WhatsApp profile picture URL.
 * Endpoint/field names are a best guess (mirroring the
 * `/instance/*` naming convention used elsewhere in this file) —
 * adjust if your UAZAPI install differs, same as every other call
 * here. Used once per contact (when they have no avatar yet) right
 * after an inbound message — see the webhook handler.
 */
export async function getProfilePicture(
  cfg: UazapiInstanceConfig,
  phone: string,
): Promise<UazapiResult<{ url: string }>> {
  if (!cfg.token) return { ok: false, error: "Instance is not connected" };
  const res = await request<Record<string, unknown>>(
    `${trimBase(cfg.baseUrl)}/chat/GetProfileImage`,
    { token: cfg.token },
    { number: toDestination(phone) },
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  const url = pick(res.data, "url", "profilePictureURL", "imgUrl", "link", "image");
  if (!url) return { ok: false, error: "No profile picture available" };
  return { ok: true, data: { url } };
}

/**
 * Sends (or clears, with `emoji: ""`) a reaction on a specific
 * WhatsApp message — the actual delivery UAZAPI's `/message/react`
 * endpoint performs. Distinct from `messageReactions` in our own DB
 * (src/db/schema.ts), which only tracks who reacted with what for
 * our own UI; this is what makes it show up as a real reaction on
 * the customer's phone. `externalMessageId` is `messages.messageId`
 * (the UAZAPI/WhatsApp id), not our internal row id.
 */
export async function sendReaction(
  cfg: UazapiInstanceConfig,
  to: string,
  externalMessageId: string,
  emoji: string,
): Promise<UazapiResult<null>> {
  if (!cfg.token) return { ok: false, error: "Instance is not connected" };
  const res = await request(
    `${trimBase(cfg.baseUrl)}/message/react`,
    { token: cfg.token },
    { number: toDestination(to), text: emoji, id: externalMessageId },
  );
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

/**
 * Points the instance's webhook at this deployment's receiving
 * endpoint (`/api/whatsapp/uazapi/webhook`). Called right after a
 * successful connect so inbound messages start flowing immediately.
 */
export async function configureWebhook(
  cfg: UazapiInstanceConfig,
  webhookUrl: string,
): Promise<UazapiResult<null>> {
  if (!cfg.token) return { ok: false, error: "Instance has no token yet" };
  const res = await request(
    `${trimBase(cfg.baseUrl)}/webhook`,
    { token: cfg.token },
    { enabled: true, url: webhookUrl, events: ["messages"] },
  );
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

// ------------------------------------------------------------
// Inbound webhook parsing
// ------------------------------------------------------------

export interface NormalizedInboundMessage {
  /** Digits — real phone number (1:1 chat) or group id. */
  phone: string;
  /** Digits of the contact's WhatsApp LID, when phone isn't present. */
  lid: string | null;
  isGroup: boolean;
  /** True when this message was sent by the connected number itself. */
  fromMe: boolean;
  /** True when a fromMe message was sent from outside the platform (the phone itself). */
  external: boolean;
  contactName: string | null;
  type: "text" | "image" | "audio" | "video" | "document" | "location";
  text: string | null;
  mediaUrl: string | null;
  mediaBase64: string | null;
  mimeType: string | null;
  externalId: string | null;
}

function onlyDigits(s: unknown): string {
  return String(s ?? "").replace(/\D+/g, "");
}

/**
 * Normalizes a UAZAPI webhook payload into the CRM's inbound-message
 * shape. Returns null for events we deliberately don't persist:
 * connection/presence/ack/delivery/read status, or a message our own
 * `sendText`/`sendMedia` call already recorded (`wasSentByApi`).
 */
export function parseUazapiWebhook(body: unknown): NormalizedInboundMessage | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const m = (root.message ?? root.data ?? root) as Record<string, unknown>;

  const key = (m.key ?? {}) as Record<string, unknown>;
  const fromMe = m.fromMe === true || key.fromMe === true || m.from_me === true;
  if (fromMe && m.wasSentByApi === true) return null;

  const eventType = String(root.event ?? root.EventType ?? root.type ?? "").toLowerCase();
  if (eventType && /status|presence|connection|ack|delivery|read/i.test(eventType)) {
    return null;
  }

  const chatId = String(m.chatid ?? m.chatId ?? key.remoteJid ?? m.remoteJid ?? "");
  const isGroup =
    /@g\.us$/i.test(chatId) || m.isGroup === true || m.isgroup === true || /\d{10,}-\d+/.test(chatId);

  const asPhone = (x: unknown): string => {
    const s = String(x ?? "").trim();
    if (!s) return "";
    if (/@lid$/i.test(s)) return "";
    if (/@g\.us$/i.test(s)) return "";
    if (/@s\.whatsapp\.net$/i.test(s)) return onlyDigits(s);
    if (/@/.test(s)) return "";
    if (/^\+?\d{6,}$/.test(s)) return onlyDigits(s);
    return "";
  };
  const asLid = (x: unknown): string => {
    const s = String(x ?? "");
    return /@lid$/i.test(s) ? onlyDigits(s) : "";
  };

  let phone = "";
  let lid: string | null = null;

  if (isGroup) {
    phone = onlyDigits(chatId || m.groupJid || m.chat || "");
  } else {
    lid =
      asLid(m.chatlid) ||
      asLid(chatId) ||
      (!fromMe ? asLid(m.sender_lid) || asLid(m.sender) : "") ||
      null;
    phone =
      asPhone(chatId) ||
      (!fromMe
        ? asPhone(m.sender_pn) ||
          asPhone(m.senderPn) ||
          asPhone(m.participant_pn) ||
          asPhone(m.participantPn) ||
          asPhone(m.sender) ||
          asPhone(m.from)
        : "") ||
      asPhone(m.telefone) ||
      asPhone(m.phone) ||
      asPhone(root.telefone) ||
      asPhone(root.phone) ||
      "";
  }
  if (!phone && !lid) return null;

  const contactName = isGroup
    ? ((m.groupName ?? m.chatName ?? m.subject ?? m.wa_name ?? m.name ?? "Grupo") as string)
    : ((m.nome ??
        m.pushName ??
        m.pushname ??
        m.senderName ??
        m.name ??
        m.notifyName ??
        null) as string | null);

  const content = (m.content && typeof m.content === "object" ? m.content : {}) as Record<
    string,
    unknown
  >;
  const rawType = String(m.messageType ?? m.mediaType ?? m.type ?? "text").toLowerCase();
  const mediaUrl =
    (m.fileURL ??
      m.file_url ??
      content.fileURL ??
      content.fileUrl ??
      m.mediaUrl ??
      m.url ??
      content.URL ??
      content.url ??
      null) as string | null;
  const mediaBase64Raw =
    m.base64 ??
    m.fileBase64 ??
    m.file_base64 ??
    content.base64 ??
    content.fileBase64 ??
    content.data ??
    (typeof m.file === "string" && m.file.length > 200 ? m.file : null) ??
    null;
  const mimeType = (m.mimetype ?? m.mimeType ?? content.mimetype ?? content.mimeType ?? null) as
    | string
    | null;
  const caption = (m.caption ??
    content.caption ??
    (typeof m.text === "string" ? m.text : null) ??
    null) as string | null;

  let type: NormalizedInboundMessage["type"] = "text";
  let text: string | null = null;

  if (/image|imagem|sticker|figurinha/.test(rawType)) {
    type = "image";
    text = caption;
  } else if (/audio|ptt|voice/.test(rawType)) {
    type = "audio";
  } else if (/video/.test(rawType)) {
    type = "video";
    text = caption;
  } else if (/document|documento|file/.test(rawType)) {
    type = "document";
    text = (caption ?? m.filename ?? m.fileName ?? content.fileName ?? content.filename ?? null) as
      | string
      | null;
  } else if (/location|localiz/.test(rawType)) {
    type = "location";
    const lat = (m.latitude ?? (m.location as Record<string, unknown> | undefined)?.latitude ?? content.latitude) as
      | number
      | undefined;
    const lng = (m.longitude ?? (m.location as Record<string, unknown> | undefined)?.longitude ?? content.longitude) as
      | number
      | undefined;
    text = lat != null && lng != null ? `${lat}, ${lng}` : null;
  } else {
    type = "text";
    text = (
      (typeof m.text === "string" ? m.text : null) ??
      m.texto ??
      m.body ??
      m.message ??
      m.conversation ??
      (m.text as Record<string, unknown> | undefined)?.body ??
      (typeof content.text === "string" ? content.text : null) ??
      null
    ) as string | null;
  }

  const mediaBase64 = mediaBase64Raw ? String(mediaBase64Raw) : null;
  if (!text && !mediaUrl && !mediaBase64) return null;

  const externalId = (m.messageid ?? m.messageId ?? m.id ?? key.id ?? null) as string | null;

  return {
    phone,
    lid,
    isGroup,
    fromMe,
    external: fromMe,
    contactName,
    type,
    text,
    mediaUrl,
    mediaBase64,
    mimeType,
    externalId,
  };
}
