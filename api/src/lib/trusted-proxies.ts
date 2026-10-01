import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import proxyAddr from "@fastify/proxy-addr";

type Range = [bigint, bigint];
const ipv4Max = (1n << 32n) - 1n;
const mappedStart = 0xffffn << 32n;

function coversAll(ranges: Range[], max: bigint): boolean {
  let next = 0n;
  for (const [start, end] of ranges.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    if (start > next) return false;
    if (end >= next) next = end + 1n;
  }
  return next > max;
}

export function getTrustedProxies(value: string | undefined, production: boolean): string[] | false {
  if (production && value === undefined) {
    throw new Error("Set TRUSTED_PROXIES explicitly: proxy IPs/CIDRs, or empty for direct connections");
  }
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const ipv4: Range[] = [];
  const ipv6: Range[] = [];
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split("/");
    const version = isIP(address);
    if (!version || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error("TRUSTED_PROXIES must contain explicit IPs or CIDRs; universal networks are forbidden");
    }
    const bits = version === 4 ? 32 : 128;
    const number = ipaddr.parse(address).toByteArray().reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
    const hostBits = BigInt(bits - Number(prefix ?? bits));
    const start = (number >> hostBits) << hostBits;
    const end = start + (1n << hostBits) - 1n;
    if (version === 4) ipv4.push([start, end]);
    else {
      ipv6.push([start, end]);
      // Fastify matches IPv4 clients against their mapped IPv6 representation.
      const low = start > mappedStart ? start : mappedStart;
      const high = end < mappedStart + ipv4Max ? end : mappedStart + ipv4Max;
      if (low <= high) ipv4.push([low - mappedStart, high - mappedStart]);
    }
  }
  if (coversAll(ipv4, ipv4Max) || coversAll(ipv6, (1n << 128n) - 1n)) {
    throw new Error("TRUSTED_PROXIES cannot collectively trust every IPv4 or IPv6 client");
  }
  return entries.length ? entries : false;
}

export function createProxyTrust(value: string | undefined, production: boolean) {
  const entries = getTrustedProxies(value, production);
  return entries ? proxyAddr.compile(entries) : () => false;
}
