import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAiInput, decideAll, decideOne, fallbackExplanation } from "../src/lib/ai/decide";
import { mockProvider, templateAnswer } from "../src/lib/ai/providers";
import type { AiProvider } from "../src/lib/ai/types";
import { validateDecision } from "../src/lib/ai/validator";
import { rulesConfig } from "../src/lib/config";
import { runRuleEngine } from "../src/lib/engine/rules";
import { cfgWith, seedEngineInput } from "./helpers";

const engine = runRuleEngine(seedEngineInput(), rulesConfig);
const sku001 = engine.flags.find((f) => f.skuId === "SKU001")!;
const sku006 = engine.flags.find((f) => f.skuId === "SKU006")!;
const input001 = buildAiInput(sku001, "2026-10-19", true, rulesConfig);
const allNames = seedEngineInput().skus.map((s) => s.name);
const good = templateAnswer(input001);
const check = (patch: Record<string, unknown>, input = input001, cfg = rulesConfig) =>
  validateDecision(JSON.stringify({ ...good, ...patch }), input, cfg, allNames);

const scripted = (answers: Array<string | Error>): AiProvider => {
  let i = 0;
  return {
    name: "test",
    model: "test-1",
    async complete() {
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
  };
};

const fastCfg = cfgWith((c) => {
  c.ai.retryDelayMs = 0;
});
const opts = (provider: AiProvider | null, cfg = fastCfg) => ({
  provider,
  cfg,
  runDate: "2026-10-19",
  isFestival: true,
  allNames,
  deadline: Date.now() + 60_000,
});

describe("E. AI validator", () => {
  it("accepts a compliant answer", () => {
    expect(check({}).valid).toBe(true);
  });

  it("builds the input exactly as specified, with no extra personal or price fields", () => {
    expect(Object.keys(input001).sort()).toEqual(
      ["allowed_actions", "flags", "is_festival_month", "judgment_reasons", "metrics", "needs_judgment_from_engine", "quantity_limits", "rule_engine", "run_date", "sku"].sort(),
    );
    expect(input001.rule_engine).toEqual({ action: "REORDER", quantity: 750, multiplier: 1.5 });
    expect(input001.quantity_limits).toEqual({ min: 750, max: 750 });
  });

  it("rejects an action that is not allowed", () => {
    expect(check({ action: "PAUSE_ORDER", quantity: 0 }).errors.join()).toMatch(/action must be/);
  });

  it("rejects a quantity that differs from the rule quantity under policy none", () => {
    expect(check({ quantity: 700 }).errors.join()).toMatch(/quantity must be between 750 and 750/);
  });

  it("accepts a quantity inside the range under policy bounded", () => {
    const cfg = cfgWith((c) => {
      c.ai.deviationPolicy = "bounded";
      c.ai.boundedDeviationPct = 10;
    });
    const input = buildAiInput(sku001, "2026-10-19", true, cfg);
    expect(input.quantity_limits).toEqual({ min: 675, max: 825 });
    expect(check({ quantity: 700, explanation: good.explanation.replace("750", "700") }, input, cfg).valid).toBe(true);
    expect(check({ quantity: 750 }, input, cfg).valid).toBe(true);
    expect(check({ quantity: 900 }, input, cfg).valid).toBe(false);
  });

  it("rejects an invented number in the explanation", () => {
    const r = check({ explanation: "Cover is 3.35 weeks against a minimum of 6. Competitor schemes cut sales by 17 percent. Reorder 750 units." });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/not in the input: 17/);
  });

  it("allows derived percentages, festival uplift and week counts", () => {
    const r = check({
      explanation:
        "Sales in the last 4 weeks are 21% above the 12-week average and cover is 3.35 weeks against a minimum of 6. A 25% festival uplift is applied, so the decision is to reorder 750 units.",
    });
    expect(r.errors).toEqual([]);
  });

  it("rejects an explanation that mentions another SKU id or product", () => {
    expect(check({ explanation: good.explanation + " Same as SKU003 which is also low." }).errors.join()).toMatch(/another SKU/);
    expect(check({ explanation: good.explanation + " Similar to Freshroots Brown Rice 1kg stock." }).errors.join()).toMatch(/another product|not in the input/);
  });

  it("rejects needs_judgment=false when the engine set it", () => {
    const flagged = engine.flags.find((f) => f.needsJudgment) ?? { ...sku001, needsJudgment: true, judgmentReasons: [{ code: "ZERO_SALES_WEEK" as const, text: "A zero week." }] };
    const input = buildAiInput(flagged, "2026-10-19", true, rulesConfig);
    const r = validateDecision(JSON.stringify({ ...templateAnswer(input), needs_judgment: false, confidence: "HIGH" }), input, rulesConfig, allNames);
    expect(r.errors.join()).toMatch(/needs_judgment must be true/);
  });

  it("rejects LOW confidence with needs_judgment false", () => {
    expect(check({ confidence: "LOW", needs_judgment: false }).errors.join()).toMatch(/LOW confidence/);
  });

  it("rejects malformed JSON, extra keys and a wrong sku_id", () => {
    expect(validateDecision("not json", input001, rulesConfig).errors[0]).toMatch(/not valid JSON/);
    expect(check({ extra: 1 }).errors[0]).toMatch(/schema/);
    expect(check({ sku_id: "SKU999" }).errors.join()).toMatch(/sku_id must be SKU001/);
  });

  it("PAUSE_ORDER needs quantity 0 and is valid for an overstock flag", () => {
    const input = buildAiInput(sku006, "2026-10-19", true, rulesConfig);
    const ans = templateAnswer(input);
    expect(validateDecision(JSON.stringify(ans), input, rulesConfig, allNames).valid).toBe(true);
    expect(validateDecision(JSON.stringify({ ...ans, quantity: 5 }), input, rulesConfig, allNames).valid).toBe(false);
  });

  it("accepts an answer wrapped in a code fence", () => {
    expect(validateDecision("```json\n" + JSON.stringify(good) + "\n```", input001, rulesConfig, allNames).valid).toBe(true);
  });
});

