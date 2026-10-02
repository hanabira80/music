import { mimeForUpload, saveUpload } from "@/lib/audio-library";

export const runtime = "nodejs";

const maxBytes = 100 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "음원 파일을 넣어 주세요." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > maxBytes) {
    return Response.json({ error: "100MB 이하 파일만 올릴 수 있습니다." }, { status: 400 });
  }

  const mime = mimeForUpload(file.name, file.type);
  if (!mime) {
    return Response.json({ error: "MP3 또는 WAV만 올릴 수 있습니다." }, { status: 400 });
  }

  const record = await saveUpload(file.name, mime, file.stream());
  return Response.json({ id: record.id, name: record.name, mime: record.mime });
}
