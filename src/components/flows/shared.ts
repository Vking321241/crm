// Shared helpers for builders that let the user edit a stable id
// alongside a human label (interactive buttons/list rows today).

/**
 * Converts free text into a `snake_case` id safe to echo back from a
 * WhatsApp webhook (button/list-row ids). Falls back to `fallback`
 * when the input has no id-safe characters at all (e.g. emoji-only
 * labels), so callers never end up with an empty id.
 */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics after NFD split
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}
