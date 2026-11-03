"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Pill } from "@/components/ui";

interface U {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

const ROLES = ["raghav", "procurement", "priya", "deepa", "ceo", "admin"];

export function UsersClient({ users, meId }: { users: U[]; meId: number }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", role: "procurement" });
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy("new");
    setMsg(null);
    try {
      const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not create the account.");
      setMsg({ kind: "ok", text: "Account created. The role picker uses the first active account of each role." });
      setForm({ name: "", email: "", role: "procurement" });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Failed." });
    }
    setBusy(null);
  }

  async function toggle(u: U) {
    setBusy(u.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !u.active }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not update.");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Failed." });
    }
    setBusy(null);
  }

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }} className="users-grid">
      <section className="card">
        <div className="card-head"><div className="card-title">Accounts</div></div>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div style={{ fontWeight: 600 }}>{u.name}</div><div className="faint num" style={{ fontSize: 12 }}>{u.email}</div></td>
                  <td className="num">{u.role}</td>
                  <td><Pill tone={u.active ? "lime" : "slate"}>{u.active ? "active" : "inactive"}</Pill></td>
                  <td>
                    <button className="btn btn-sm btn-ghost" disabled={busy === u.id || u.id === meId} onClick={() => toggle(u)}>
                      {u.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div className="card-title">Add an account</div></div>
        <form className="card-body" onSubmit={create} style={{ display: "grid", gap: 12 }}>
          <div className="field"><label className="label" htmlFor="un">Name</label><input id="un" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="ue">Email</label><input id="ue" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field">
            <label className="label" htmlFor="ur">Role</label>
            <select id="ur" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {msg && <div className={`note ${msg.kind === "ok" ? "note-lime" : "note-clay"}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy === "new"}>{busy === "new" ? "Creating..." : "Create account"}</button>
        </form>
      </section>
      <style>{`@media (max-width: 960px){ .users-grid{grid-template-columns:1fr !important} }`}</style>
    </div>
  );
}
