import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// SSRF guard for the `send_webhook` automation step (GHSA-8jqh-598v-rfxc)
// — the destination URL is account-controlled and the server makes the
// request, so a malicious/compromised automation could otherwise be
// pointed at cloud metadata endpoints (169.254.169.254), localhost
// services, or other hosts on the deployment's private network.
//
// Checks both the literal host (in case it's already an IP) and every
// address the hostname resolves to — a public domain can still resolve
// to a private address (DNS rebinding), so resolving and checking is
// mandatory, not just a string check on the URL itself.

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments / benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1") return true; // loopback
  if (s === "::") return true; // unspecified
  if (s.startsWith("fe80:") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local fc00::/7
  if (s.startsWith("::ffff:")) {
    // IPv4-mapped — check the embedded v4 address too.
    return isPrivateOrReservedIPv4(s.slice("::ffff:".length));
  }
  return false;
}

function isPrivateOrReservedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true; // couldn't parse — refuse rather than risk it
}

/**
 * Resolves `url`'s hostname and returns whether it's safe to let the
 * server make an outbound request to it: http(s) only, and no
 * resolved address may be private/loopback/link-local/reserved.
 */
export async function isDeliverableUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (hostname === "localhost") return false;

  if (isIP(hostname)) {
    return !isPrivateOrReservedIP(hostname);
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;

  return addresses.every((a) => !isPrivateOrReservedIP(a.address));
}
