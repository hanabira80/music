import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { getAudio, isAudioId } from "@/lib/audio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function streamId(raw: string) {
  const id = raw.replace(/\.(mp3|wav)$/i, "");
  return isAudioId(id) ? id : null;
}

function rangeOf(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  const start = startRaw ? Number(startRaw) : Math.max(0, size - Number(endRaw));
  let end = endRaw && startRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || start > end) {
    return null;
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

async function frameOffset(filePath: string, size: number) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(10);
    const read = await handle.read(header, 0, 10, 0);
    if (read.bytesRead < 10 || header.toString("latin1", 0, 3) !== "ID3" || header[3] !== 4) return 0;
    const tag =
      10 +
      (((header[6] & 0x7f) << 21) |
        ((header[7] & 0x7f) << 14) |
        ((header[8] & 0x7f) << 7) |
        (header[9] & 0x7f)) +
      ((header[5] & 0x10) ? 10 : 0);
    if (tag < 10 || tag >= size - 1) return 0;
    const frame = Buffer.alloc(2);
    const frameRead = await handle.read(frame, 0, 2, tag);
    if (frameRead.bytesRead < 2 || frame[0] !== 0xff || (frame[1] & 0xe0) !== 0xe0) return 0;
    return tag;
  } finally {
    await handle.close();
  }
}

async function openLocal(id: string) {
  const record = await getAudio(id);
  if (!record || record.kind !== "file" || !record.filePath) return null;
  const stat = await fs.stat(record.filePath);
  const offset = record.mime === "audio/mpeg" ? await frameOffset(record.filePath, stat.size) : 0;
  return { record, offset, size: stat.size - offset };
}

function headersFor(mime: string, size: number, start?: number, end?: number) {
  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="${mime === "audio/wav" ? "audio.wav" : "audio.mp3"}"`,
  });
  if (start !== undefined && end !== undefined) {
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  } else {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = streamId(rawId);
  if (!id) return new Response("Not found", { status: 404 });

  const record = await getAudio(id);
  if (!record) return new Response("Not found", { status: 404 });

  if (record.kind === "url" && record.sourceUrl) {
    const range = request.headers.get("range");
    const upstreamHeaders = new Headers();
    if (range) upstreamHeaders.set("range", range);
    const upstream = await fetch(record.sourceUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
    });
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    headers.set("Content-Type", contentType.startsWith("audio/") ? contentType : "audio/mpeg");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");
    const length = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (length) headers.set("Content-Length", length);
    if (contentRange) headers.set("Content-Range", contentRange);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const local = await openLocal(id);
  if (!local) return new Response("Not found", { status: 404 });

  const size = local.size;
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = rangeOf(rangeHeader, size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const nodeStream = createReadStream(local.record.filePath!, {
      start: local.offset + range.start,
      end: local.offset + range.end,
    });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: headersFor(local.record.mime, size, range.start, range.end),
    });
  }

  const nodeStream = createReadStream(local.record.filePath!, { start: local.offset });
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: headersFor(local.record.mime, size),
  });
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = streamId(rawId);
  if (!id) return new Response(null, { status: 404 });
  const record = await getAudio(id);
  if (!record) return new Response(null, { status: 404 });
  if (record.kind === "url") {
    return new Response(null, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
    });
  }
  const local = await openLocal(id);
  if (!local) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: headersFor(local.record.mime, local.size),
  });
}
