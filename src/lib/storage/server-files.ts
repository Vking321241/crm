// ============================================================
// Server-only helpers around the `files` storage table/disk volume
// (see src/db/storage-schema.ts, src/app/api/files/route.ts) — used
// by code that isn't a browser-facing upload/download request:
//
//   - readAccountFileAsBase64: outbound WhatsApp sends. UAZAPI can't
//     fetch our `/api/files/<id>` URLs itself (they require our own
//     session cookie), so before calling sendMedia() we read the
//     bytes straight off disk and hand UAZAPI base64 instead — see
//     src/app/api/conversations/[id]/messages/route.ts.
//   - saveInboundMedia: inbound WhatsApp webhook. UAZAPI's own
//     media URL/base64 for a received file isn't guaranteed to stay
//     fetchable (auth, expiry) — we pull it once and re-host it
//     through our own authenticated /api/files/<id>, exactly like
//     everything else in the app, so the inbox can always render it.
// ============================================================

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { storageDb } from "@/db/storage-client";
import { files } from "@/db/storage-schema";

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".local-storage");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function guessExt(mimeType: string, fallbackName?: string | null): string {
  if (EXT_BY_MIME[mimeType]) return EXT_BY_MIME[mimeType];
  const fromName = fallbackName?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return fromName || "bin";
}

function extractFileId(urlOrId: string): string | null {
  const m = /\/api\/files\/([0-9a-fA-F-]{36})/.exec(urlOrId);
  if (m) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test(urlOrId)) return urlOrId;
  return null;
}

/**
 * Reads a previously-uploaded file (by its `/api/files/<id>` URL or
 * bare id) straight off disk and returns it as base64 — for handing
 * to a third party (UAZAPI) that can't authenticate against our own
 * download route. Returns null if the id can't be resolved or
 * doesn't belong to `accountId`.
 */
export async function readAccountFileAsBase64(
  urlOrId: string,
  accountId: string,
): Promise<{ base64: string; mimeType: string; filename: string } | null> {
  const id = extractFileId(urlOrId);
  if (!id) return null;

  const [row] = await storageDb.select().from(files).where(eq(files.id, id)).limit(1);
  if (!row || row.accountId !== accountId) return null;

  try {
    const bytes = await readFile(path.join(STORAGE_ROOT, row.path));
    return {
      base64: bytes.toString("base64"),
      mimeType: row.mimeType,
      filename: path.basename(row.path),
    };
  } catch (err) {
    console.error("[readAccountFileAsBase64] read failed:", err);
    return null;
  }
}

/**
 * Persists raw bytes as a new account-scoped file and returns its
 * `/api/files/<id>` URL — the write-side counterpart used for
 * re-hosting inbound WhatsApp media (see module doc above).
 */
export async function writeAccountFile(
  accountId: string,
  bytes: Buffer,
  mimeType: string,
  fallbackName?: string | null,
): Promise<string> {
  const id = randomUUID();
  const ext = guessExt(mimeType, fallbackName);
  const relativePath = path.posix.join(accountId, `${id}.${ext}`);
  const absoluteDir = path.join(STORAGE_ROOT, accountId);
  const absolutePath = path.join(STORAGE_ROOT, accountId, `${id}.${ext}`);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, bytes);

  await storageDb.insert(files).values({
    id,
    accountId,
    kind: "media",
    path: relativePath,
    mimeType,
    sizeBytes: bytes.length,
  });

  return `/api/files/${id}`;
}

/**
 * Best-effort re-host of an inbound WhatsApp attachment. Tries, in
 * order: base64 payload UAZAPI already included in the webhook,
 * then fetching `sourceUrl` (with the instance token, in case
 * UAZAPI gates its own media URLs the same way it gates every other
 * endpoint). Falls back to returning `sourceUrl` unchanged if both
 * fail, so the message is never lost — worst case the bubble shows
 * a broken/unopenable media link exactly like today, not a missing
 * message.
 */
export async function saveInboundMedia(opts: {
  accountId: string;
  sourceUrl: string | null;
  sourceBase64: string | null;
  mimeType: string | null;
  instanceToken?: string;
  instanceBaseUrl?: string;
}): Promise<string | null> {
  const { accountId, sourceUrl, sourceBase64, mimeType } = opts;
  const contentType = mimeType || "application/octet-stream";

  if (sourceBase64) {
    try {
      const bytes = Buffer.from(sourceBase64, "base64");
      if (bytes.length > 0) {
        return await writeAccountFile(accountId, bytes, contentType);
      }
    } catch (err) {
      console.error("[saveInboundMedia] base64 decode failed:", err);
    }
  }

  if (sourceUrl) {
    try {
      const res = await fetch(sourceUrl, {
        headers: opts.instanceToken ? { token: opts.instanceToken } : undefined,
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const bytes = Buffer.from(arrayBuffer);
        if (bytes.length > 0) {
          const fetchedType = res.headers.get("content-type") || contentType;
          return await writeAccountFile(accountId, bytes, fetchedType, sourceUrl);
        }
      }
    } catch (err) {
      console.error("[saveInboundMedia] fetch failed:", err);
    }
  }

  // Last resort — keep whatever UAZAPI gave us so the message isn't
  // silently dropped, even if it may not render.
  return sourceUrl;
}
