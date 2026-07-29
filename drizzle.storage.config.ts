import { defineConfig } from "drizzle-kit";

// Separate config for the storage database — see src/db/storage-schema.ts.
export default defineConfig({
  schema: "./src/db/storage-schema.ts",
  out: "./drizzle-storage",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.STORAGE_DATABASE_URL!,
  },
});
