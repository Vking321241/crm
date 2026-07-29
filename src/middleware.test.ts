import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// Fatia 2: middleware no longer talks to Supabase — it verifies the
// HMAC signature on the `divarytalk_session` cookie (see
// src/middleware.ts / src/lib/auth/session.ts) with no DB round
// trip, so these tests build a validly (or invalidly) signed cookie
// value directly instead of mocking a Supabase client.

const SESSION_SECRET = "test-session-secret";
const COOKIE_NAME = "divarytalk_session";

function signedCookie(sessionId: string, secret = SESSION_SECRET): string {
  const sig = createHmac("sha256", secret).update(sessionId).digest("hex");
  return `${sessionId}.${sig}`;
}

const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

function requestWithCookie(url: string, cookie?: string): NextRequest {
  const req = new NextRequest(url);
  if (cookie) req.cookies.set(COOKIE_NAME, cookie);
  return req;
}

describe("middleware", () => {
  it("redirects a signed-in user away from /login", () => {
    const res = middleware(
      requestWithCookie("https://app.test/login", signedCookie("session-1")),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects an unauthenticated visitor from a protected page to /login", () => {
    const res = middleware(requestWithCookie("https://app.test/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects a visitor with a tampered session cookie to /login", () => {
    const res = middleware(
      requestWithCookie("https://app.test/dashboard", "session-1.not-a-real-signature"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("passes through for a signed-in user on a protected page", () => {
    const res = middleware(
      requestWithCookie("https://app.test/dashboard", signedCookie("session-1")),
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes through /admin for a signed-in user (role check happens in the layout, not here)", () => {
    const res = middleware(
      requestWithCookie("https://app.test/admin", signedCookie("session-1")),
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects unauthenticated non-webhook WhatsApp API calls", () => {
    const res = middleware(
      requestWithCookie("https://app.test/api/whatsapp/instance/connect"),
    );
    expect(res.status).toBe(401);
  });

  it("lets the UAZAPI webhook through without a session", () => {
    const res = middleware(
      requestWithCookie("https://app.test/api/whatsapp/uazapi/webhook/instance-1"),
    );
    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
