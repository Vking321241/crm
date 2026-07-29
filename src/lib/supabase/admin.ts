import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy, shared service-role client. Bypasses RLS — only for
// server-only code that has already done its own authorization
// (e.g. requirePlatformOwner()) and needs to act outside the
// caller's own row visibility, such as creating another user's
// auth.users row via the Admin API. Mirrors the equivalent
// per-module admin-client.ts files (src/lib/flows,
// src/lib/automations, src/lib/ai) — same shape, shared instance.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
