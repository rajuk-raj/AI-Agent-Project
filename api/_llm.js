/**
 * LLM service layer — the single place any model is called.
 *
 * Every tool goes through callLLM(). Provider specifics live here and nowhere
 * else, so switching providers (or models per tool) is a change to this file
 * plus env vars — not a change to any tool. Provider: OpenAI.
 *
 * Runs server-side only. OPENAI_API_KEY must never be imported into client code.
 */

const API_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_MODEL = 'gpt-4o-mini';
const MODEL_ENV = {
  decompose: 'LLM_MODEL_DECOMPOSE',
  competency: 'LLM_MODEL_COMPETENCY',
  rewrite: 'LLM_MODEL_REWRITE',
  score: 'LLM_MODEL_SCORE',
  questions: 'LLM_MODEL_QUESTIONS',
};

export class LLMError extends Error {
  constructor(message, { retryable = false, status = null, cause = null } = {}) {
    super(message);
    this.name = 'LLMError';
    this.retryable = retryable;
    this.status = status;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimum spacing between outbound requests, derived from LLM_MAX_RPM.
 *
 * Caveat: this is per warm serverless instance, so it is a safety net, not a
 * guarantee. The real serialization comes from the client orchestrator, which
 * drives pipeline steps one at a time. New OpenAI accounts start on a low usage
 * tier, so leave this conservative until you have measured headroom.
 */
let lastRequestAt = 0;
async function paceRequests() {
  const rpm = Number(process.env.LLM_MAX_RPM || 0);
  if (!rpm || rpm <= 0) return;
  const minGapMs = 60_000 / rpm;
  const waitMs = lastRequestAt + minGapMs - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

function resolveModel(tool) {
  const envKey = MODEL_ENV[tool];
  return (envKey && process.env[envKey]) || DEFAULT_MODEL;
}

function retryDelayMs(res, attempt) {
  const header = Number(res?.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;

  // OpenAI also exposes reset hints on rate-limited responses.
  const reset = res?.headers?.get?.('x-ratelimit-reset-requests');
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(reset || '');
  if (m) {
    const v = parseFloat(m[1]);
    return Math.ceil(m[2] === 'ms' ? v : v * 1000);
  }

  // Exponential backoff with jitter: ~2s, 4s, 8s, 16s (capped 30s)
  return Math.min(2000 * 2 ** attempt, 30_000) + Math.random() * 500;
}

/**
 * Call the model and return parsed JSON matching `schema`.
 *
 * IMPORTANT — strict schema rules. OpenAI's structured outputs constrain the
 * decoder, which is why the result is reliable, but the schema must satisfy:
 *   - every object sets `additionalProperties: false`
 *   - every property is listed in `required` (use a nullable type for optional
 *     fields rather than omitting them from `required`)
 * A schema that violates these is rejected at request time, not at parse time.
 *
 * @param {object}  opts
 * @param {string}  opts.tool     One of MODEL_ENV keys — selects the model.
 * @param {string}  opts.system   System instruction.
 * @param {string}  opts.prompt   User content.
 * @param {object}  opts.schema   JSON Schema (see strict rules above).
 * @param {string} [opts.schemaName='result']
 * @param {number} [opts.maxOutputTokens=8000]
 *   NOTE on reasoning models (gpt-5 family): internal reasoning tokens are
 *   billed as output AND count against this limit. Measured baseline — a
 *   trivial two-field extraction burned 320 reasoning tokens for 23 tokens of
 *   content. Budget generously; too low and the model spends the entire
 *   allowance reasoning and returns empty content (we throw a clear error for
 *   that case rather than letting it look like a parse failure).
 * @returns {Promise<{data:object, usage:object, model:string}>}
 */
export async function callLLM({
  tool,
  system,
  prompt,
  schema,
  schemaName = 'result',
  maxOutputTokens = 8000,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError('OPENAI_API_KEY is not set. Copy .env.example to .env.local and add your key.');
  }
  if (!schema) {
    throw new LLMError(`callLLM({tool: "${tool}"}) requires a schema — every tool uses structured output.`);
  }

  const model = resolveModel(tool);
  const maxRetries = Number(process.env.LLM_MAX_RETRIES || 4);

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    },
    max_completion_tokens: maxOutputTokens,
    // Deterministic by default. Variety, where we want it (rewrite retries),
    // comes from changing the prompt, not from sampling temperature — that
    // keeps reruns explainable. Reasoning models reject this param; drop it
    // via LLM_OMIT_TEMPERATURE if you switch to one.
    ...(process.env.LLM_OMIT_TEMPERATURE === 'true' ? {} : { temperature: 0 }),
  };

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();

    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      lastErr = new LLMError(`Network error calling ${model}`, { retryable: true, cause });
      await sleep(retryDelayMs(null, attempt));
      continue;
    }

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { _raw: text };
    }

    if (res.ok) return extractResult(parsed, model);

    // 429 = rate limited or out of quota. 5xx = transient.
    const retryable = res.status === 429 || res.status >= 500;
    const apiMsg = parsed?.error?.message || `HTTP ${res.status}`;

    // Out-of-credit surfaces as 429 but retrying will never help — say so plainly.
    if (parsed?.error?.code === 'insufficient_quota') {
      throw new LLMError(
        `${model}: account has no available credit. The OpenAI API bills separately from ChatGPT Plus — add credit at platform.openai.com/billing.`,
        { retryable: false, status: res.status }
      );
    }

    lastErr = new LLMError(`${model}: ${apiMsg}`, { retryable, status: res.status });
    if (!retryable || attempt === maxRetries) throw lastErr;
    await sleep(retryDelayMs(res, attempt));
  }

  throw lastErr;
}

function extractResult(payload, model) {
  const choice = payload?.choices?.[0];
  if (!choice) throw new LLMError('Model returned no choices.', { retryable: true });

  // Structured outputs can return an explicit refusal instead of content.
  if (choice.message?.refusal) {
    throw new LLMError(`Model refused the request: ${choice.message.refusal}`, { retryable: false });
  }
  if (choice.finish_reason === 'length') {
    // Truncated JSON is unparseable, so fail loudly rather than half-parsing.
    throw new LLMError(
      'Response hit the output token limit and was truncated. Raise maxOutputTokens for this tool.',
      { retryable: false }
    );
  }
  if (choice.finish_reason === 'content_filter') {
    throw new LLMError('Response blocked by content filter.', { retryable: false });
  }

  const raw = choice.message?.content ?? '';
  let data;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new LLMError('Model returned malformed JSON despite a strict response schema.', {
      retryable: true,
      cause,
    });
  }

  const u = payload?.usage || {};
  return {
    data,
    model,
    usage: {
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      // Populated when using a reasoning model; 0 otherwise.
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

/** Uniform handler wrapper so every /api route reports errors the same way. */
export function handler(fn) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      const result = await fn(req.body ?? {});
      return res.status(200).json(result);
    } catch (err) {
      const status = err instanceof LLMError && err.status === 429 ? 429 : 500;
      console.error(`[${fn.name || 'handler'}]`, err);
      return res.status(status).json({
        error: err.message,
        retryable: Boolean(err.retryable),
      });
    }
  };
}
