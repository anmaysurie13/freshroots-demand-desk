import type { ReactNode } from "react";
import { Logo } from "@/components/icons";
import { LogoutButton, SideNav, TabBar, type NavItem } from "@/components/nav";
import type { Role } from "@/db/schema";
import { requirePage } from "@/lib/server/auth";
import { getKillRow } from "@/lib/server/kill";

const ALL: Role[] = ["raghav", "procurement", "priya", "deepa", "ceo", "admin"];

const ITEMS: (NavItem & { roles: Role[] })[] = [
  { href: "/review", label: "Review", icon: "review", roles: ALL },
  { href: "/run/new", label: "New run", icon: "upload", roles: ["raghav"] },
  { href: "/orders", label: "Orders", icon: "box", roles: ALL },
  { href: "/dashboard", label: "Dashboard", icon: "chart", roles: ALL },
  { href: "/kill", label: "Safety", icon: "shield", roles: ALL },
  { href: "/audit", label: "Audit", icon: "list", roles: ["deepa", "admin"] },
  { href: "/settings", label: "Settings", icon: "gear", roles: ["admin"] },
];

/** Each role's own home comes first. */
const FIRST: Record<Role, string> = {
  raghav: "/review",
  procurement: "/orders",
  priya: "/dashboard",
  deepa: "/dashboard",
  ceo: "/dashboard",
  admin: "/dashboard",
};

const ROLE_LABEL: Record<Role, string> = {
  raghav: "Senior demand planner",
  procurement: "Procurement",
  priya: "Data analyst",
  deepa: "Head of operations",
  ceo: "CEO",
  admin: "Administrator",
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePage();
  const k = await getKillRow();
  const items = ITEMS.filter((i) => i.roles.includes(user.role)).sort((a, b) => Number(b.href === FIRST[user.role]) - Number(a.href === FIRST[user.role]));
  const killed = [k.kill1State === "killed" ? "Kill 1" : null, k.kill2State === "killed" ? "Kill 2" : null].filter(Boolean) as string[];

  return (
    <div style={{ minHeight: "100dvh", display: "flex" }}>
      <aside className="sidebar" style={{ width: 232, flex: "none", padding: 16, borderRight: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 0, height: "100dvh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px" }}>
          <Logo />
          <div>
            <div style={{ fontWeight: 650, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Demand Desk</div>
            <div className="faint" style={{ fontSize: 11 }}>Freshroots planning</div>
          </div>
        </div>
        <SideNav items={items} />
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="well">
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="faint" style={{ fontSize: 12 }}>{ROLE_LABEL[user.role]}</div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* A killed state is visible at the top of every page for every role. */}
        {killed.length > 0 && (
          <div className="banner banner-clay" role="alert">
            <strong>Automation stopped ({killed.join(" and ")}).</strong>
            <span>Use the previous process. New runs and the AI step are blocked; the dashboard stays readable.</span>
          </div>
        )}
        {killed.length === 0 && k.kill2State === "alert" && (
          <div className="banner banner-amber" role="status">
            <strong>Kill 2 alert.</strong>
            <span>Quarter-to-date loss is above Rs 28 lakh. Monitor closely; Deepa reviews weekly.</span>
          </div>
        )}

        <MobileBar name={user.name} />
        <main className="main-pad" style={{ padding: "28px clamp(16px, 3vw, 40px) 48px", maxWidth: 1280, width: "100%", margin: "0 auto" }}>{children}</main>
      </div>
      <TabBar items={items} />
    </div>
  );
}

function MobileBar({ name }: { name: string }) {
  return (
    <div className="mobile-bar" style={{ alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--line-soft)", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Logo size={26} />
        <strong>Demand Desk</strong>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="faint" style={{ fontSize: 12 }}>{name}</span>
        <LogoutButton compact />
      </div>
    </div>
  );
}
