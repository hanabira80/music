import { AIRPLAY_PORT, CAST_PORT, DEFAULT_CLASSROOMS } from "@/config/classrooms";
import { airplayControl } from "@/lib/airplay-controller";
import { getAudio, registerUrl } from "@/lib/audio-library";
import type { AudioSource, BroadcastAction } from "@/lib/broadcast-types";
import { castControl } from "@/lib/cast-controller";
import { controlDevice } from "@/lib/dlna-controller";
import { originFromRequest } from "@/lib/local-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: BroadcastAction;
  classroomIds?: string[];
  volume?: number;
  source?: AudioSource;
};

function assertStreamUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("소리 주소 형식이 아닙니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http 소리 주소만 사용할 수 있습니다.");
  }
  if (url.hostname === "169.254.169.254") {
    throw new Error("이 주소는 사용할 수 없습니다.");
  }
  return url.toString();
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const action = body.action;
  if (action !== "play" && action !== "pause" && action !== "stop" && action !== "volume") {
    return Response.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
  }

  const rooms = DEFAULT_CLASSROOMS.filter((room) => body.classroomIds?.includes(room.id));
  if (rooms.length === 0) {
    return Response.json({ error: "보낼 반을 골라 주세요." }, { status: 400 });
  }

  let mediaUrl: string | undefined;
  let mime = "audio/mpeg";
  let title = "Classroom BGM";

  if (action === "play") {
    try {
      if (!body.source) {
        return Response.json({ error: "음원을 먼저 골라 주세요." }, { status: 400 });
      }
      if (body.source.kind === "file") {
        const record = await getAudio(body.source.id);
        if (!record) return Response.json({ error: "올린 음원을 찾지 못했습니다." }, { status: 404 });
        mime = record.mime;
        title = record.name;
        mediaUrl = `${originFromRequest(request)}/api/stream/${record.id}`;
      } else {
        const remote = assertStreamUrl(body.source.url);
        const record = await registerUrl(remote);
        title = "Stream";
        mediaUrl = `${originFromRequest(request)}/api/stream/${record.id}`;
      }
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "음원을 준비하지 못했습니다." },
        { status: 400 },
      );
    }
  }

  const volume = typeof body.volume === "number" ? body.volume : 70;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (entry: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(entry)}\n`));
      };
      await Promise.all(
        rooms.map(async (room) => {
          try {
            const entries =
              room.port === AIRPLAY_PORT
                ? await airplayControl(room, action, { mediaUrl, volume })
                : room.port === CAST_PORT
                  ? await castControl(room, action, { mediaUrl, mime, volume })
                  : await controlDevice(room, action, { mediaUrl, mime, title, volume });
            for (const entry of entries) send(entry);
          } catch (error) {
            send({
              id: `${room.id}-error`,
              at: new Date().toISOString(),
              classroomId: room.id,
              name: room.name,
              ip: room.ip,
              action,
              status: null,
              latencyMs: 0,
              ok: false,
              message: error instanceof Error ? error.message : "전송에 실패했습니다",
              deviceStatus: "offline",
            });
          }
        }),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
