import { SCHOOL_SSID, getLanIp, isSchoolLan, originFromRequest } from "@/lib/local-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getLanIp();
  const origin = originFromRequest(request);
  const school = isSchoolLan(ip);
  return Response.json({ ip, origin, school, ssid: school ? SCHOOL_SSID : "" });
}
