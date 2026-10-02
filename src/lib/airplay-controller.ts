import { randomUUID } from "node:crypto";
import net from "node:net";
import type { Classroom } from "@/config/classrooms";
import type { DeviceStatus, TransmissionLog } from "@/lib/broadcast-types";

function log(
  room: Classroom,
  action: string,
  status: number | null,
  latencyMs: number,
  ok: boolean,
  message: string,
  deviceStatus?: DeviceStatus,
): TransmissionLog {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    classroomId: room.id,
    name: room.name,
    ip: room.ip,
    action,
    status,
    latencyMs,
    ok,
    message,
    deviceStatus,
  };
}

function airplayRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body = "",
  contentType?: string,
  timeoutMs = 4000,
) {
  return new Promise<{ status: number | null; text: string; latencyMs: number }>((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const payload = Buffer.from(body);
    const headers = [
      `${method} ${path} HTTP/1.1`,
      `Host: ${host}`,
      "User-Agent: AirPlay/220.68",
      `Content-Length: ${payload.length}`,
      "Connection: close",
    ];
    if (contentType) headers.push(`Content-Type: ${contentType}`);
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (status: number | null, text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ status, text, latencyMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish(null, ""), timeoutMs);
    socket.on("error", () => finish(null, ""));
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString("utf8");
      const split = text.indexOf("\r\n\r\n");
      if (split < 0) return;
      const head = text.slice(0, split);
      const length = Number(head.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0);
      if (buf.length < split + 4 + length) return;
      const status = Number(text.match(/^HTTP\/1\.[01] (\d+)/)?.[1] ?? 0) || null;
      finish(status, text);
    });
    socket.on("connect", () => {
      socket.write(Buffer.concat([Buffer.from(`${headers.join("\r\n")}\r\n\r\n`), payload]));
    });
  });
}

function playing(xml: string) {
  const rate = Number(xml.match(/<key>rate<\/key>\s*<real>([^<]+)/)?.[1] ?? 0);
  return rate > 0;
}

export async function probeAirPlay(room: Classroom): Promise<TransmissionLog> {
  const info = await airplayRequest(room.ip, room.port, "GET", "/server-info", "", undefined, 1500);
  if (info.status !== 200) {
    return log(room, "AirPlay", info.status, info.latencyMs, false, "칠판에 연결하지 못했습니다", "offline");
  }
  const playback = await airplayRequest(room.ip, room.port, "GET", "/playback-info", "", undefined, 1500);
  const streaming = playback.status === 200 && playing(playback.text);
  return log(
    room,
    "AirPlay",
    info.status,
    info.latencyMs,
    true,
    `AirPlay ${room.port}`,
    streaming ? "streaming" : "idle",
  );
}

export async function airplayControl(
  room: Classroom,
  action: "play" | "pause" | "stop" | "volume",
  options: { mediaUrl?: string; volume?: number },
): Promise<TransmissionLog[]> {
  if (action === "stop") {
    const result = await airplayRequest(room.ip, room.port, "POST", "/stop");
    const ok = result.status === 200;
    return [
      log(room, "Stop", result.status, result.latencyMs, ok, ok ? "Stop 200" : "소리를 멈추지 못했습니다", "idle"),
    ];
  }

  if (action === "pause") {
    const result = await airplayRequest(room.ip, room.port, "POST", "/rate?value=0");
    const ok = result.status === 200;
    return [
      log(
        room,
        "Pause",
        result.status,
        result.latencyMs,
        ok,
        ok ? "Pause 200" : "소리를 멈추지 못했습니다",
        ok ? "idle" : "offline",
      ),
    ];
  }

  if (action === "volume") {
    const level = Math.max(0, Math.min(1, (options.volume ?? 70) / 100));
    const result = await airplayRequest(room.ip, room.port, "POST", `/volume?value=${level.toFixed(2)}`);
    const ok = result.status === 200;
    return [
      log(
        room,
        "SetVolume",
        result.status,
        result.latencyMs,
        ok,
        ok ? "SetVolume 200" : "음량을 바꾸지 못했습니다",
      ),
    ];
  }

  if (!options.mediaUrl) {
    return [log(room, "Play", null, 0, false, "보낼 음원이 없습니다", "idle")];
  }

  const body = `Content-Location: ${options.mediaUrl}\r\nStart-Position: 0\r\n`;
  const result = await airplayRequest(room.ip, room.port, "POST", "/play", body, "text/parameters");
  if (result.status !== 200) {
    return [
      log(
        room,
        "Play",
        result.status,
        result.latencyMs,
        false,
        result.status === null ? "칠판에 연결하지 못했습니다" : "칠판이 소리를 받지 못했습니다",
        result.status === null ? "offline" : "idle",
      ),
    ];
  }

  const level = Math.max(0, Math.min(1, (options.volume ?? 70) / 100));
  await airplayRequest(room.ip, room.port, "POST", `/volume?value=${level.toFixed(2)}`);
  return [log(room, "Play", result.status, result.latencyMs, true, "Play 200", "streaming")];
}
