import { endSession, jsonError } from "@/lib/server/auth";

export async function POST() {
  try {
    await endSession();
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
