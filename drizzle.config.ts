import { defineConfig } from "drizzle-kit";

// Config for the main app database only. The storage database
// (src/db/storage-schema.ts) is a separate, smaller schema managed
// by its own config — see drizzle.storage.config.ts.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
