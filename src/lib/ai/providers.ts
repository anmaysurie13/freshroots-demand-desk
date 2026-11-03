import { OUTPUT_JSON_SCHEMA } from "./prompts";
import type { AiInput, AiProvider, CompletionRequest } from "./types";

/** Errors raised here never carry request headers or the API key. */
export class ProviderError extends Error {}

/**
 * OpenRouter exposes Google Gemini models behind an OpenAI-compatible endpoint.
 * The key stays on the server; it is read from the environment and never logged.
 */
export function openRouterProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "openrouter",
    model,
    async complete(req: CompletionRequest): Promise<string> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Freshroots Demand Desk",
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "flag_decision", strict: true, schema: OUTPUT_JSON_SCHEMA },
            },
            provider: { require_parameters: true },
          }),
        });
        if (!res.ok) {
          const body = (await res.text()).slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
          throw new ProviderError(`Provider returned HTTP ${res.status}: ${body}`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new ProviderError(data.error?.message ?? "Provider returned no content.");
        return content;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Error && e.name === "AbortError") throw new ProviderError(`Timed out after ${req.timeoutMs / 1000}s.`);
        throw new ProviderError("Could not reach the provider.");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Deterministic compliant answer for tests and offline demos. Never used unless AI_PROVIDER=mock. */
export function mockProvider(): AiProvider {
  return {
    name: "mock",
    model: "mock-1",
    async complete(req: CompletionRequest): Promise<string> {
      const marker = "Input:\n\n";
      const start = req.user.indexOf(marker) + marker.length;
      const end = req.user.indexOf("\n\nYour previous answer");
      const input = JSON.parse(req.user.slice(start, end === -1 ? undefined : end)) as AiInput;
      return JSON.stringify(templateAnswer(input));
    },
  };
}

export function templateAnswer(input: AiInput) {
  const m = input.metrics;
  const cover = m.cover_weeks === null ? "unbounded" : String(m.cover_weeks);
  const r = input.rule_engine;
  const festival = input.is_festival_month ? ` A festival uplift of ${m.festival_uplift}x is applied to demand.` : "";
  const text =
    r.action === "REORDER"
      ? `Cover is ${cover} weeks against a minimum of ${m.min_cover_weeks}.${festival} The decision is to reorder ${r.quantity} units.`
      : `Cover is ${cover} weeks against a maximum of ${m.max_cover_weeks}.${festival} The decision is to pause the next order.`;
  return {
    sku_id: input.sku.sku_id,
    action: r.action,
    quantity: r.quantity,
    explanation: text,
    confidence: input.needs_judgment_from_engine ? "LOW" : "HIGH",
    needs_judgment: input.needs_judgment_from_engine,
    judgment_note: input.needs_judgment_from_engine ? input.judgment_reasons.join(" ").slice(0, 200) : null,
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const which = (env.AI_PROVIDER ?? "").toLowerCase();
  if (which === "mock") return mockProvider();
  if (which === "openrouter" && env.AI_API_KEY && env.AI_MODEL) return openRouterProvider(env.AI_API_KEY, env.AI_MODEL);
  return null;
}
