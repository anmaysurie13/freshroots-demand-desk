// Fails when a tracked file contains something that looks like a real secret. Run in CI and before commits.
import { execSync } from "node:child_process";
import fs from "node:fs";

const PATTERNS = [
  [/sk-or-v1-[a-f0-9]{20,}/, "OpenRouter key"],
  [/napi_[a-z0-9]{20,}/, "Neon API key"],
  [/npg_[A-Za-z0-9]{8,}/, "Neon database password"],
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{6,}@/, "Postgres URL with a password"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/vcp_[A-Za-z0-9]{20,}/, "Vercel token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
];

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.endsWith("package-lock.json") && fs.existsSync(f));

let bad = 0;
for (const f of files) {
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`SECRET? ${label} in ${f}`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`\n${bad} possible secret(s) found.`);
  process.exit(1);
}
console.log(`Secret scan clean (${files.length} files).`);
