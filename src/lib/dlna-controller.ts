import { randomUUID } from "node:crypto";
import type { Classroom } from "@/config/classrooms";
import type { DeviceStatus, TransmissionLog } from "@/lib/broadcast-types";

const AV_SERVICE = "urn:schemas-upnp-org:service:AVTransport:1";
const RC_SERVICE = "urn:schemas-upnp-org:service:RenderingControl:1";

type Endpoint = { av: string; rc: string };

const endpointCache = new Map<string, Endpoint>();

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildAudioDidl(title: string, mediaUrl: string, mime: string) {
  return [
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`,
    `<item id="bgm" parentID="0" restricted="1">`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
    `<res protocolInfo="http-get:*:${escapeXml(mime)}:*">${escapeXml(mediaUrl)}</res>`,
    `</item>`,
    `</DIDL-Lite>`,
  ].join("");
}

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

async function readWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, status: null as number | null, text: "", latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function controlUrlFor(xml: string, marker: string) {
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) ?? [];
  for (const block of services) {
    if (!block.includes(marker)) continue;
    const found = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
    if (found) return found[1].trim();
  }
  return null;
}

function resolveControl(base: string, control: string) {
  if (control.startsWith("http://") || control.startsWith("https://")) return control;
  return new URL(control, `${base}/`).toString();
}

async function discover(room: Classroom): Promise<Endpoint> {
  const key = `${room.ip}:${room.port}`;
  const cached = endpointCache.get(key);
  if (cached) return cached;

  const base = `http://${room.ip}:${room.port}`;
  const fallback: Endpoint = {
    av: `${base}/MediaRenderer/AVTransport/Control`,
    rc: `${base}/MediaRenderer/RenderingControl/Control`,
  };

  const description =
    (await readWithTimeout(`${base}/xml/device_description.xml`, 800)) ??
    null;
  const xml = description?.ok
    ? description.text
    : (await readWithTimeout(`${base}/description.xml`, 800)).text;

  if (!xml.includes("AVTransport")) return fallback;

  const av = controlUrlFor(xml, "AVTransport");
  const rc = controlUrlFor(xml, "RenderingControl");
  const endpoint: Endpoint = {
    av: av ? resolveControl(base, av) : fallback.av,
    rc: rc ? resolveControl(base, rc) : fallback.rc,
  };
  endpointCache.set(key, endpoint);
  return endpoint;
}

async function soap(
  controlUrl: string,
  service: string,
  action: string,
  inner: string,
  timeoutMs: number,
) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${service}">
      ${inner}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${service}#${action}"`,
      },
      body: envelope,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.text();
    const fault = body.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1];
    const ok = response.ok && !fault;
    return {
      ok,
      status: response.status,
      latencyMs: Date.now() - started,
      message: fault?.trim() || `${action} ${response.status}`,
      body,
    };
  } catch {
    return {
      ok: false,
      status: null as number | null,
      latencyMs: Date.now() - started,
      message: "칠판에 연결하지 못했습니다",
      body: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

function transportState(xml: string): DeviceStatus {
  const state = xml.match(/<CurrentTransportState>([^<]+)<\/CurrentTransportState>/i)?.[1] ?? "";
  if (state.includes("PLAYING") || state.includes("TRANSITIONING")) return "streaming";
  return "idle";
}

export async function probeDevice(room: Classroom): Promise<TransmissionLog> {
  try {
    const endpoint = await discover(room);
    const result = await soap(
      endpoint.av,
      AV_SERVICE,
      "GetTransportInfo",
      "<InstanceID>0</InstanceID>",
      900,
    );
    if (!result.ok || result.status === null) {
      return log(
        room,
        "GetTransportInfo",
        result.status,
        result.latencyMs,
        false,
        result.message,
        result.status === null ? "offline" : "idle",
      );
    }
    return log(
      room,
      "GetTransportInfo",
      result.status,
      result.latencyMs,
      true,
      result.message,
      transportState(result.body),
    );
  } catch {
    return log(room, "GetTransportInfo", null, 0, false, "칠판에 연결하지 못했습니다", "offline");
  }
}

async function setVolume(room: Classroom, endpoint: Endpoint, volume: number) {
  const level = Math.max(0, Math.min(100, Math.round(volume)));
  const result = await soap(
    endpoint.rc,
    RC_SERVICE,
    "SetVolume",
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${level}</DesiredVolume>`,
    2000,
  );
  return log(
    room,
    "SetVolume",
    result.status,
    result.latencyMs,
    result.ok,
    result.message,
    result.status === null ? "offline" : undefined,
  );
}

export async function controlDevice(
  room: Classroom,
  action: "play" | "pause" | "stop" | "volume",
  options: { mediaUrl?: string; mime?: string; title?: string; volume?: number },
): Promise<TransmissionLog[]> {
  const endpoint = await discover(room);
  const logs: TransmissionLog[] = [];

  if (action === "volume") {
    logs.push(await setVolume(room, endpoint, options.volume ?? 70));
    return logs;
  }

  if (action === "pause" || action === "stop") {
    const soapAction = action === "pause" ? "Pause" : "Stop";
    const result = await soap(
      endpoint.av,
      AV_SERVICE,
      soapAction,
      "<InstanceID>0</InstanceID>",
      2000,
    );
    logs.push(
      log(
        room,
        soapAction,
        result.status,
        result.latencyMs,
        result.ok,
        result.message,
        result.status === null ? "offline" : "idle",
      ),
    );
    return logs;
  }

  const mediaUrl = options.mediaUrl;
  if (!mediaUrl) {
    logs.push(log(room, "SetAVTransportURI", null, 0, false, "보낼 음원이 없습니다", "idle"));
    return logs;
  }

  const mime = options.mime === "audio/wav" ? "audio/wav" : "audio/mpeg";
  const didl = buildAudioDidl(options.title || "Classroom BGM", mediaUrl, mime);
  const setUri = await soap(
    endpoint.av,
    AV_SERVICE,
    "SetAVTransportURI",
    `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(mediaUrl)}</CurrentURI><CurrentURIMetaData>${escapeXml(didl)}</CurrentURIMetaData>`,
    2500,
  );
  logs.push(
    log(
      room,
      "SetAVTransportURI",
      setUri.status,
      setUri.latencyMs,
      setUri.ok,
      setUri.message,
      setUri.ok ? undefined : setUri.status === null ? "offline" : "idle",
    ),
  );
  if (!setUri.ok) return logs;

  const play = await soap(
    endpoint.av,
    AV_SERVICE,
    "Play",
    "<InstanceID>0</InstanceID><Speed>1</Speed>",
    2500,
  );
  logs.push(
    log(
      room,
      "Play",
      play.status,
      play.latencyMs,
      play.ok,
      play.message,
      play.ok ? "streaming" : play.status === null ? "offline" : "idle",
    ),
  );
  if (!play.ok) return logs;

  logs.push(await setVolume(room, endpoint, options.volume ?? 70));
  return logs;
}
