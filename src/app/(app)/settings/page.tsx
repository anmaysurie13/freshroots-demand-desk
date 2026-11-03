import { PageHead, Pill } from "@/components/ui";
import { rulesConfig } from "@/lib/config";
import { fmtDate } from "@/lib/format";
import { requirePage } from "@/lib/server/auth";
import { getUsersList } from "@/lib/server/queries";
import { UsersClient } from "./UsersClient";

export const metadata = { title: "Settings · Demand Desk" };

export default async function SettingsPage() {
  const me = await requirePage(["admin"]);
  const users = await getUsersList();
  const payload = JSON.parse(JSON.stringify(users));

  return (
    <>
      <PageHead title="Settings" sub="Accounts and the active rules. Rules are read-only here: they change only through a code change and a new version." />
      <UsersClient users={payload} meId={me.id} />
      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div className="card-title">Active rules</div>
          <Pill tone="teal">version {rulesConfig.version}</Pill>
        </div>
        <pre className="num" style={{ margin: 0, padding: 18, overflowX: "auto", fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>{JSON.stringify(rulesConfig, null, 2)}</pre>
      </section>
      <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>Page rendered {fmtDate(new Date())}.</p>
    </>
  );
}
