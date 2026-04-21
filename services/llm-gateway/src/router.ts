/**
 * LLM router — per-agent model selection, retries, circuit breaker,
 * token-bucket rate limit, schema validation + repair, fallback cascade,
 * and cost tracking.
 */

import { type AgentId, getTeamModel, getFallbackModels } from "./team-model.js";
import * as cb from "./circuit-breaker.js";
import { recordUsage, BudgetExceededError, type TokenUsage } from "./cost-tracker.js";
import { buildSystemPrompt, buildRepairPrompt, type CallContext } from "./prompt-builder.js";
import { validateAgentOutput } from "./validator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterCallRequest {
  auctionId: string;
  agentId: AgentId;
  context: CallContext;
}

export interface RouterCallResponse {
  agentOutput: unknown;
  model: string;
  wasFallback: boolean;
  tokenUsage: TokenUsage;
}

export class AgentTimeoutError extends Error {
  constructor(public readonly agentId: AgentId, reason: string) {
    super(`agent.timeout for ${agentId}: ${reason}`);
    this.name = "AgentTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Token-bucket rate limiter (per model, in-process)
// ---------------------------------------------------------------------------

const MAX_RPS = parseInt(process.env["LLM_RATE_LIMIT_RPS"] ?? "5", 10);
const _buckets = new Map<string, { tokens: number; lastRefill: number }>();

function _consumeToken(model: string): boolean {
  const now = Date.now();
  let bucket = _buckets.get(model);
  if (!bucket) {
    bucket = { tokens: MAX_RPS, lastRefill: now };
    _buckets.set(model, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(MAX_RPS, bucket.tokens + elapsed * MAX_RPS);
  bucket.lastRefill = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// OpenRouter HTTP call
// ---------------------------------------------------------------------------

const OPENROUTER_BASE = process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const CALL_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function _callLlm(
  model: string,
  messages: LlmMessage[],
): Promise<{ text: string; usage: TokenUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, CALL_TIMEOUT_MS);

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential jitter: 500ms * 2^(attempt-1) ± 20%
      const base = 500 * Math.pow(2, attempt - 1);
      const jitter = base * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, jitter));
    }

    try {
      const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://ipl-auction.internal",
        },
        body: JSON.stringify({ model, messages, max_tokens: 512 }),
        signal: controller.signal,
      });

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "1", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${String(resp.status)}: ${await resp.text()}`);
      }

      const json = (await resp.json()) as LlmResponse;
      const text = json.choices[0]?.message.content ?? "";
      const usage: TokenUsage = {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      };
      clearTimeout(timer);
      return { text, usage };
    } catch (err) {
      lastError = err;
      if ((err as Error).name === "AbortError") break; // timeout — no more retries
    }
  }

  clearTimeout(timer);
  throw lastError instanceof Error ? lastError : new Error("LLM call failed after retries");
}

// ---------------------------------------------------------------------------
// Public router entry point
// ---------------------------------------------------------------------------

export async function routeCall(req: RouterCallRequest): Promise<RouterCallResponse> {
  const primary = getTeamModel(req.agentId);
  const fallbacks = getFallbackModels(primary);
  const candidates = [primary, ...fallbacks];

  let wasFallback = false;

  for (const candidate of candidates) {
    const { model } = candidate;

    if (cb.isOpen(model)) continue; // skip tripped breakers

    if (!_consumeToken(model)) {
      // Rate limited — try next candidate
      continue;
    }

    if (wasFallback) {
      console.warn(
        `[llm-gateway] Fallback activated for agent=${req.agentId} → model=${model}`,
      );
    }

    const systemPrompt = buildSystemPrompt(req.context);

    try {
      // First attempt
      const { text, usage } = await _callLlm(model, [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Provide your bid decision as a JSON object." },
      ]);

      let outcome = validateAgentOutput(text);

      // Single repair attempt on schema failure
      if (!outcome.valid) {
        const repairPrompt = buildRepairPrompt(text, outcome.errors);
        const repaired = await _callLlm(model, [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Provide your bid decision as a JSON object." },
          { role: "assistant", content: text },
          { role: "user", content: repairPrompt },
        ]);
        usage.promptTokens += repaired.usage.promptTokens;
        usage.completionTokens += repaired.usage.completionTokens;
        outcome = validateAgentOutput(repaired.text);
      }

      if (!outcome.valid) {
        cb.recordFailure(model);
        throw new AgentTimeoutError(
          req.agentId,
          `Schema validation failed after repair: ${outcome.errors.join("; ")}`,
        );
      }

      // Success path
      recordUsage(req.auctionId, model, usage);
      cb.recordSuccess(model);

      return {
        agentOutput: outcome.data,
        model,
        wasFallback,
        tokenUsage: usage,
      };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err; // propagate immediately
      if (err instanceof AgentTimeoutError) throw err;

      cb.recordFailure(model);
      wasFallback = true;
      // Continue to next candidate
    }
  }

  // All candidates failed
  throw new AgentTimeoutError(
    req.agentId,
    "All model candidates exhausted (circuit open or rate-limited)",
  );
}
