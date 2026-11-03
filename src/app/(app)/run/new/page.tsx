import { desc } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { PageHead, Pill } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { requirePage } from "@/lib/server/auth";
import { automationStopped } from "@/lib/server/kill";
import { NewRunClient } from "./NewRunClient";

export const metadata = { title: "New run · Demand Desk" };

export default async function NewRunPage() {
  await requirePage(["raghav"]);
  const stop = await automationStopped();
  const recent = await getDb().select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(5);
  const hasPrevious = recent.length > 0;

  return (
    <>
      <PageHead
        title="New run"
        sub="Export the five files from SAP and upload them. Errors block the run; warnings need a tick. Nothing is repaired silently."
      />
      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <NewRunClient killed={stop.stopped} hasPrevious={hasPrevious} />
        {recent.length > 0 && (
          <section className="card">
            <div className="card-head">
              <div className="card-title">Recent runs</div>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Created</th>
                    <th>Data as of</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td className="num">#{r.id}</td>
                      <td>{fmtDateTime(r.createdAt)}</td>
                      <td className="num">{r.asOfDate}</td>
                      <td>
                        <Pill tone={r.status === "completed" ? "lime" : r.status === "blocked" ? "clay" : "amber"}>{r.status.replace("_", " ")}</Pill>
                      </td>
                      <td>
                        <Link href={`/review?run=${r.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
