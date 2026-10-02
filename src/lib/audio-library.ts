import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type AudioRecord = {
  id: string;
  name: string;
  mime: "audio/mpeg" | "audio/wav";
  kind: "file" | "url";
  filePath?: string;
  sourceUrl?: string;
};

const libraryDir = path.join(process.cwd(), "data", "audio");
const idPattern = /^[a-zA-Z0-9-]{8,64}$/;

function metaPath(id: string) {
  return path.join(libraryDir, `${id}.json`);
}

export function isAudioId(id: string) {
  return idPattern.test(id);
}

async function ensureDir() {
  await fs.mkdir(libraryDir, { recursive: true });
}

export function mimeForUpload(fileName: string, fileType: string): AudioRecord["mime"] | null {
  const lower = fileName.toLowerCase();
  if (fileType === "audio/mpeg" || lower.endsWith(".mp3")) return "audio/mpeg";
  if (
    fileType === "audio/wav" ||
    fileType === "audio/x-wav" ||
    fileType === "audio/wave" ||
    lower.endsWith(".wav")
  ) {
    return "audio/wav";
  }
  return null;
}

export async function saveUpload(
  fileName: string,
  mime: AudioRecord["mime"],
  webStream: ReadableStream<Uint8Array>,
): Promise<AudioRecord> {
  await ensureDir();
  const id = randomUUID();
  const ext = mime === "audio/wav" ? "wav" : "mp3";
  const filePath = path.join(libraryDir, `${id}.${ext}`);
  await pipeline(
    Readable.fromWeb(webStream as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(filePath),
  );
  const record: AudioRecord = {
    id,
    name: path.basename(fileName),
    mime,
    kind: "file",
    filePath,
  };
  await fs.writeFile(metaPath(id), JSON.stringify(record));
  return record;
}

export async function registerUrl(sourceUrl: string): Promise<AudioRecord> {
  await ensureDir();
  const id = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  const record: AudioRecord = {
    id,
    name: sourceUrl,
    mime: "audio/mpeg",
    kind: "url",
    sourceUrl,
  };
  await fs.writeFile(metaPath(id), JSON.stringify(record));
  return record;
}

export async function getAudio(id: string): Promise<AudioRecord | null> {
  if (!isAudioId(id)) return null;
  try {
    const raw = await fs.readFile(metaPath(id), "utf8");
    const record = JSON.parse(raw) as AudioRecord;
    if (record.kind === "file" && record.filePath) {
      const resolved = path.resolve(record.filePath);
      if (!resolved.startsWith(path.resolve(libraryDir) + path.sep)) return null;
    }
    return record;
  } catch {
    return null;
  }
}
