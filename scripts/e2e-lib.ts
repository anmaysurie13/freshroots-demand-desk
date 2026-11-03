/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers for the end-to-end scripts. Talks to a running server over HTTP.

export const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

export type Role = "raghav" | "procurement" | "priya" | "deepa" | "ceo" | "admin";

export class Session {
  cookie = "";
  constructor(public role: Role) {}

  /** Open-access demo: picks the role. There are no passwords. */
  async login() {
    const res = await fetch(`${BASE}/api/auth/role`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: this.role }) });
    if (!res.ok) throw new Error(`role selection failed for ${this.role}: ${res.status}`);
    this.cookie = (res.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
    return this;
  }

  async call(method: string, path: string, body?: unknown | FormData) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: this.cookie, ...(body && !isForm ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text };
  }
}

let passed = 0;
let failed = 0;
export function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail !== undefined ? "  -> " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
}
export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
export function section(t: string) {
  console.log(`\n${t}`);
}

export function sampleForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("sample", "true");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
