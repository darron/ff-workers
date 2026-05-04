/**
 * Shared public URL validation for source ingestion and admin story CRUD.
 */

const DEFAULT_PUBLIC_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_PUBLIC_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_PUBLIC_FETCH_MAX_REDIRECTS = 3;
const DNS_LOOKUP_TIMEOUT_MS = 3000;

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ref',
  'ref_src',
  's',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'utm_id'
]);

export function validateAndNormalizePublicHttpUrl(rawUrl) {
  if (!rawUrl) {
    return { ok: true, url: '' };
  }

  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { ok: false, error: 'URL must use http or https' };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, error: 'URL must not include credentials' };
    }

    if (hasDisallowedPort(parsed)) {
      return { ok: false, error: 'URL must not use a non-standard port' };
    }

    const hostname = normalizeHostnameForChecks(parsed.hostname);
    if (!hostname) {
      return { ok: false, error: 'URL host is required' };
    }

    if (isBlockedHostname(hostname)) {
      return { ok: false, error: 'Private/local hostnames are not allowed' };
    }

    parsed.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
    parsed.hash = '';
    normalizePath(parsed);
    stripTrackingParams(parsed);
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
}

export async function safeFetchPublicText(rawUrl, options = {}) {
  const timeoutMs = clampInteger(
    options.timeoutMs,
    DEFAULT_PUBLIC_FETCH_TIMEOUT_MS,
    1000,
    60000
  );
  const maxBytes = clampInteger(
    options.maxBytes,
    DEFAULT_PUBLIC_FETCH_MAX_BYTES,
    1024,
    8 * 1024 * 1024
  );
  const maxRedirects = clampInteger(
    options.maxRedirects,
    DEFAULT_PUBLIC_FETCH_MAX_REDIRECTS,
    0,
    10
  );
  const method = String(options.method || 'GET').toUpperCase();
  let validation = validateAndNormalizePublicHttpUrl(rawUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  let currentUrl = validation.url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (options.requirePublicDns !== false) {
      const dnsCheck = await verifyPublicDnsForUrl(currentUrl, timeoutMs);
      if (!dnsCheck.ok) {
        return dnsCheck;
      }
    }

    let response;
    try {
      response = await fetch(currentUrl, {
        method,
        headers: options.headers,
        body: options.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return {
        ok: false,
        error: error?.name === 'TimeoutError' ? 'Fetch timed out' : error?.message || 'Fetch failed'
      };
    }

    if (isRedirectStatus(response.status)) {
      if (method !== 'GET' && method !== 'HEAD') {
        return { ok: false, error: 'Redirects are not allowed for non-GET fetches' };
      }

      if (redirectCount >= maxRedirects) {
        return { ok: false, error: 'Too many redirects' };
      }

      const location = response.headers.get('Location');
      if (!location) {
        return { ok: false, error: 'Redirect response missing Location header' };
      }

      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, error: 'Redirect Location is not a valid URL' };
      }

      validation = validateAndNormalizePublicHttpUrl(nextUrl);
      if (!validation.ok) {
        return { ok: false, error: `Unsafe redirect target: ${validation.error}` };
      }
      currentUrl = validation.url;
      continue;
    }

    const body = await readResponseTextWithLimit(response, maxBytes);
    if (!body.ok) {
      return body;
    }

    return {
      ok: true,
      response,
      text: body.text,
      finalUrl: currentUrl
    };
  }

  return { ok: false, error: 'Too many redirects' };
}

export function isBlockedHostname(hostname) {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    return true;
  }

  return isPrivateOrLocalIp(hostname);
}

export function isPrivateOrLocalIp(hostname) {
  return isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

function hasDisallowedPort(parsed) {
  if (!parsed.port) {
    return false;
  }
  return !(
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  );
}

function normalizePath(parsed) {
  if (!parsed.pathname) {
    parsed.pathname = '/';
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
}

function stripTrackingParams(parsed) {
  for (const key of Array.from(parsed.searchParams.keys())) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || TRACKING_PARAMS.has(normalized)) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

async function readResponseTextWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, error: `Response too large; maximum is ${maxBytes} bytes` };
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > maxBytes) {
      return { ok: false, error: `Response too large; maximum is ${maxBytes} bytes` };
    }
    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { ok: false, error: `Response too large; maximum is ${maxBytes} bytes` };
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(buffer) };
}

async function verifyPublicDnsForUrl(rawUrl, timeoutMs) {
  let hostname;
  try {
    hostname = normalizeHostnameForChecks(new URL(rawUrl).hostname);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }

  if (isIpLiteral(hostname)) {
    return isPrivateOrLocalIp(hostname)
      ? { ok: false, error: 'URL host resolves to a private/local address' }
      : { ok: true };
  }

  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDnsRecords(hostname, 'A', timeoutMs),
    resolveDnsRecords(hostname, 'AAAA', timeoutMs)
  ]);

  if (!aRecords.ok) return aRecords;
  if (!aaaaRecords.ok) return aaaaRecords;

  const addresses = [...aRecords.addresses, ...aaaaRecords.addresses];
  if (addresses.length === 0) {
    return { ok: false, error: 'URL host did not resolve to a public address' };
  }

  if (addresses.some(address => isPrivateOrLocalIp(address))) {
    return { ok: false, error: 'URL host resolves to a private/local address' };
  }

  return { ok: true };
}

async function resolveDnsRecords(hostname, type, timeoutMs) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${encodeURIComponent(type)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, DNS_LOOKUP_TIMEOUT_MS))
    });
  } catch (error) {
    return { ok: false, error: error?.name === 'TimeoutError' ? 'DNS lookup timed out' : 'DNS lookup failed' };
  }

  if (!response.ok) {
    return { ok: false, error: 'DNS lookup failed' };
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'DNS lookup returned invalid data' };
  }

  if (data.Status !== 0 && data.Status !== 3) {
    return { ok: false, error: 'DNS lookup failed' };
  }

  const expectedType = type === 'A' ? 1 : 28;
  const addresses = (data.Answer || [])
    .filter(answer => answer?.type === expectedType && typeof answer.data === 'string')
    .map(answer => answer.data.toLowerCase().split('%')[0]);

  return { ok: true, addresses };
}

function isIpLiteral(hostname) {
  const normalized = normalizeHostnameForChecks(hostname);
  return isIpv4Literal(normalized) || normalized.includes(':');
}

function isIpv4Literal(hostname) {
  const parts = normalizeHostnameForChecks(hostname).split('.');
  return parts.length === 4 && parts.every(part => /^\d+$/.test(part));
}

function normalizeHostnameForChecks(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isPrivateIpv4(hostname) {
  const parts = normalizeHostnameForChecks(hostname).split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(p => Number.parseInt(p, 10));
  if (octets.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  return false;
}

function clampInteger(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, parsed));
}

function isPrivateIpv6(hostname) {
  if (!hostname.includes(':')) {
    return false;
  }

  const normalized = normalizeHostnameForChecks(hostname).split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4 && isPrivateIpv4(mappedIpv4[1])) return true;
  if (/(^|:)ffff:/.test(normalized)) return true;

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  return (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}
