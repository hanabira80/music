import os from "node:os";

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
