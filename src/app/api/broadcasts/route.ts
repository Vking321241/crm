// ============================================================
// GET  /api/broadcasts — list broadcasts for the caller's account.
//      Any account member may read (mirrors GET /api/tags).
// POST /api/broadcasts — create a broadcast in 'draft' status.
//      Agent+ (broadcasts are operational data, see
//      src/lib/auth/roles.ts canSendMessages doc).
//
// No `template_name`/`template_language` — Meta Cloud API templates
// were dropped from the product. A broadcast now carries plain
// `contentText` (+ optional `mediaUrl`) sent directly via UAZAPI, see
// POST /api/broadcasts/[id]/send.
// ============================================================

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { broadcasts } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_NAME_LEN = 120;
const MAX_MEDIA_URL_LEN = 2048;

export interface AudienceFilter {
  /** Empty/absent tagIds = "all contacts in the account". */
  tagIds?: string[];
}

function parseAudienceFilter(value: unknown): AudienceFilter {
  if (!value || typeof value !== "object") return {};
  const tagIdsRaw = (value as { tagIds?: unknown }).tagIds;
  const tagIds = Array.isArray(tagIdsRaw)
    ? tagIdsRaw.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  return tagIds.length > 0 ? { tagIds } : {};
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.accountId, ctx.accountId))
      .orderBy(desc(broadcasts.createdAt));

    return NextResponse.json({ broadcasts: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(`broadcast:create:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          name?: unknown;
          contentText?: unknown;
          mediaUrl?: unknown;
          audienceFilter?: unknown;
        }
      | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `'name' must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const contentText = typeof body?.contentText === "string" ? body.contentText.trim() : "";
    if (!contentText) {
      return NextResponse.json({ error: "'contentText' is required" }, { status: 400 });
    }

    let mediaUrl: string | null = null;
    if (typeof body?.mediaUrl === "string" && body.mediaUrl.trim()) {
      const trimmed = body.mediaUrl.trim();
      if (trimmed.length > MAX_MEDIA_URL_LEN) {
        return NextResponse.json({ error: "'mediaUrl' is too long" }, { status: 400 });
      }
      mediaUrl = trimmed;
    }

    const audienceFilter = parseAudienceFilter(body?.audienceFilter);

    const [created] = await ctx.db
      .insert(broadcasts)
      .values({
        accountId: ctx.accountId,
        userId: ctx.userId,
        name,
        contentText,
        mediaUrl,
        audienceFilter,
        status: "draft",
      })
      .returning();

    return NextResponse.json({ broadcast: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
