import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { getAudio, isAudioId } from "@/lib/audio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function openLocal(id: string) {
  const record = await getAudio(id);
  if (!record || record.kind !== "file" || !record.filePath) return null;
  const stat = await fs.stat(record.filePath);
  return { record, stat };
}

function headersFor(mime: string, size: number, start?: number, end?: number) {
  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
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
  const { id } = await context.params;
  if (!isAudioId(id)) return new Response("Not found", { status: 404 });

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

  const size = local.stat.size;
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = rangeOf(rangeHeader, size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const nodeStream = createReadStream(local.record.filePath!, range);
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: headersFor(local.record.mime, size, range.start, range.end),
    });
  }

  const nodeStream = createReadStream(local.record.filePath!);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: headersFor(local.record.mime, size),
  });
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isAudioId(id)) return new Response(null, { status: 404 });
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
    headers: headersFor(local.record.mime, local.stat.size),
  });
}
