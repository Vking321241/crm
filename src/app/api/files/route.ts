import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { storageDb } from "@/db/storage-client";
import { files } from "@/db/storage-schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

// Root of the persistent volume mounted on the App service (see
// Dockerfile) — bytes live here, only metadata + path go in the
// storage database. Overridable for local dev (defaults to a repo-
// relative folder so `npm run dev` doesn't need the volume set up).
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".local-storage");

// Not exported — App Router route files may only export recognized
// names (HTTP methods, `config`, `dynamic`, …); anything else fails
// Next's route-shape validation at build time.
const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

// POST /api/files — multipart upload (field "file", optional "kind":
// 'avatar' | 'media'). Replaces Supabase Storage's public buckets
// (avatars, chat-media): bytes go to a disk volume on the App
// service, gated by the caller's own account instead of bucket RLS.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`files:upload:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind") === "avatar" ? "avatar" : "media";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
    }
    if (file.size > MEDIA_MAX_BYTES) {
      return NextResponse.json({ error: "Arquivo excede o limite de 16 MB" }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const relativePath = path.posix.join(ctx.accountId, `${id}.${ext}`);
    const absoluteDir = path.join(STORAGE_ROOT, ctx.accountId);
    const absolutePath = path.join(STORAGE_ROOT, ctx.accountId, `${id}.${ext}`);

    await mkdir(absoluteDir, { recursive: true });
    await writeFile(absolutePath, bytes);

    await storageDb.insert(files).values({
      id,
      accountId: ctx.accountId,
      kind,
      path: relativePath,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      createdBy: ctx.userId,
    });

    return NextResponse.json({ id, url: `/api/files/${id}` }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
