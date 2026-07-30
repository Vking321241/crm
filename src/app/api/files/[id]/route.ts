import { NextResponse } from "next/server";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { storageDb } from "@/db/storage-client";
import { files } from "@/db/storage-schema";

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".local-storage");

// GET /api/files/[id] — serves a previously uploaded file. Requires a
// session belonging to the same account the file was uploaded under
// (or the platform account) — the auth gate Supabase's public bucket
// URLs never had, now that nothing outside our own app needs to
// fetch these bytes (media sent to UAZAPI goes as base64, not a URL).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const [row] = await storageDb.select().from(files).where(eq(files.id, id)).limit(1);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.accountId !== ctx.accountId && !ctx.account.isPlatform) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const bytes = await readFile(path.join(STORAGE_ROOT, row.path));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mimeType,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const [row] = await storageDb.select().from(files).where(eq(files.id, id)).limit(1);
    if (!row || row.accountId !== ctx.accountId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await unlink(path.join(STORAGE_ROOT, row.path)).catch(() => {});
    await storageDb.delete(files).where(eq(files.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
