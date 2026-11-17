import os from "node:os";

/** 학교 와이파이 SSID 201. DHCP 마스크 255.255.240.0 → 172.30.0.0/20 */
export const SCHOOL_SSID = "201";
export const SCHOOL_NETWORK = "172.30.0.0";
export const SCHOOL_PREFIX = 20;

function ipv4ToInt(ip: string) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function isSchoolLan(ip: string) {
  const value = ipv4ToInt(ip);
  const network = ipv4ToInt(SCHOOL_NETWORK);
  if (value === null || network === null) return false;
  const mask = (0xffffffff << (32 - SCHOOL_PREFIX)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPrivate(ip: string) {
  return (
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

export function getLanIp(): string {
  const ranked: { name: string; address: string }[] = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (/^(utun|awdl|llw|bridge|vmnet|vboxnet)/.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        ranked.push({ name, address: address.address });
      }
    }
  }

  const physical = ranked.filter((item) => item.name.startsWith("en"));
  const pool = physical.length > 0 ? physical : ranked;
  return (
    pool.find((item) => isSchoolLan(item.address))?.address ??
    pool.find((item) => item.address.startsWith("192.168."))?.address ??
    pool.find((item) => isPrivate(item.address))?.address ??
    pool[0]?.address ??
    "127.0.0.1"
  );
}

export function originFromRequest(request: Request): string {
  const host = request.headers.get("host") ?? "localhost:3000";
  const port = host.includes(":") ? host.slice(host.lastIndexOf(":") + 1) : "3000";
  return `http://${getLanIp()}:${port}`;
}
