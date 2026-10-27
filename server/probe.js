import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function parseTarget(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error(
      'Usa una URL HTTP o HTTPS sin credenciales, fragmentos ni puertos alternativos.',
    );
  return url;
}
export async function probe(value, { resolver = lookup, timeout = 7000, redirects = 0 } = {}) {
  const started = Date.now();
  const url = parseTarget(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
    throw new Error('El destino debe tener únicamente direcciones IP públicas.');
  const pinned = addresses[0];
  const response = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'Vigia/1.0', Accept: '*/*' },
        lookup: (name, options, callback) =>
          options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      },
      (result) => {
        resolve({ status: result.statusCode, location: result.headers.location });
        result.destroy();
      },
    );
    request.setTimeout(timeout, () => request.destroy(new Error('Tiempo de espera agotado.')));
    request.on('error', reject);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
    if (redirects >= 3) throw new Error('Demasiadas redirecciones.');
    const next = await probe(new URL(response.location, url).href, {
      resolver,
      timeout,
      redirects: redirects + 1,
    });
    return { ...next, latencyMs: Date.now() - started };
  }
  return {
    ok: response.status >= 200 && response.status < 400,
    status: response.status,
    latencyMs: Date.now() - started,
  };
}
