-- ============================================================
-- 037_platform_accounts_and_whatsapp_instances.sql
--
-- Foundation for DivaryTalk's closed-provisioning multi-tenant
-- model, on top of the account-sharing base from 017.
--
-- What this migration does
--   1. Marks exactly one `accounts` row as the "platform account"
--      (`is_platform`). Its members are the platform owner(s) —
--      the person who runs the DivaryTalk deployment and creates
--      every client. This is deliberately NOT a 5th value on
--      `account_role_enum`: that enum is a flat 4-level hierarchy
--      consumed by `roleRank()`/`hasMinRole()` (src/lib/auth/roles.ts)
--      for *within-account* permission checks, and a platform owner
--      has no meaningful rank inside a client's account — they sit
--      outside that hierarchy entirely.
--   2. `is_platform_member()` — SECURITY DEFINER helper, same shape
--      as `is_account_member()`, granting the platform account's
--      members read access to every `accounts` row (additive OR
--      policy — client accounts keep seeing only themselves).
--   3. `accounts.max_agent_seats` — per-client seat quota, settable
--      only by the platform owner. Enforced in the invitations API
--      route (see src/app/api/account/invitations/route.ts), not in
--      SQL, since it needs to count both active members AND
--      outstanding invitations.
--   4. `platform_bootstrap_client_account()` — the RPC the "create
--      client" API route calls right after creating the client
--      admin's auth.users row. Re-homes the fresh personal
--      account/profile that `handle_new_user` (017) auto-created
--      into a brand-new client account, owned by that same user.
--      Mirrors `redeem_invitation` (019)'s "move profile, delete
--      orphan account" ordering, adapted for server-orchestrated
--      creation instead of a token redemption.
--   5. `whatsapp_instances` — one UAZAPI instance per client
--      account (this slice: 1:1). Replaces `whatsapp_config` for
--      the new engine; `whatsapp_config` and the Meta-Cloud-API
--      code path are left untouched and unused, not migrated, since
--      the field sets don't correspond 1:1 between providers.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ACCOUNTS: platform flag + seat quota
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_platform BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_agent_seats INTEGER NOT NULL DEFAULT 1;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_max_agent_seats_positive CHECK (max_agent_seats >= 1);

-- At most one platform account can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_platform
  ON accounts (is_platform)
  WHERE is_platform;

-- ============================================================
-- is_platform_member() — mirrors is_account_member()'s shape.
-- No arguments: always evaluated against the calling auth.uid(),
-- since "is this caller a platform operator" never varies by
-- target row the way account membership does.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_platform_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND a.is_platform = true
  );
$$;

ALTER FUNCTION public.is_platform_member() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_platform_member() TO authenticated, service_role;

-- ============================================================
-- RLS — accounts: additive SELECT-only visibility for platform
-- members. Postgres combines multiple permissive policies on the
-- same command with OR, so this only ever ADDS visibility — the
-- existing `accounts_select` (is_account_member(id)) from 017
-- keeps client members scoped to their own account. Deliberately
-- no platform UPDATE/INSERT/DELETE policy: those go through the
-- SECURITY DEFINER RPC below, which is auditable and can't be
-- broadened by a future careless policy edit.
-- ============================================================
DROP POLICY IF EXISTS accounts_select_platform ON accounts;
CREATE POLICY accounts_select_platform ON accounts FOR SELECT
  USING (is_platform_member());

