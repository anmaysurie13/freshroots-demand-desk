import { jsonError, requireApi } from "@/lib/server/auth";
import { automationStopped } from "@/lib/server/kill";
import { STOP_MESSAGE, validateUpload } from "@/lib/server/runs";
import { readUploadForm } from "@/lib/server/upload";

/** Validate only. Nothing is written. */
export async function POST(req: Request) {
  try {
    await requireApi(["raghav"]);
    const { files, isSample } = await readUploadForm(req);
    const stop = await automationStopped();
    const report = validateUpload(files, isSample);
    return Response.json({
      blocked: stop.stopped,
      blockedReason: stop.stopped ? STOP_MESSAGE : null,
      errors: report.errors,
      warnings: report.warnings,
      rowCounts: report.rowCounts,
      asOfDate: report.asOfDate,
      lastCompleteWeek: report.lastCompleteWeek,
    });
  } catch (e) {
    return jsonError(e);
  }
}
