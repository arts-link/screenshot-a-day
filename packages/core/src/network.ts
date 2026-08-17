import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export type NetworkLookup = typeof dnsLookup;

export interface ResolvedTarget {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

export class TargetPolicyError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "TargetPolicyError";
  }
}

const BLOCKED_RANGES = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "reserved",
  "carrierGradeNat",
  "uniqueLocal",
]);

function normalizeAddress(address: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    return ipv6.isIPv4MappedAddress() ? ipv6.toIPv4Address() : ipv6;
  }
  return parsed;
}

export function isPrivateAddress(address: string): boolean {
  return BLOCKED_RANGES.has(normalizeAddress(address).range());
}

function isAllowed(address: string, hostname: string, allowlist: string[]): boolean {
  const normalizedHost = hostname.toLowerCase();
  const parsedAddress = normalizeAddress(address);
  return allowlist.some((entry) => {
    const value = entry.trim().toLowerCase();
    if (!value) return false;
    if (value === normalizedHost) return true;
    if (value.startsWith("*.")) return normalizedHost.endsWith(value.slice(1));
    if (value.includes("/")) {
      try {
        const [range, bits] = ipaddr.parseCIDR(value);
        return parsedAddress.kind() === range.kind() && parsedAddress.match(range, bits);
      } catch {
        return false;
      }
    }
    return value === address.toLowerCase();
  });
}

export async function resolveSafeUrl(
  input: string,
  allowlist: string[] = [],
  lookup: NetworkLookup = dnsLookup,
): Promise<ResolvedTarget> {
  const url = new URL(input);
  if (!new Set(["http:", "https:"]).has(url.protocol))
    throw new TargetPolicyError("Only HTTP(S) URLs are supported");
  if (url.username || url.password)
    throw new TargetPolicyError("Credentials in target URLs are not allowed");

  const addresses = ipaddr.isValid(url.hostname)
    ? [{ address: url.hostname, family: ipaddr.parse(url.hostname).kind() === "ipv4" ? 4 : 6 }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new TargetPolicyError("Target hostname did not resolve");

  for (const { address } of addresses) {
    if (isPrivateAddress(address) && !isAllowed(address, url.hostname, allowlist)) {
      throw new TargetPolicyError(`Target resolves to blocked address ${address}`);
    }
  }
  return {
    url,
    addresses: addresses.map(({ address }) => {
      const normalized = normalizeAddress(address);
      return {
        address: normalized.toString(),
        family: normalized.kind() === "ipv4" ? 4 : 6,
      };
    }),
  };
}

export async function assertSafeUrl(
  input: string,
  allowlist: string[] = [],
  lookup: NetworkLookup = dnsLookup,
): Promise<URL> {
  return (await resolveSafeUrl(input, allowlist, lookup)).url;
}
