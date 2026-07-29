import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./session";

// Fatia 2: getCurrentAccount() resolves the caller's account context
// from the session cookie (Postgres/Drizzle), not a Supabase session
// + embedded join. These tests mock ./session's getSessionUser
// instead of a Supabase client.

const getSessionUser = vi.fn<() => Promise<SessionUser | null>>();
vi.mock("./session", () => ({
  getSessionUser: () => getSessionUser(),
}));

const { getCurrentAccount, requireRole, requirePlatformOwner, UnauthorizedError, ForbiddenError } =
  await import("./account");

function makeSessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "user-1",
    email: "owner@acme.test",
    fullName: "Acme Owner",
    avatarUrl: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    accountId: "acct-1",
    accountRole: "owner",
    account: { id: "acct-1", name: "Acme", isPlatform: false, maxAgentSeats: 3 },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context from the session", async () => {
    getSessionUser.mockResolvedValue(makeSessionUser());

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme", isPlatform: false },
    });
  });

  it("throws UnauthorizedError when there is no session", async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("requireRole", () => {
  it("resolves when the caller meets the minimum role", async () => {
    getSessionUser.mockResolvedValue(makeSessionUser({ accountRole: "admin" }));
    await expect(requireRole("agent")).resolves.toMatchObject({ role: "admin" });
  });

  it("throws ForbiddenError when the caller is below the minimum role", async () => {
    getSessionUser.mockResolvedValue(makeSessionUser({ accountRole: "viewer" }));
    const err = await requireRole("admin").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
  });
});

describe("requirePlatformOwner", () => {
  it("resolves for a member of the platform account", async () => {
    getSessionUser.mockResolvedValue(
      makeSessionUser({
        account: { id: "platform-1", name: "DivaryTalk", isPlatform: true, maxAgentSeats: 1 },
        accountId: "platform-1",
      }),
    );
    await expect(requirePlatformOwner()).resolves.toMatchObject({
      account: { isPlatform: true },
    });
  });

  it("throws ForbiddenError for a client account member", async () => {
    getSessionUser.mockResolvedValue(makeSessionUser());
    const err = await requirePlatformOwner().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
  });
});
