import { randomInt, randomUUID } from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import type { Classroom } from "@/config/classrooms";
import { SPEAKER_TONE_ROOM_ID } from "@/config/classrooms";
import { ALAC_FRAME_SAMPLES, ALAC_SAMPLE_RATE, alacToneFrames } from "@/lib/alac-tone";
import type { TransmissionLog } from "@/lib/broadcast-types";
import { getLanIp } from "@/lib/local-ip";

const TONE_SECONDS = 3;

type RtspReply = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function log(
  room: Classroom,
  status: number | null,
  latencyMs: number,
  ok: boolean,
  message: string,
  deviceStatus?: TransmissionLog["deviceStatus"],
): TransmissionLog {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    classroomId: room.id,
    name: room.name,
    ip: room.ip,
    action: "Tone",
    status,
    latencyMs,
    ok,
    message,
    deviceStatus,
  };
}

function sourceIp(target: string) {
  const prefix = target.split(".").slice(0, 2).join(".");
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && address.address.startsWith(`${prefix}.`)) {
        return address.address;
      }
    }
  }
  return getLanIp();
}

function volumeDb(percent: number) {
  const level = Math.max(0, Math.min(100, percent)) / 100;
  return (-30 + level * 30).toFixed(6);
}

class RtspSession {
  private buf = Buffer.alloc(0);
  private cseq = 0;
  private pending: {
    resolve: (reply: RtspReply) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on("error", () => this.fail(new Error("closed")));
    socket.on("close", () => this.fail(new Error("closed")));
  }

  request(method: string, uri: string, headers: Record<string, string>, body = "") {
    this.cseq += 1;
    const payload = Buffer.from(body);
    const lines = [
      `${method} ${uri} RTSP/1.0`,
      `CSeq: ${this.cseq}`,
      "User-Agent: AirPlay/220.68",
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
      `Content-Length: ${payload.length}`,
      "",
      "",
    ];
    return new Promise<RtspReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("timeout"));
      }, 4000);
      this.pending = { resolve, reject, timer };
      this.socket.write(Buffer.concat([Buffer.from(lines.join("\r\n")), payload]));
    });
  }

  close() {
    this.socket.destroy();
  }

  private drain() {
    if (!this.pending) return;
    const split = this.buf.indexOf("\r\n\r\n");
    if (split < 0) return;
    const head = this.buf.subarray(0, split).toString("utf8");
    const length = Number(head.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0);
    if (this.buf.length < split + 4 + length) return;
    const body = this.buf.subarray(split + 4, split + 4 + length).toString("utf8");
    this.buf = this.buf.subarray(split + 4 + length);
    const status = Number(head.match(/^(?:RTSP|HTTP)\/1\.[01] (\d+)/)?.[1] ?? 0) || null;
    const headers: Record<string, string> = {};
    for (const line of head.split("\r\n").slice(1)) {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve({ status: status ?? 0, headers, body });
  }

  private fail(error: Error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }
}

