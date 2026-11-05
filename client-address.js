import { isIP } from 'node:net';

function normalizeIP(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // IPv4 e sua representação IPv6 mapeada compartilham o mesmo contador.
  const mapped = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  return mapped.slice(1).flatMap(part => {
    const number = parseInt(part, 16);
    return [number >>> 8, number & 255];
  }).join('.');
}

export function createClientAddress({ trustProxy = false, trustedProxyIps = [] } = {}) {
  if (typeof trustProxy !== 'boolean') throw new TypeError('TRUST_PROXY deve ser true ou false.');
  if (!trustProxy) return req => req.socket.remoteAddress;
  if (!Array.isArray(trustedProxyIps) || !trustedProxyIps.length) throw new Error('Configure TRUSTED_PROXY_IPS antes de ativar TRUST_PROXY.');
  const trusted = new Set(trustedProxyIps.map(ip => {
    const normalized = normalizeIP(ip);
    if (!normalized) throw new Error('TRUSTED_PROXY_IPS aceita somente endereços IP individuais válidos.');
    return normalized;
  }));
  return req => {
    const socketAddress = normalizeIP(req.socket.remoteAddress) || req.socket.remoteAddress;
    if (!trusted.has(socketAddress) || typeof req.headers['x-forwarded-for'] !== 'string') return socketAddress;
    const forwarded = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    // Cabeçalhos malformados não criam contadores arbitrários.
    if (forwarded.length > 32) return socketAddress;
    const addresses = forwarded.map(normalizeIP);
    if (addresses.some(ip => !ip)) return socketAddress;
    let current = socketAddress;
    for (let i = addresses.length - 1; i >= 0 && trusted.has(current); i--) current = addresses[i];
    return current;
  };
}
