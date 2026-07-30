import { describe, expect, it } from "vitest";
import { MEDIA_MAX_BYTES_BY_KIND } from "./upload-media";

// Path construction moved server-side (src/app/api/files/route.ts,
// uuid-based instead of timestamp-based) once uploads started going
// through our own storage route instead of a Supabase bucket — this
// file now only covers what's still client-side.

describe("MEDIA_MAX_BYTES_BY_KIND", () => {
  it("caps images at Meta's tighter 5 MB limit", () => {
    expect(MEDIA_MAX_BYTES_BY_KIND.image).toBe(5 * 1024 * 1024);
  });

  it("caps video/audio/document at the 16 MB bucket limit", () => {
    expect(MEDIA_MAX_BYTES_BY_KIND.video).toBe(16 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES_BY_KIND.audio).toBe(16 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES_BY_KIND.document).toBe(16 * 1024 * 1024);
  });
});