function connectTcp(host: string, port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, 4000);
    socket.once("error", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

function bindUdp() {
  return new Promise<{ socket: dgram.Socket; port: number }>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const fail = (error: Error) => {
      socket.close();
      reject(error);
    };
    socket.once("error", fail);
    socket.bind(0, () => {
      socket.off("error", fail);
      socket.on("error", () => undefined);
      const address = socket.address();
      resolve({ socket, port: typeof address === "string" ? 0 : address.port });
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rtpPacket(seq: number, timestamp: number, ssrc: Buffer, payload: Buffer, marker: boolean) {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = marker ? 0xe0 : 0x60;
  header.writeUInt16BE(seq & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  ssrc.copy(header, 8);
  return Buffer.concat([header, payload]);
}

const TONE_FRAMES = alacToneFrames();
let toneBusy = false;

export function isSpeakerToneRoom(room: Classroom) {
  return room.id === SPEAKER_TONE_ROOM_ID && room.ip === "172.30.7.209";
}

export async function playSpeakerTone(
  room: Classroom,
  volume: number,
  emit: (entry: TransmissionLog) => void,
) {
  if (!isSpeakerToneRoom(room)) {
    emit(log(room, null, 0, false, "시험음은 2-8반만 보냅니다", "idle"));
    return;
  }
  if (toneBusy) {
    emit(log(room, null, 0, false, "시험음이 이미 나가고 있습니다", "streaming"));
    return;
  }

  toneBusy = true;
  const started = Date.now();
  let stage: "connect" | "send" = "connect";
  let rtsp: RtspSession | null = null;
  let control: dgram.Socket | null = null;
  let timing: dgram.Socket | null = null;
  let audio: dgram.Socket | null = null;
  try {
    const socket = await connectTcp(room.ip, room.port);
    rtsp = new RtspSession(socket);
    const sessionId = randomInt(1, 2 ** 31);
    const uri = `rtsp://${room.ip}/${sessionId}`;
    const client = randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const common = {
      "Client-Instance": client,
      "DACP-ID": client,
      "Active-Remote": String(randomInt(1, 2 ** 31)),
    };

    const options = await rtsp.request("OPTIONS", "*", common);
    if (options.status !== 200) {
      emit(log(room, options.status, Date.now() - started, false, "스피커 연결이 거절됐습니다", "idle"));
      return;
    }

    const localIp = sourceIp(room.ip);
    const sdp = [
      "v=0",
      `o=AirTunes ${sessionId} 0 IN IP4 ${localIp}`,
      "s=AirTunes",
      `c=IN IP4 ${room.ip}`,
      "t=0 0",
      "m=audio 0 RTP/AVP 96",
      "a=rtpmap:96 AppleLossless",
      "a=fmtp:96 352 0 16 40 10 14 2 255 0 0 44100",
      "a=min-latency:11025",
      "",
    ].join("\r\n");
    const announce = await rtsp.request("ANNOUNCE", uri, { ...common, "Content-Type": "application/sdp" }, sdp);
    if (announce.status !== 200) {
      emit(log(room, announce.status, Date.now() - started, false, "스피커 연결이 거절됐습니다", "idle"));
      return;
    }

    const controlPort = await bindUdp();
    control = controlPort.socket;
    const timingPort = await bindUdp();
    timing = timingPort.socket;
    const setup = await rtsp.request("SETUP", uri, {
      ...common,
      Transport: `RTP/AVP/UDP;unicast;interleaved=0-1;mode=record;control_port=${controlPort.port};timing_port=${timingPort.port}`,
    });
    const transport = setup.headers.transport ?? "";
    const serverPort = Number(transport.match(/server_port=(\d+)/)?.[1] ?? 0);
    const session = (setup.headers.session ?? "").split(";")[0].trim();
    if (setup.status !== 200) {
      emit(log(room, setup.status || null, Date.now() - started, false, "스피커 연결이 거절됐습니다", "idle"));
      return;
    }
    if (serverPort < 1 || serverPort > 65535) {
      emit(
        log(
          room,
          setup.status,
          Date.now() - started,
          false,
          transport ? `연결 답장에 포트가 없었습니다: ${transport}` : "연결 답장에 포트가 없었습니다",
          "idle",
        ),
      );
      return;
    }

    const seq0 = randomInt(0, 65536);
    const rtp0 = randomInt(0, 2 ** 32);
    const record = await rtsp.request("RECORD", uri, {
      ...common,
      Session: session,
      Range: "npt=0-",
      "RTP-Info": `seq=${seq0};rtptime=${rtp0}`,
    });
    if (record.status !== 200) {
      await rtsp.request("TEARDOWN", uri, { ...common, Session: session }).catch(() => null);
      emit(log(room, record.status, Date.now() - started, false, "스피커가 재생을 받지 않았습니다", "idle"));
      return;
    }

    await rtsp
      .request(
        "SET_PARAMETER",
        uri,
        { ...common, Session: session, "Content-Type": "text/parameters" },
        `volume: ${volumeDb(volume)}\r\n`,
      )
      .catch(() => null);

    emit(
      log(
        room,
        record.status,
        Date.now() - started,
        true,
        `스피커 포트 ${serverPort}. 잠그지 않은 ALAC ${TONE_SECONDS}초. 박자 신호는 없음`,
        "streaming",
      ),
    );

    stage = "send";
    audio = dgram.createSocket("udp4");
    audio.on("error", () => undefined);
    const frames = TONE_FRAMES;
    const ssrc = Buffer.alloc(4);
    ssrc.writeUInt32BE(randomInt(0, 2 ** 32) >>> 0);
    const frameMs = (ALAC_FRAME_SAMPLES / ALAC_SAMPLE_RATE) * 1000;
    const sendStarted = Date.now();
    let seq = seq0;
    let timestamp = rtp0 >>> 0;
    for (let i = 0; i < frames.length; i += 1) {
      const packet = rtpPacket(seq, timestamp, ssrc, frames[i], i === 0);
      await new Promise<void>((resolve) => {
        audio?.send(packet, serverPort, room.ip, () => resolve());
      });
      seq = (seq + 1) & 0xffff;
      timestamp = (timestamp + ALAC_FRAME_SAMPLES) >>> 0;
      const wait = sendStarted + (i + 1) * frameMs - Date.now();
      if (wait > 1) await sleep(wait);
    }

    await rtsp
      .request("TEARDOWN", uri, { ...common, Session: session })
      .catch(() => null);
    emit(
      log(
        room,
        200,
        Date.now() - started,
        true,
        "시험음을 보냈습니다. 칠판 화면이 그대로인지, 소리가 나는지 봐 주세요",
        "idle",
      ),
    );
  } catch {
    emit(
      log(
        room,
        null,
        Date.now() - started,
        false,
        stage === "send" ? "시험음 전송이 끊겼습니다" : "칠판에 연결하지 못했습니다",
        stage === "send" ? "idle" : "offline",
      ),
    );
  } finally {
    audio?.close();
    control?.close();
    timing?.close();
    rtsp?.close();
    toneBusy = false;
  }
}
