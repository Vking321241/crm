/**
 * Shared media-upload helper — talks to `/api/files` (server-side,
 * account-scoped, see src/app/api/files/route.ts) instead of a
 * Supabase Storage bucket. The account-scoping that used to be
 * enforced by bucket RLS is now enforced server-side by the route
 * reading the caller's session.
 */

/** 16 MB — matches the server-side limit in src/app/api/files/route.ts. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Per-kind upload ceilings, checked client-side before upload so an
 * oversized file doesn't round-trip to the server first.
 */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

export interface UploadAccountMediaResult {
  /** URL the app can render/fetch the file from (`/api/files/<id>`). */
  publicUrl: string;
  /** Opaque file id — pass to `deleteAccountMedia` to remove it. */
  path: string;
}

/**
 * Upload a file and return the URL to render/fetch it from. Throws
 * with a user-facing message on failure — callers surface it via a
 * toast.
 *
 * `kind` replaces the old Supabase "bucket" concept — the server
 * only distinguishes 'avatar' from everything else (treated as
 * 'media'), kept as a loose `string` param so out-of-scope callers
 * (flows — not ported this fatia) keep compiling against their old
 * bucket-name constants unchanged.
 */
export async function uploadAccountMedia(
  kind: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind === "avatar" ? "avatar" : "media");

  const res = await fetch("/api/files", { method: "POST", body: form });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Upload failed");
  }
  const data = (await res.json()) as { id: string; url: string };
  return { publicUrl: data.url, path: data.id };
}

/**
 * Delete a previously-uploaded file. Best-effort: callers
 * fire-and-forget and swallow errors (a missed delete is a storage
 * nit, not something to surface to the user).
 *
 * Accepts an optional legacy first arg (old Supabase "bucket" name)
 * for callers not yet rewritten this fatia — only the file id
 * (last argument) is actually used.
 */
export async function deleteAccountMedia(fileId: string, legacyBucketArg?: string): Promise<void> {
  const id = legacyBucketArg !== undefined ? legacyBucketArg : fileId;
  const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}
