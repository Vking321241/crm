// ============================================================
// DivaryTalk — storage database schema (separate Postgres service
// on purpose, per the user's requirement: file metadata is not
// stored in the main app database).
//
// This table only tracks WHERE a file lives (on the App service's
// disk volume) and what it is. The bytes themselves are never in
// Postgres — they live at `path` on a mounted volume (see the
// Dockerfile / EasyPanel volume config), served by an authenticated
// route (Fatia 3: no upload/serving UI exists yet, this is
// infrastructure-only for now — see the plan's scope note).
// ============================================================

import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const fileKindEnum = pgEnum("file_kind", ["avatar", "media"]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Not a FK — this database has no `accounts` table of its own
  // (deliberately separate service/connection from the main DB), so
  // this is just an opaque id matching the main DB's accounts.id,
  // validated at the application layer.
  accountId: uuid("account_id").notNull(),
  kind: fileKindEnum("kind").notNull(),
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