-- ============================================================
-- platform_bootstrap_client_account()
--
-- Called by the "create client" API route immediately after
-- creating the client admin's auth.users row via the Supabase
-- Admin API (which fires 017's `handle_new_user` trigger, giving
-- that user a throwaway personal account + owner profile — same
-- as any fresh signup). This RPC re-homes them into a real client
-- account instead.
--
-- SECURITY DEFINER so it can write across the RLS boundary, but
-- gated by is_platform_member() on the CALLER (auth.uid()) —
-- must be invoked with the platform owner's own authenticated
-- session (not the service role), so the permission check means
-- something.
--
-- Order matters, same reasoning as redeem_invitation (019): delete
-- the old (guaranteed-empty, seconds-old) personal account BEFORE
-- inserting the new one, because `idx_accounts_one_per_owner`
-- forbids the same owner_user_id on two rows at once.
-- ============================================================
CREATE OR REPLACE FUNCTION public.platform_bootstrap_client_account(
  p_new_user_id UUID,
  p_client_name TEXT,
  p_max_agent_seats INTEGER DEFAULT 1
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_account_id UUID;
  v_new_account_id UUID;
BEGIN
  IF NOT is_platform_member() THEN
    RAISE EXCEPTION 'Only a platform owner can create client accounts'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_old_account_id
  FROM profiles
  WHERE user_id = p_new_user_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no profile yet' USING ERRCODE = '22023';
  END IF;

  -- Guard: only ever delete the throwaway personal account this
  -- same user owns — never a shared account they might already
  -- belong to (defensive; shouldn't happen for a just-created user).
  DELETE FROM accounts
  WHERE id = v_old_account_id
    AND owner_user_id = p_new_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not the sole owner of a fresh personal account'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO accounts (name, owner_user_id, is_platform, max_agent_seats)
  VALUES (p_client_name, p_new_user_id, false, GREATEST(p_max_agent_seats, 1))
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_new_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.platform_bootstrap_client_account(UUID, TEXT, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_bootstrap_client_account(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_bootstrap_client_account(UUID, TEXT, INTEGER) TO authenticated;

-- ============================================================
-- WHATSAPP_INSTANCES — the UAZAPI engine, one instance per
-- client account (this slice: 1:1, hence the UNIQUE(account_id)).
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  uazapi_url TEXT,
  uazapi_token TEXT, -- encrypted at rest (src/lib/whatsapp/encryption.ts), never read back client-side
  status TEXT NOT NULL DEFAULT 'not_created'
    CHECK (status IN ('not_created', 'qrcode', 'connecting', 'connected', 'disconnected')),
  qr_code_base64 TEXT, -- ephemeral, only populated mid-connect
  phone_number TEXT,
  connected_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_account ON whatsapp_instances(account_id);

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_instances;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Client members: read their own instance; admin+ can trigger
-- connect/disconnect (UPDATE). No client INSERT/DELETE — creation
-- happens server-side (service role) as part of client provisioning,
-- deletion is a platform-only operation for now.
DROP POLICY IF EXISTS whatsapp_instances_select ON whatsapp_instances;
DROP POLICY IF EXISTS whatsapp_instances_update ON whatsapp_instances;
DROP POLICY IF EXISTS whatsapp_instances_select_platform ON whatsapp_instances;
DROP POLICY IF EXISTS whatsapp_instances_all_platform ON whatsapp_instances;

CREATE POLICY whatsapp_instances_select ON whatsapp_instances FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY whatsapp_instances_update ON whatsapp_instances FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Platform members: full visibility + control across every client's
-- instance (the "I pick which client to connect" flow in /admin).
CREATE POLICY whatsapp_instances_select_platform ON whatsapp_instances FOR SELECT
  USING (is_platform_member());
CREATE POLICY whatsapp_instances_all_platform ON whatsapp_instances FOR ALL
  USING (is_platform_member())
  WITH CHECK (is_platform_member());

-- ============================================================
-- BOOTSTRAP: promote the operator's existing account to the
-- platform account. Matches by profile email — safe to re-run
-- (idempotent UPDATE), no-ops with a NOTICE if the profile doesn't
-- exist yet (e.g. brand-new database, no one has signed in yet).
-- ============================================================
DO $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE email = 'novaroyale3d@gmail.com'
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    UPDATE accounts SET is_platform = true WHERE id = v_account_id;
  ELSE
    RAISE NOTICE 'platform bootstrap: no profile found for novaroyale3d@gmail.com yet — set accounts.is_platform manually after first login.';
  END IF;
END $$;
