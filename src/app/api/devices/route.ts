import { AIRPLAY_PORT, CAST_PORT, DEFAULT_CLASSROOMS } from "@/config/classrooms";
import { probeAirPlay } from "@/lib/airplay-controller";
import { probeCast } from "@/lib/cast-controller";
import { probeDevice } from "@/lib/dlna-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const devices = await Promise.all(
    DEFAULT_CLASSROOMS.map(async (room) => {
      const entry =
        room.port === AIRPLAY_PORT
          ? await probeAirPlay(room)
          : room.port === CAST_PORT
            ? await probeCast(room)
            : await probeDevice(room);
      return {
        id: room.id,
        status: entry.deviceStatus ?? "offline",
        log: entry,
      };
    }),
  );
  return Response.json({ devices });
}
