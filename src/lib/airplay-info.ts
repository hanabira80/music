const PORT_KEYS = ["server_port", "audioPort", "dataPort", "eventPort", "port", "controlPort"] as const;

export type SpeakerPort = {
  port: number;
  key: string;
  keys: string[];
};

function asPort(value: unknown) {
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function pickPort(entries: Record<string, unknown>, keys: string[]): SpeakerPort | null {
  for (const key of PORT_KEYS) {
    const port = asPort(entries[key]);
    if (port) return { port, key, keys };
  }
  return null;
}

function readBe(buf: Buffer, offset: number, size: number) {
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + buf[offset + i];
  return value;
}

function parseXml(text: string) {
  const entries: Record<string, unknown> = {};
  const keys: string[] = [];
  const pattern = /<key>\s*([^<]+?)\s*<\/key>\s*<(integer|string|real)>\s*([^<]*?)\s*<\/\2>/gi;
  for (const match of text.matchAll(pattern)) {
    const key = match[1].trim();
    keys.push(key);
    entries[key] = match[2].toLowerCase() === "string" ? match[3].trim() : Number(match[3]);
  }
  return { entries, keys };
}

function parseLines(text: string) {
  const entries: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*"?(\d{1,5})"?\s*$/);
    if (!match) continue;
    keys.push(match[1]);
    entries[match[1]] = Number(match[2]);
  }
  return { entries, keys };
}

function parseBinary(buf: Buffer) {
  const entries: Record<string, unknown> = {};
  const keys: string[] = [];
  if (buf.length < 40 || buf.subarray(0, 6).toString("ascii") !== "bplist") return { entries, keys };
  const trailer = buf.subarray(buf.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const count = readBe(trailer, 8, 8);
  const top = readBe(trailer, 16, 8);
  const table = readBe(trailer, 24, 8);
  if (offsetSize < 1 || refSize < 1 || count < 1 || table < 0 || table >= buf.length) return { entries, keys };

  const offsetOf = (index: number) => {
    if (index < 0 || index >= count) return -1;
    return readBe(buf, table + index * offsetSize, offsetSize);
  };

  const readLength = (info: number, offset: number) => {
    if (info !== 0x0f) return { length: info, next: offset };
    const marker = buf[offset] ?? 0;
    const size = 1 << (marker & 0x0f);
    return { length: readBe(buf, offset + 1, size), next: offset + 1 + size };
  };

  const readObject = (index: number, depth: number): unknown => {
    if (depth > 8) return null;
    const offset = offsetOf(index);
    if (offset < 0 || offset >= buf.length) return null;
    const marker = buf[offset] ?? 0;
    const type = marker >> 4;
    const info = marker & 0x0f;
    if (type === 0x1) {
      const size = 1 << info;
      return readBe(buf, offset + 1, size);
    }
    if (type === 0x5 || type === 0x6) {
      const sized = readLength(info, offset + 1);
      const bytes = buf.subarray(sized.next, sized.next + sized.length * (type === 0x6 ? 2 : 1));
      return type === 0x6 ? bytes.toString("utf16le") : bytes.toString("ascii");
    }
    if (type !== 0x0d) return null;
    const sized = readLength(info, offset + 1);
    let cursor = sized.next;
    const keyRefs: number[] = [];
    const valueRefs: number[] = [];
    for (let i = 0; i < sized.length; i += 1) {
      keyRefs.push(readBe(buf, cursor, refSize));
      cursor += refSize;
    }
    for (let i = 0; i < sized.length; i += 1) {
      valueRefs.push(readBe(buf, cursor, refSize));
      cursor += refSize;
    }
    const dict: Record<string, unknown> = {};
    for (let i = 0; i < sized.length; i += 1) {
      const key = readObject(keyRefs[i], depth + 1);
      if (typeof key !== "string") continue;
      dict[key] = readObject(valueRefs[i], depth + 1);
    }
    return dict;
  };

  const root = readObject(top, 0);
  if (!root || typeof root !== "object" || Array.isArray(root)) return { entries, keys };
  for (const [key, value] of Object.entries(root)) {
    keys.push(key);
    entries[key] = value;
  }
  return { entries, keys };
}

export function speakerPortFromInfo(body: Buffer): SpeakerPort | { port: null; key: null; keys: string[] } {
  const ascii = body.subarray(0, 6).toString("ascii");
  const parsed = ascii === "bplist" ? parseBinary(body) : body.toString("latin1").includes("<key>") ? parseXml(body.toString("latin1")) : parseLines(body.toString("latin1"));
  return pickPort(parsed.entries, parsed.keys) ?? { port: null, key: null, keys: parsed.keys };
}
