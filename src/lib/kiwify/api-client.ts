// ============================================================
// Kiwify Public API client — used for the one thing DivaryTalk needs
// to do FROM the app TO Kiwify (everything else is Kiwify calling us,
// via the webhook in src/app/api/kiwify/webhook): canceling a
// subscription when the account owner clicks "Cancelar assinatura"
// in Settings → Assinatura.
//
// ⚠️ Same caveat as the webhook route: the token endpoint path, the
// cancel endpoint path/method, and the account-id header name below
// are a best-effort reading of Kiwify's public API docs, NOT verified
// against a live call from this account. `cancelKiwifySubscription`
// logs the raw response on any non-2xx so the paths here can be
// corrected in one place without guessing twice — check the server
// logs after the first real cancel attempt.
//
// Credentials: KIWIFY_CLIENT_ID / KIWIFY_CLIENT_SECRET (OAuth client
// credentials, from Kiwify's API key screen) and KIWIFY_ACCOUNT_ID
// (the store/account id Kiwify expects in requests). All three are
// backend-only env vars — never commit them, never send them to the
// client.
// ============================================================

const KIWIFY_API_BASE = "https://public-api.kiwify.com/v1";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

class KiwifyConfigError extends Error {}
export class KiwifyApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new KiwifyConfigError(`${name} is not configured`);
  return value;
}

/** Fetches (and caches, until near expiry) an OAuth access token via
 *  the client-credentials flow. */
async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = requireEnv("KIWIFY_CLIENT_ID");
  const clientSecret = requireEnv("KIWIFY_CLIENT_SECRET");

  const res = await fetch(`${KIWIFY_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    console.error("[kiwify api] token request failed:", res.status, rawBody.slice(0, 1000));
    throw new KiwifyApiError("Failed to authenticate with Kiwify", res.status, rawBody);
  }

  const data = JSON.parse(rawBody) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new KiwifyApiError("Kiwify token response missing access_token", res.status, rawBody);
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.accessToken;
}

/** Cancels a subscription by Kiwify's own subscription id (see
 *  `accounts.kiwifySubscriptionId`, captured from the webhook). Throws
 *  KiwifyApiError on any non-2xx — callers should catch and surface a
 *  friendly error rather than let it 500. */
export async function cancelKiwifySubscription(subscriptionId: string): Promise<void> {
  const accountId = requireEnv("KIWIFY_ACCOUNT_ID");
  const token = await getAccessToken();

  const res = await fetch(`${KIWIFY_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-kiwify-account-id": accountId,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const rawBody = await res.text();
    console.error(
      `[kiwify api] cancel subscription ${subscriptionId} failed:`,
      res.status,
      rawBody.slice(0, 1000),
    );
    throw new KiwifyApiError("Failed to cancel subscription with Kiwify", res.status, rawBody);
  }
}
