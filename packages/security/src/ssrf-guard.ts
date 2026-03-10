/**
 * SSRF protection: blocks requests to private IP ranges, cloud metadata endpoints,
 * and link-local addresses.
 */

// Private/reserved IP ranges (CIDR)
const BLOCKED_RANGES = [
  // Private ranges (RFC 1918)
  { prefix: '10.', check: null },
  { prefix: '172.', check: (ip: string) => isInRange172(ip) },
  { prefix: '192.168.', check: null },
  // Loopback
  { prefix: '127.', check: null },
  // Link-local
  { prefix: '169.254.', check: null },
  // CGNAT
  { prefix: '100.', check: (ip: string) => isInRange100(ip) },
];

// Cloud metadata endpoints to block
const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.google.com', 'metadata']);

// AWS/GCP/Azure metadata IP
const METADATA_IP = '169.254.169.254';

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates that a URL is safe to request (not targeting internal infrastructure).
 */
export function validateUrl(urlStr: string, allowlist?: string[]): SsrfCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block metadata endpoints
  if (BLOCKED_HOSTS.has(hostname) || hostname === METADATA_IP) {
    return { allowed: false, reason: `Blocked: cloud metadata endpoint (${hostname})` };
  }

  // Check if hostname is an IP address
  if (isIPv4(hostname)) {
    if (isPrivateIP(hostname)) {
      return { allowed: false, reason: `Blocked: private IP range (${hostname})` };
    }
  }

  // Block IPv6 loopback and link-local
  if (hostname === '[::1]' || hostname === '::1') {
    return { allowed: false, reason: 'Blocked: IPv6 loopback' };
  }

  // Block non-http(s) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `Blocked: unsupported protocol (${parsed.protocol})` };
  }

  // If allowlist is provided, hostname must match
  if (allowlist && allowlist.length > 0) {
    const matchesAllowlist = allowlist.some((pattern) => matchHost(pattern, hostname));
    if (!matchesAllowlist) {
      return { allowed: false, reason: `Blocked: hostname not in allowlist (${hostname})` };
    }
  }

  return { allowed: true };
}

/**
 * Validates that a raw IP address is not private/reserved.
 */
export function isPrivateIP(ip: string): boolean {
  if (!isIPv4(ip)) return false;

  for (const range of BLOCKED_RANGES) {
    if (ip.startsWith(range.prefix)) {
      if (range.check) {
        if (range.check(ip)) return true;
      } else {
        return true;
      }
    }
  }

  if (ip === '0.0.0.0') return true;

  return false;
}

function isIPv4(str: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(str);
}

/** Check 172.16.0.0/12 range (172.16.x.x - 172.31.x.x) */
function isInRange172(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  return parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31;
}

/** Check 100.64.0.0/10 range (100.64.x.x - 100.127.x.x) */
function isInRange100(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

/**
 * Match a host against a pattern.
 * Supports wildcard prefix: '*.github.com' matches 'api.github.com'.
 */
function matchHost(pattern: string, hostname: string): boolean {
  if (pattern === hostname) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // '.github.com'
    return hostname.endsWith(suffix) || hostname === pattern.slice(2);
  }
  return false;
}
