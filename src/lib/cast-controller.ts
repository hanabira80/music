import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import net from "node:net";
import type { Classroom } from "@/config/classrooms";
import type { DeviceStatus, TransmissionLog } from "@/lib/broadcast-types";

const require = createRequire(import.meta.url);
const { Client, DefaultMediaReceiver } = require("castv2-client") as {
  Client: new () => CastClient;
  DefaultMediaReceiver: unknown;
};


type CastPlayer = {
  load: (
    media: { contentId: string; contentType: string; streamType: string },
    options: { autoplay: boolean },
    callback: (error: Error | null) => void,
  ) => void;
  pause: (callback: (error: Error | null) => void) => void;
  stop: (callback: (error: Error | null) => void) => void;
};

type CastClient = {
  connect: (
    options: { host: string; port: number; rejectUnauthorized: boolean },
    callback: () => void,
  ) => void;
  launch: (app: unknown, callback: (error: Error | null, player?: CastPlayer) => void) => void;
  setVolume: (volume: { level: number }, callback: (error: Error | null) => void) => void;
  close: () => void;
  on: (event: "error", callback: (error: Error) => void) => void;
};

type Session = { client: CastClient; player: CastPlayer };

const sessions = new Map<string, Session>();

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

function closeSession(ip: string) {
  const session = sessions.get(ip);
  if (!session) return;
  sessions.delete(ip);
  try {
    session.client.close();
  } catch {
    // The board may already have dropped the sender.
  }
}

function connectClient(ip: string, port: number) {
  return new Promise<CastClient>((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (error?: Error, connected?: CastClient) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error || !connected) reject(error ?? new Error("칠판 Cast에 연결하지 못했습니다"));
      else resolve(connected);
    };
    const timer = setTimeout(() => {
      try {
        client.close();
      } catch {
        // Already closed.
      }
      finish(new Error("칠판 Cast에 연결하지 못했습니다"));
    }, 4000);
    client.on("error", (error) => finish(error));
    client.connect({ host: ip, port, rejectUnauthorized: false }, () => finish(undefined, client));
  });
}

function launchPlayer(client: CastClient) {
  return new Promise<CastPlayer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("칠판에서 영상 앱을 열지 못했습니다")), 8000);
    client.launch(DefaultMediaReceiver, (error, player) => {
      clearTimeout(timer);
      if (error || !player) reject(error ?? new Error("칠판에서 영상 앱을 열지 못했습니다"));
      else resolve(player);
    });
  });
}

function loadMedia(player: CastPlayer, mediaUrl: string, mime: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("영상을 시작하지 못했습니다")), 8000);
    player.load(
      { contentId: mediaUrl, contentType: mime, streamType: "BUFFERED" },
      { autoplay: true },
      (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

export function probeCast(room: Classroom): Promise<TransmissionLog> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: room.ip, port: room.port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(
        log(
          room,
          "Cast",
          ok ? 200 : null,
          Date.now() - started,
          ok,
          ok ? `Cast ${room.port}` : "칠판 Cast에 연결하지 못했습니다",
          ok ? "idle" : "offline",
        ),
      );
    };
    const timer = setTimeout(() => done(false), 800);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function castControl(
  room: Classroom,
  action: "play" | "pause" | "stop" | "volume",
  options: { mediaUrl?: string; mime?: string; volume?: number },
): Promise<TransmissionLog[]> {
  const started = Date.now();
  try {
    if (action === "stop") {
      const session = sessions.get(room.ip);
      if (!session) {
        return [log(room, "Stop", null, 0, false, "재생 중인 영상이 없습니다", "idle")];
      }
      await new Promise<void>((resolve, reject) => {
        session.player.stop((error) => (error ? reject(error) : resolve()));
      });
      closeSession(room.ip);
      return [log(room, "Stop", 200, Date.now() - started, true, "Stop 200", "idle")];
    }

    if (action === "pause") {
      const session = sessions.get(room.ip);
      if (!session) {
        return [log(room, "Pause", null, 0, false, "재생 중인 영상이 없습니다", "idle")];
      }
      await new Promise<void>((resolve, reject) => {
        session.player.pause((error) => (error ? reject(error) : resolve()));
      });
      return [log(room, "Pause", 200, Date.now() - started, true, "Pause 200", "idle")];
    }

    if (action === "volume") {
      const level = Math.max(0, Math.min(1, (options.volume ?? 70) / 100));
      const session = sessions.get(room.ip);
      const client = session?.client ?? (await connectClient(room.ip, room.port));
      await new Promise<void>((resolve, reject) => {
        client.setVolume({ level }, (error) => (error ? reject(error) : resolve()));
      });
      if (!session) client.close();
      return [log(room, "SetVolume", 200, Date.now() - started, true, "SetVolume 200")];
    }

    if (!options.mediaUrl) {
      return [log(room, "Load", null, 0, false, "보낼 영상이 없습니다", "idle")];
    }

    closeSession(room.ip);
    const client = await connectClient(room.ip, room.port);
    try {
      const player = await launchPlayer(client);
      await loadMedia(player, options.mediaUrl, options.mime || "video/mp4");
      const level = Math.max(0, Math.min(1, (options.volume ?? 70) / 100));
      await new Promise<void>((resolve) => {
        client.setVolume({ level }, () => resolve());
      });
      sessions.set(room.ip, { client, player });
      return [log(room, "Play", 200, Date.now() - started, true, "Play 200", "streaming")];
    } catch (error) {
      try {
        client.close();
      } catch {
        // Ignore a failed close after a failed launch.
      }
      throw error;
    }
  } catch (error) {
    return [
      log(
        room,
        action === "play" ? "Play" : action === "pause" ? "Pause" : action === "stop" ? "Stop" : "SetVolume",
        null,
        Date.now() - started,
        false,
        error instanceof Error ? error.message : "영상을 보내지 못했습니다",
        "offline",
      ),
    ];
  }
}