describe("E. AI step with retries and fallback", () => {
  it("stores a valid response as valid, not fallback", async () => {
    const d = await decideOne(sku001, opts(mockProvider()));
    expect(d.valid).toBe(true);
    expect(d.isFallback).toBe(false);
    expect(d.action).toBe("REORDER");
    expect(d.quantity).toBe(750);
    expect(d.attempts).toBe(1);
  });

  it("retries after an invalid answer and sends the validation errors back", async () => {
    const bad = JSON.stringify({ ...good, quantity: 1 });
    let seenRetryMessage = "";
    const p: AiProvider = {
      name: "t", model: "m",
      async complete(req) {
        if (req.user.includes("previous answer was rejected")) {
          seenRetryMessage = req.user;
          return JSON.stringify(good);
        }
        return bad;
      },
    };
    const d = await decideOne(sku001, opts(p));
    expect(d.valid).toBe(true);
    expect(d.attempts).toBe(2);
    expect(seenRetryMessage).toMatch(/quantity must be between 750 and 750/);
  });

  it.each([
    ["malformed JSON", scripted(["{oops"])],
    ["API error", scripted([new Error("boom")])],
    ["invalid action", scripted([JSON.stringify({ ...good, action: "PAUSE_ORDER", quantity: 0 })])],
  ])("%s: tries 1 + 2 retries, then falls back with the rule engine's decision", async (_n, provider) => {
    const d = await decideOne(sku001, opts(provider));
    expect(d.isFallback).toBe(true);
    expect(d.valid).toBe(false);
    expect(d.attempts).toBe(3);
    expect(d.action).toBe("REORDER");
    expect(d.quantity).toBe(750);
    expect(d.explanation).toBe(fallbackExplanation(sku001));
    expect(d.invalidReasons.length).toBeGreaterThan(0);
  });

  it("falls back immediately when no provider is configured", async () => {
    const d = await decideOne(sku001, opts(null));
    expect(d.isFallback).toBe(true);
    expect(d.attempts).toBe(0);
  });

  it("uses the fallback for everything once the step budget is spent", async () => {
    const d = await decideOne(sku001, { ...opts(mockProvider()), deadline: Date.now() - 1 });
    expect(d.isFallback).toBe(true);
    expect(d.invalidReasons[0]).toMatch(/budget/);
  });

  it("fallback explanations contain only numbers from the engine", () => {
    expect(fallbackExplanation(sku001)).toBe("Recent sales are 21.4% above the 12-week average and cover is 3.35 weeks. Rule engine recommends reordering 750 units.");
    expect(fallbackExplanation(sku006)).toBe("Cover is 22.23 weeks against a maximum of 14 weeks. Rule engine recommends pausing the next order.");
  });

  it("decides every flag with a concurrency limit and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const inner = mockProvider();
    const p: AiProvider = {
      name: "m", model: "m",
      async complete(req) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return inner.complete(req);
      },
    };
    const out = await decideAll(engine.flags, opts(p));
    expect(out.map((d) => d.skuId)).toEqual(engine.flags.map((f) => f.skuId));
    expect(out.every((d) => d.valid)).toBe(true);
    expect(peak).toBeLessThanOrEqual(rulesConfig.ai.concurrency);
  });
});

describe("secrets", () => {
  it("never puts the API key in a provider error message", async () => {
    const { openRouterProvider } = await import("../src/lib/ai/providers");
    const key = "sk-or-v1-supersecretvalue";
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(`bad key ${key}`, { status: 401 })) as typeof fetch;
    try {
      await openRouterProvider(key, "x").complete({ system: "s", user: "u", timeoutMs: 1000 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(key);
      expect(String((e as Error).message)).toContain("401");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("no source file under src/ contains a key-like literal", () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(path.join(__dirname, "..", "src")).filter((f) => /sk-or-v1-[a-f0-9]{20,}|napi_[a-z0-9]{20,}|npg_[A-Za-z0-9]{8,}/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
