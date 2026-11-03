import { jsonError, requireApi } from "@/lib/server/auth";
import { createRun } from "@/lib/server/runs";
import { readUploadForm } from "@/lib/server/upload";

/** Creates a run. Validation is repeated here; errors block, warnings need an explicit acknowledgement. */
export async function POST(req: Request) {
  try {
    const user = await requireApi(["raghav"]);
    const { files, isSample, ackWarnings } = await readUploadForm(req);
    const res = await createRun({ files, user, isSample, ackWarnings });
    if (!res.ok) {
      return Response.json(
        { error: res.needsAck ? "Tick the warnings box to continue." : "The files have errors. Nothing was saved.", errors: res.report.errors, warnings: res.report.warnings, needsAck: res.needsAck },
        { status: 422 },
      );
    }
    return Response.json({ runId: res.runId, flagged: res.flagged });
  } catch (e) {
    return jsonError(e);
  }
}
