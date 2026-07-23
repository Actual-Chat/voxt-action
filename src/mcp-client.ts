// Minimal client for Voxt's MCP-over-HTTP endpoint.
//
// The Voxt server runs the MCP streamable HTTP transport in *stateless* mode
// (McpModule: `WithHttpTransport(o => o.Stateless = true)`), so every request
// is self-contained: no `initialize` handshake, no `Mcp-Session-Id` header
// (the server rejects it in stateless mode). Posting a message is therefore a
// single JSON-RPC `tools/call` POST. If the server ever switches to stateful
// mode, this client must grow the initialize handshake back — the CI
// integration test posts through the real endpoint and would catch that.

export interface VoxtClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout, ms. Default 15s. */
  timeoutMs?: number;
  /** Max attempts for retryable failures (5xx / network / timeout). Default 3. */
  maxAttempts?: number;
  /** Base backoff delay, ms; grows 4x per attempt (1s, 4s). Default 1s. */
  backoffMs?: number;
}

export class VoxtError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'VoxtError';
  }
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: CallToolResult;
  error?: { code: number; message: string; data?: unknown };
}

interface CallToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export class VoxtClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(options: VoxtClientOptions) {
    this.endpoint = options.baseUrl.replace(/\/+$/, '') + '/api/mcp';
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 1_000;
  }

  /** Posts a new message; returns its id (the entry LID). */
  async postMessage(chatId: string, text: string): Promise<number> {
    const result = await this.callTool('post_message', { chatId, text });
    const id = extractNumber(result);
    if (id === null)
      throw new VoxtError(`post_message succeeded but returned no message id: ${JSON.stringify(result)}`);
    return id;
  }

  /** Edits a previously posted message in place. */
  async editMessage(chatId: string, entryId: number, text: string): Promise<void> {
    await this.callTool('edit_message', { chatId, entryId, text });
  }

  // Internal

  private async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    };

    let lastError: VoxtError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1)
        await sleep(this.backoffMs * 4 ** (attempt - 2));
      try {
        return await this.send(request);
      } catch (e) {
        if (e instanceof VoxtError && e.retryable) {
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    throw new VoxtError(`${lastError!.message} (after ${this.maxAttempts} attempts)`);
  }

  private async send(request: object): Promise<CallToolResult> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // The streamable HTTP spec mandates accepting both; the server
          // rejects the request with 406 otherwise.
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === 'TimeoutError'
        ? `request timed out after ${this.timeoutMs}ms`
        : `network error: ${e instanceof Error ? e.message : String(e)}`;
      throw new VoxtError(`POST ${this.endpoint} failed: ${reason}`, true);
    }

    const body = await response.text();

    if (response.status === 401)
      throw new VoxtError(
        'Voxt rejected the API key (401). Check that the `api-key` input is a valid, '
        + 'non-expired Voxt API key (Voxt → Settings → API keys). '
        + `Server response: ${body.trim()}`,
      );
    if (!response.ok)
      throw new VoxtError(
        `POST ${this.endpoint} failed: HTTP ${response.status} ${body.trim()}`.trim(),
        response.status >= 500,
      );

    const rpc = parseRpcResponse(body, response.headers.get('content-type') ?? '');
    if (rpc.error)
      throw new VoxtError(`Voxt returned a JSON-RPC error: ${rpc.error.message} (code ${rpc.error.code})`);

    const result = rpc.result ?? {};
    if (result.isError) {
      const text = result.content?.find(c => c.type === 'text')?.text ?? JSON.stringify(result);
      throw new VoxtError(`Voxt tool call failed: ${text}`);
    }
    return result;
  }
}

/**
 * Parses a JSON-RPC response that arrives either as plain JSON or as an SSE
 * stream (`data: {...}` events) — stateless streamable HTTP responds with the
 * latter, but accept both defensively.
 */
export function parseRpcResponse(body: string, contentType: string): JsonRpcResponse {
  if (!contentType.includes('text/event-stream')) {
    try {
      return JSON.parse(body) as JsonRpcResponse;
    } catch {
      throw new VoxtError(`Voxt returned an unparseable response: ${truncate(body)}`);
    }
  }

  // SSE: one or more events; each event's payload is the concatenation of its
  // `data:` lines. The response to our request is the event whose payload has
  // a `result` or `error` member.
  for (const event of body.split(/\n\n|\r\n\r\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data)
      continue;
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(data) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (parsed.result !== undefined || parsed.error !== undefined)
      return parsed;
  }
  throw new VoxtError(`Voxt returned no JSON-RPC response in the event stream: ${truncate(body)}`);
}

/**
 * Extracts the numeric tool return value. The C# MCP SDK puts a primitive
 * return into `structuredContent` as `{"result": <value>}` (structured content
 * must be a JSON object); older/other shapes fall back to the text content.
 */
function extractNumber(result: CallToolResult): number | null {
  const structured = result.structuredContent;
  if (typeof structured === 'number')
    return structured;
  if (structured !== null && typeof structured === 'object') {
    const inner = (structured as Record<string, unknown>).result;
    if (typeof inner === 'number')
      return inner;
  }
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (text !== undefined) {
    const n = Number(text.trim());
    if (Number.isFinite(n))
      return n;
  }
  return null;
}

function truncate(s: string, max = 500): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
