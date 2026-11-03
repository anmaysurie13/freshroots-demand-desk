import { PageHead, Empty } from "@/components/ui";
import { requirePage } from "@/lib/server/auth";
import { automationStopped } from "@/lib/server/kill";
import { getReviewRun } from "@/lib/server/queries";
import Link from "next/link";
import { ReviewClient } from "./ReviewClient";

export const metadata = { title: "Review · Demand Desk" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const user = await requirePage();
  const { run: runParam } = await searchParams;
  const runId = runParam && Number.isInteger(Number(runParam)) ? Number(runParam) : undefined;
  const data = await getReviewRun(runId);
  const stop = await automationStopped();

  if (!data) {
    return (
      <>
        <PageHead title="Review" />
        <Empty title="No run yet.">
          {user.role === "raghav" ? (
            <>
              Upload this week&apos;s SAP files on <Link href="/run/new">New run</Link>.
            </>
          ) : (
            "Raghav starts a run when new SAP files are ready."
          )}
        </Empty>
      </>
    );
  }

  // Dates cross the server/client boundary as strings.
  const payload = JSON.parse(JSON.stringify({ ...data, run: { ...data.run, rulesJson: undefined } }));
  return <ReviewClient data={payload} role={user.role} killed={stop.stopped} />;
}
