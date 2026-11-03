"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IconBox, IconChart, IconGear, IconList, IconLogout, IconReview, IconShield, IconUpload } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: "review" | "upload" | "box" | "chart" | "shield" | "list" | "gear";
}

const ICONS: Record<NavItem["icon"], ReactNode> = {
  review: <IconReview />,
  upload: <IconUpload />,
  box: <IconBox />,
  chart: <IconChart />,
  shield: <IconShield />,
  list: <IconList />,
  gear: <IconGear />,
};

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="nav-link" aria-current={path.startsWith(i.href) ? "page" : undefined}>
          {ICONS[i.icon]}
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {items.slice(0, 5).map((i) => (
        <Link key={i.href} href={i.href} aria-current={path.startsWith(i.href) ? "page" : undefined}>
          {ICONS[i.icon]}
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      style={{ width: compact ? "auto" : "100%", justifyContent: compact ? "center" : "flex-start" }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <IconLogout />
      {compact ? <span className="sr-only">Switch role</span> : "Switch role"}
    </button>
  );
}
