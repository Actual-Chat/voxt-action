import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoxtClient, parseRpcResponse } from '../src/mcp-client.js';

const ENDPOINT = 'https://voxt.test/api/mcp';

function sseBody(payload: object): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function rpcResult(result: object): object {
  return { jsonrpc: '2.0', id: 1, result };
}

function sseResponse(payload: object, status = 200): Response {
  return new Response(sseBody(payload), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function newClient(): VoxtClient {
  return new VoxtClient({
    baseUrl: 'https://voxt.test',
    apiKey: 'test-key',
    backoffMs: 1, // keep retry tests fast
  });
}

function mockFetch(...responses: (Response | Error)[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  for (const r of responses)
    r instanceof Error ? mock.mockRejectedValueOnce(r) : mock.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoxtClient.postMessage', () => {
  it('sends a single stateless tools/call request and returns the LID', async () => {
    const fetchMock = mockFetch(
      sseResponse(rpcResult({ structuredContent: { result: 42 }, content: [] })),
    );

    const lid = await newClient().postMessage('chat1', 'hello');

    expect(lid).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.headers.Accept).toBe('application/json, text/event-stream');
    expect(init.headers['Mcp-Session-Id']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'post_message', arguments: { chatId: 'chat1', text: 'hello' } },
    });
  });

  it('parses a plain-JSON response body too', async () => {
    mockFetch(
      new Response(JSON.stringify(rpcResult({ structuredContent: { result: 7 } })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await newClient().postMessage('chat1', 'hi')).toBe(7);
  });

  it('falls back to numeric text content when there is no structuredContent', async () => {
    mockFetch(sseResponse(rpcResult({ content: [{ type: 'text', text: '17' }] })));
    expect(await newClient().postMessage('chat1', 'hi')).toBe(17);
  });

  it('gives an actionable error on 401 and does not retry', async () => {
    const fetchMock = mockFetch(
      new Response('API key is inactive, expired, or not linked to a user.', { status: 401 }),
    );
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(
      /Settings → API keys.*API key is inactive/s,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 and succeeds', async () => {
    const fetchMock = mockFetch(
      new Response('boom', { status: 500 }),
      sseResponse(rpcResult({ structuredContent: { result: 3 } })),
    );
    expect(await newClient().postMessage('chat1', 'hi')).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors and fails after max attempts', async () => {
    const fetchMock = mockFetch(
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    );
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(/after 3 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400', async () => {
    const fetchMock = mockFetch(new Response('bad request', { status: 400 }));
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces JSON-RPC errors', async () => {
    mockFetch(
      sseResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown chat' } }),
    );
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(
      /JSON-RPC error: Unknown chat/,
    );
  });

  it('surfaces tool-level errors (isError result)', async () => {
    mockFetch(
      sseResponse(rpcResult({ isError: true, content: [{ type: 'text', text: 'No permission' }] })),
    );
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(
      /tool call failed: No permission/,
    );
  });

  it('fails with a clear error on a timeout', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    mockFetch(timeout, timeout, timeout);
    await expect(newClient().postMessage('chat1', 'hi')).rejects.toThrow(/timed out/);
  });
});

describe('VoxtClient.editMessage', () => {
  it('sends edit_message with the entry id', async () => {
    const fetchMock = mockFetch(sseResponse(rpcResult({ content: [] })));

    await newClient().editMessage('chat1', 42, 'updated');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).params).toEqual({
      name: 'edit_message',
      arguments: { chatId: 'chat1', entryId: 42, text: 'updated' },
    });
  });
});

describe('parseRpcResponse', () => {
  it('skips non-response SSE events and finds the response', () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'
      + sseBody(rpcResult({ structuredContent: { result: 5 } }));
    const rpc = parseRpcResponse(body, 'text/event-stream');
    expect(rpc.result).toEqual({ structuredContent: { result: 5 } });
  });

  it('joins multi-line data fields with \\n per the SSE spec', () => {
    const payload = JSON.stringify(rpcResult({ structuredContent: { result: 9 } }));
    // Split right after the opening brace — the joined \n is legal JSON
    // whitespace there, so the payload must parse.
    const body = `data: ${payload.slice(0, 1)}\ndata:${payload.slice(1)}\n\n`;
    const rpc = parseRpcResponse(body, 'text/event-stream');
    expect(rpc.result).toEqual({ structuredContent: { result: 9 } });
  });

  it('skips events whose data is not valid JSON', () => {
    const body = 'data: not-json\n\n' + sseBody(rpcResult({ structuredContent: { result: 4 } }));
    const rpc = parseRpcResponse(body, 'text/event-stream');
    expect(rpc.result).toEqual({ structuredContent: { result: 4 } });
  });

  it('throws on an empty event stream', () => {
    expect(() => parseRpcResponse(': ping\n\n', 'text/event-stream')).toThrow(
      /no JSON-RPC response/,
    );
  });
});
