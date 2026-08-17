"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";
import { isPermissionModule, type PermissionModule } from "@/lib/auth/permissions";

// Fatia 2: this hook's PUBLIC SHAPE is unchanged from the Supabase
// version on purpose (same field names on Profile/AccountSummary/
// AuthContextValue) — every consumer (sidebar.tsx, settings pages,
// role gates) keeps working untouched. Only the data source changed:
// a single GET /api/auth/me instead of a Supabase session + two
// table reads. `beta_features` / legacy `role` aren't modeled in
// the new schema yet and are stubbed to safe defaults so existing
// call sites don't have to special-case a missing field. The account
// default currency now comes from Postgres (`accounts.default_currency`).

interface User {
  id: string;
  email: string;
  /** ISO timestamp. Only consumer today is the account-settings
   *  "member since" line — kept snake_case to match the Profile
   *  fields below, which mirror the old Supabase-row naming. */
  created_at: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  default_currency: string;
  /** True only for the single platform-operator account. Drives the
   *  "Painel da plataforma" link in the sidebar. */
  is_platform: boolean;
  /** Domain used to auto-build an atendente's login e-mail (e.g.
   *  "cliente1.com"). Null until an admin sets it in Membros. */
  email_domain: string | null;
}

interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    accountId: string;
    accountRole: string;
    createdAt: string;
  } | null;
  account: {
    id: string;
    name: string;
    isPlatform: boolean;
    maxAgentSeats: number;
    defaultCurrency: string;
    emailDomain: string | null;
  } | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  accountId: string | null;
  accountRole: AccountRole | null;
  account: AccountSummary | null;
  defaultCurrency: string;
  isOwner: boolean;
  isManager: boolean;
  isAgent: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
  /** Modules this user can access — for owner/manager this is every
   *  known module; for agent it's their explicit grants. */
  permissions: Set<PermissionModule>;
  hasPermission: (module: PermissionModule) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [permissions, setPermissions] = useState<Set<PermissionModule>>(new Set());
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as MeResponse & { permissions?: unknown };

      if (!data.user) {
        setUser(null);
        setProfile(null);
        setAccount(null);
        setPermissions(new Set());
        return;
      }

      setPermissions(
        new Set(
          Array.isArray(data.permissions)
            ? data.permissions.filter(isPermissionModule)
            : [],
        ),
      );

      setUser({ id: data.user.id, email: data.user.email, created_at: data.user.createdAt });

      const accountRole = isAccountRole(data.user.accountRole) ? data.user.accountRole : null;
      setProfile({
        id: data.user.id,
        full_name: data.user.fullName,
        email: data.user.email,
        avatar_url: data.user.avatarUrl,
        role: null,
        beta_features: [],
        account_id: data.user.accountId,
        account_role: accountRole,
      });

      setAccount(
        data.account
          ? {
              id: data.account.id,
              name: data.account.name,
              default_currency: data.account.defaultCurrency ?? DEFAULT_CURRENCY,
              is_platform: data.account.isPlatform,
              email_domain: data.account.emailDomain ?? null,
            }
          : null,
      );
    } catch (err) {
      console.error("[AuthProvider] fetchMe failed:", err);
      setUser(null);
      setProfile(null);
      setAccount(null);
      setPermissions(new Set());
    } finally {
      setProfileLoading(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setProfile(null);
    setAccount(null);
    setPermissions(new Set());
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isManager: role === "manager",
      isAgent: role === "agent",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  const hasPermission = useCallback(
    (module: PermissionModule) => permissions.has(module),
    [permissions],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        permissions,
        hasPermission,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isManager: false,
      isAgent: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
      permissions: new Set<PermissionModule>(),
      hasPermission: () => false,
    };
  }
  return ctx;
}
