// One real model call on a single seed flag, through the same decide + validate path the app uses.
// Usage: npx tsx scripts/ai-smoke.ts   (reads .env.local; prints no secrets)
import dotenv from "dotenv";
import { decideOne } from "../src/lib/ai/decide";
import { providerFromEnv } from "../src/lib/ai/providers";
import { rulesConfig } from "../src/lib/config";
import { runRuleEngine } from "../src/lib/engine/rules";
import { seedEngineInput } from "../tests/helpers";

dotenv.config({ path: ".env.local", quiet: true });

async function main() {
  const provider = providerFromEnv();
  if (!provider) throw new Error("AI provider is not configured in .env.local");
  console.log(`provider=${provider.name} model=${provider.model}`);
  const input = seedEngineInput();
  const engine = runRuleEngine(input, rulesConfig);
  const flag = engine.flags.find((f) => f.skuId === "SKU001")!;
  const d = await decideOne(flag, {
    provider,
    cfg: rulesConfig,
    runDate: input.asOfDate,
    isFestival: input.isFestival,
    allNames: input.skus.map((s) => s.name),
    deadline: Date.now() + 120_000,
    onLog: (l) => console.log("  retry:", l),
  });
  console.log(JSON.stringify({ valid: d.valid, isFallback: d.isFallback, attempts: d.attempts, action: d.action, quantity: d.quantity, confidence: d.confidence, needsJudgment: d.needsJudgment, latencyMs: d.latencyMs, explanation: d.explanation, invalidReasons: d.invalidReasons }, null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
