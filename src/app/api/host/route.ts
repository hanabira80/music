import { getLanIp, originFromRequest } from "@/lib/local-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = originFromRequest(request);
  return Response.json({ ip: getLanIp(), origin });
}
