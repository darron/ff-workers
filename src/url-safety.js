/**
 * Shared public URL validation for source ingestion and admin story CRUD.
 */

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

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) {
      return { ok: false, error: 'URL host is required' };
    }

    if (isBlockedHostname(hostname)) {
      return { ok: false, error: 'Private/local hostnames are not allowed' };
    }

    parsed.hostname = hostname;
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
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

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.');
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

function isPrivateIpv6(hostname) {
  if (!hostname.includes(':')) {
    return false;
  }

  const normalized = hostname.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  return (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}
