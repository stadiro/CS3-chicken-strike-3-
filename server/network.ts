import { networkInterfaces } from 'node:os';

export interface LanAddress {
  address: string;
  interfaceName: string;
}

export function normalizeHostname(host: string): string {
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice('::ffff:'.length);
  }
  return normalized;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  return (
    normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function getLanAddresses(): LanAddress[] {
  const addresses: LanAddress[] = [];

  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }
      if (entry.address.startsWith('169.254.')) {
        continue;
      }
      addresses.push({ address: entry.address, interfaceName });
    }
  }

  return addresses;
}

export function formatServerUrls(port: number, host: string): string[] {
  const lines = [`Local:   http://localhost:${port}`];
  const lanAddresses = getLanAddresses();

  if (lanAddresses.length === 0) {
    lines.push('Network: no LAN IPv4 address found');
  } else {
    for (const { address, interfaceName } of lanAddresses) {
      lines.push(`Network: http://${address}:${port}  (${interfaceName})`);
    }
  }

  if (host !== '0.0.0.0' && host !== '::') {
    lines.push(`Bound:   ${host}:${port}`);
  }

  return lines;
}
