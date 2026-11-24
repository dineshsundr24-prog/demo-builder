// LLM provider adapter. Only this file knows about a vendor API (Decision D2).
export type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number };
export type CompletionRequest = { purpose: 'plan' | 'screen' | 'repair'; instructions: string; input: string; schemaName: string; schema: object; maxOutputTokens: number };
export type CompletionResult = { json: unknown; usage: Usage; model: string; latencyMs: number; requestId?: string };
export type ErrorCategory = 'rate_limit' | 'auth' | 'bad_request' | 'truncated' | 'refusal' | 'timeout' | 'server' | 'parse' | 'network' | 'budget';
export class ProviderError extends Error {
  category: ErrorCategory; retryable: boolean; usage?: Usage;
  constructor(category: ErrorCategory, message: string, retryable: boolean, usage?: Usage) { super(message); this.category = category; this.retryable = retryable; this.usage = usage; }
}
export interface LlmProvider { readonly model: string; complete(req: CompletionRequest): Promise<CompletionResult>; }

/** Prices in USD per 1M tokens. Defaults are list prices to verify; override with MODEL_PRICES_JSON. */
const DEFAULT_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
  'gpt-4.1': { input: 2.00, cached: 0.50, output: 8.00 },
  'gpt-4.1-nano': { input: 0.10, cached: 0.025, output: 0.40 },
};
export function priceFor(model: string) {
  let table = DEFAULT_PRICES;
  try { if (process.env.MODEL_PRICES_JSON) table = { ...table, ...JSON.parse(process.env.MODEL_PRICES_JSON) }; } catch { /* keep defaults */ }
  const key = Object.keys(table).sort((a, b) => b.length - a.length).find(k => model.startsWith(k));
  return key ? table[key] : { input: 2.0, cached: 0.5, output: 8.0 }; // unknown model: price conservatively
}
export function costUsd(model: string, u: Usage) {
  const p = priceFor(model);
  return ((u.inputTokens - u.cachedTokens) * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1e6;
}

export class OpenAIProvider implements LlmProvider {
  readonly model: string; private apiKey: string; private timeoutMs: number; private endpoint: string;
  constructor(model: string, apiKey: string, timeoutMs = 90000, endpoint = 'https://api.openai.com/v1/responses') { this.model = model; this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.endpoint = endpoint; }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), this.timeoutMs), started = Date.now();
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, instructions: req.instructions, input: req.input, store: false, max_output_tokens: req.maxOutputTokens,
          text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } } }),
      });
    } catch (e: any) {
      throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? 'Model request timed out after ' + this.timeoutMs / 1000 + 's' : 'Network error reaching the model provider', true);
    } finally { clearTimeout(timer); }
    const body: any = await res.json().catch(() => ({}));
    const usage: Usage = { inputTokens: body?.usage?.input_tokens ?? 0, cachedTokens: body?.usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: body?.usage?.output_tokens ?? 0 };
    if (!res.ok) {
      const msg = String(body?.error?.message ?? 'HTTP ' + res.status).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 300);
      if (res.status === 429) throw new ProviderError('rate_limit', 'Provider rate limit or quota: ' + msg, !/quota/i.test(msg));
      if (res.status === 401 || res.status === 403) throw new ProviderError('auth', 'Provider rejected the API key or model access', false);
      if (res.status >= 500) throw new ProviderError('server', 'Provider error ' + res.status, true);
      throw new ProviderError('bad_request', 'Provider rejected the request (' + String(body?.error?.param ?? 'unknown parameter') + '): ' + msg, false);
    }
    if (body.status === 'incomplete') throw new ProviderError('truncated', 'Model output was cut off (' + String(body.incomplete_details?.reason ?? 'unknown') + ')', true, usage);
    const content = (body.output || []).filter((x: any) => x.type === 'message').flatMap((x: any) => x.content || []);
    const refusal = content.find((c: any) => c.type === 'refusal');
    if (refusal) throw new ProviderError('refusal', 'Model declined: ' + String(refusal.refusal).slice(0, 200), false, usage);
    const text = content.filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('');
    try { return { json: JSON.parse(text), usage, model: String(body.model ?? this.model), latencyMs: Date.now() - started, requestId: res.headers.get('x-request-id') ?? undefined }; }
    catch { throw new ProviderError('parse', 'Model returned text that is not valid JSON', true, usage); }
  }
}

/** Deterministic provider for tests and offline development. */
export class FakeProvider implements LlmProvider {
  readonly model = 'fake-model';
  calls: CompletionRequest[] = [];
  private respond: (req: CompletionRequest, call: number) => unknown | Promise<unknown>;
  constructor(respond: (req: CompletionRequest, call: number) => unknown | Promise<unknown>) { this.respond = respond; }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const out = await this.respond(req, this.calls.length);
    if (out instanceof ProviderError) throw out;
    return { json: out, usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 300 }, model: this.model, latencyMs: 1 };
  }
}
