import { redirect } from "next/navigation";
import { Logo } from "@/components/icons";
import { HOME_BY_ROLE, getUser } from "@/lib/server/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Demand Desk" };

export default async function LoginPage() {
  const user = await getUser();
  if (user) redirect(HOME_BY_ROLE[user.role]);

  return (
    <div style={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)" }} className="login-grid">
      <section style={{ padding: "clamp(24px, 5vw, 64px)", display: "flex", flexDirection: "column", justifyContent: "space-between", borderRight: "1px solid var(--line-soft)", background: "linear-gradient(160deg, rgba(45,212,191,0.07), transparent 55%)" }} className="login-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={34} />
          <strong style={{ fontSize: 18, letterSpacing: "-0.01em" }}>Demand Desk</strong>
        </div>
        <div style={{ maxWidth: 520 }}>
          <p className="eyebrow" style={{ color: "var(--teal)" }}>Freshroots · Maharashtra and Goa</p>
          <h1 style={{ fontSize: "clamp(32px, 4.4vw, 52px)", lineHeight: 1.04, letterSpacing: "-0.03em", fontWeight: 650, margin: "14px 0 18px" }}>
            Twice a week, not once a month.
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.6 }}>
            Rules raise the flags. AI explains them. A planner decides every one before anything reaches buying.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", display: "grid", gap: 12 }}>
            {["Every threshold lives in one config file", "No decision is auto-approved, ever", "Two kill switches stop the automation on their own"].map((t) => (
              <li key={t} style={{ display: "flex", gap: 12, alignItems: "center", color: "var(--text)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--teal)", flex: "none" }} />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="faint" style={{ fontSize: 12 }}>Stockout and overstock loss baseline: Rs 28 to 34 lakh per quarter.</p>
      </section>

      <section style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 4px", letterSpacing: "-0.02em" }}>Sign in</h2>
          <p className="muted" style={{ margin: "0 0 22px" }}>Use the account issued for your role.</p>
          <LoginForm />
        </div>
      </section>

      <style>{`@media (max-width: 860px){ .login-grid{grid-template-columns:1fr !important} .login-brand{display:none !important} }`}</style>
    </div>
  );
}
