import { jsonError, requireApi } from "@/lib/server/auth";
import { exportOrdersCsv } from "@/lib/server/orders";

export async function GET() {
  try {
    const user = await requireApi(["procurement", "admin"]);
    const csv = await exportOrdersCsv(user);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="buying-decisions.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
