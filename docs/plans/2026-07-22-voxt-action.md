# voxt-action — implementation plan

**Goal:** a GitHub Action that posts CI notifications (build results, test runs, deploys) to a Voxt chat, authenticated with a Voxt API key.

```yaml
- uses: Actual-Chat/voxt-action@v1
  if: always()
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    status: ${{ job.status }}
```

---

## 1. What the Voxt backend offers today

No new server work is required for v1 — everything needed already exists:

| Piece | Where | Notes |
|---|---|---|
| API keys | Settings → API keys (`ApiKeySettings.razor`, `ApiKeyCreateModal.razor`) | User-created, revealed once, used as `Authorization: Bearer <key>` |
| Auth | `McpAuthMiddleware` | Rejects non-`SessionKind.ApiKey` tokens; 401 with `WWW-Authenticate` details (verified live on actual.chat) |
| Endpoint | MCP server at `POST {base}/api/mcp` (streamable HTTP, `McpSettings.Route`) | **Stateless mode** (`McpModule`: `WithHttpTransport(o => o.Stateless = true)`) |
| Post | `post_message(chatId, text)` → returns entry LID | `McpMessageTools.cs` |
| Edit | `edit_message(chatId, entryId, text)` | Enables "post placeholder → update with result" pattern |
| Markup | `MarkupParser` | `**bold**`, `*italic*`, ` ``` ` code blocks, headers, lists, quotes, URLs, mentions |

**Posting a message is a single HTTP request.** Because the server runs the MCP transport in stateless mode, no `initialize` handshake and no `Mcp-Session-Id` are needed (verified against ModelContextProtocol.AspNetCore 1.3.0 source, the version pinned in `Directory.Packages.props`: stateless mode creates a transient per-request session for any JSON-RPC message, and actually *rejects* `Mcp-Session-Id` if sent):

```
POST {base-url}/api/mcp
Authorization: Bearer <api-key>
Content-Type: application/json
Accept: application/json, text/event-stream   ← both required (spec-mandated, strictly checked)

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"post_message","arguments":{"chatId":"...","text":"..."}}}
```

The response body is SSE-framed: one `data: {jsonrpc response}` event carrying the tool result (the entry LID). So "MCP client" here means: one `fetch`, a JSON-RPC envelope, and unwrapping one `data:` line — equivalent in complexity to a Slack webhook call.

A dedicated REST endpoint (e.g. `POST /api/bot/messages`) is no longer meaningfully simpler; drop it unless we later want webhook-style URLs with embedded credentials.

## 2. Trends from Slack / Discord / Telegram / Teams actions

Survey of the popular notification actions (`slackapi/slack-github-action` v2, `8398a7/action-slack`, `rtCamp/action-slack-notify`, `sarisia/actions-status-discord`, `appleboy/telegram-action`, Teams webhook actions):

1. **Two usage modes, both first-class:**
   - *Zero-config status mode:* pass `status: ${{ job.status }}` and get a well-formatted message auto-built from GitHub context (repo, workflow, branch/PR, commit, actor, run link). This is what most users actually use.
   - *Custom message mode:* pass `message:` with full control (and `${{ }}` interpolation done by GitHub itself).
2. **Credentials only via secrets**, masked in logs. Actions call `core.setSecret()` defensively.
3. **`if: always()` pattern** — the action must be cheap and reliable so it can run on failure paths; a notification failure should be loud in logs but *optionally* not fail the job (`fail-on-error` input, default `true`).
4. **Status coloring/emoji** — ✅ success / ❌ failure / ⚠️ cancelled. Voxt has no embed colors, so emoji + bold title carry the signal.
5. **Deep links** — run URL is the single most valuable line; also commit and PR links. "Actionable notifications" is the #1 best-practice theme.
6. **Message id as output** for threading/updating. Slack v2 outputs `ts`; the start→finish "edit the same message" pattern is a loved feature. Voxt's `edit_message` supports this directly — a genuine differentiator vs. webhook-only platforms.
7. **Runtime: TypeScript on `node24`**, bundled to a single `dist/index.js` (esbuild or `@vercel/ncc`), zero runtime deps. Docker actions are out of fashion (slow, Linux-only runners); composite+curl actions are fragile (quoting, no retries, Windows runners).

## 3. Action design

### Repo: `Actual-Chat/voxt-action` (this repo)

```
action.yml
src/
  main.ts          # entry: read inputs, build message, call client, set outputs
  message.ts       # default template builder from github context
  mcp-client.ts    # single-request tools/call client (stateless MCP over HTTP)
dist/index.js      # bundled, committed (required for JS actions)
docs/plans/
README.md
```

### `action.yml`

```yaml
name: Voxt Notify
description: Post build/test notifications to a Voxt chat
branding: { icon: message-circle, color: purple }
inputs:
  api-key:      { required: true }   # Voxt API key (store as secret)
  chat-id:      { required: true }   # target chat id
  status:       { required: false }  # success | failure | cancelled — enables auto message; pass ${{ job.status }}
  message:      { required: false }  # custom text (Voxt markup); appended to auto message if status also set
  title:        { required: false }  # overrides auto title
  message-id:   { required: false }  # LID of a previously posted message → edit instead of post
  base-url:     { required: false, default: 'https://actual.chat' }
  fail-on-error:{ required: false, default: 'true' }
outputs:
  message-id:   # LID of the posted/edited entry, for follow-up edits
runs: { using: node24, main: dist/index.js }
```

Validation: require at least one of `status` / `message`.

### Default message template (status mode)

```
✅ **myorg/myrepo — Build & Test #1234 succeeded**
`main` · `a1b2c3d` fix: handle empty transcript · by frolchizhov
https://github.com/myorg/myrepo/actions/runs/987654321
```

- **No `[text](url)` links** — Voxt's `MarkupParser` only auto-links bare URLs (`UrlMarkup`), so links go on their own lines
- Emoji by status: ✅ / ❌ / ⚠️ (cancelled) / ℹ️ (unknown status)
- On PR events: `PR #123: title` + PR URL instead of the branch/commit line
- Everything from `@actions/github` `context` — no extra API calls, no extra token needed
- `message` input, if present, appended as a final paragraph (e.g. test counts)

### Voxt client (`mcp-client.ts`)

One POST to `{base-url}/api/mcp` (see §1 for the exact request): `tools/call` → `post_message` or `edit_message`; parse the SSE-framed JSON-RPC response (split on `data:` lines; also accept a plain-JSON body defensively), check for a JSON-RPC `error`, extract the LID from the result.

- Native `fetch` (node24) — zero runtime deps
- Retry 5xx / network errors: 3 attempts, exponential backoff (1s/4s); never retry 4xx
- 401 → actionable error: "check VOXT_API_KEY is valid and not expired (Voxt → Settings → API keys)"
- Timeout ~15s per request via `AbortSignal.timeout`
- `core.setSecret(apiKey)` first thing in `main.ts`

## 4. Testing

- **Unit (vitest):** template builder snapshots per event type (push, PR, cancelled, custom-only); MCP client against mocked `fetch` (JSON body, SSE body, 401, 500-then-200 retry, timeout)
- **Self-test workflow (dogfooding):** `ci.yml` in this repo builds, then posts its own result to a dedicated test chat using `./` (local action reference) with `VOXT_API_KEY` repo secret — the action's CI is also its integration test
- **Edit-flow test:** job posts "🏗️ running…", captures `message-id` output, edits to final status in a later step
- **`dist/` freshness check:** CI rebuilds and fails on diff (standard JS-action guard)

## 5. Release & docs

1. README: quick-start, both modes, post-then-edit example, how to get an API key (Settings → API keys) and a chat id, input/output reference
2. Tag `v1.0.0` + floating major tag `v1` (retag on each release — the ecosystem convention)
3. Publish to GitHub Marketplace ("Voxt Notify")
4. Adopt in the ActualChat repo's own workflows (nightly tests → team chat) as the first real consumer

## 6. Milestones

| # | Deliverable | Scope |
|---|---|---|
| 1 | Skeleton | `action.yml`, TS toolchain, esbuild bundle, dist check CI |
| 2 | Voxt client | single-request post_message/edit_message, retries, error mapping, unit tests |
| 3 | Message builder | status templates, PR/push variants, custom message, snapshots |
| 4 | Dogfood CI | self-notifying workflow incl. edit flow |
| 5 | Release | README, v1 tags, Marketplace listing, ActualChat adoption |

## 7. Open questions / follow-ups

- **Posting identity:** messages appear as the API-key owner. Teams will likely want a dedicated "CI bot" account (avatar, name). Server-side "bot authors" would be a nicer long-term answer.
- **Chat id discoverability:** how does a user find a chat id in the UI? If it's not copyable anywhere, that's a small Voxt UI task worth filing (the MCP `list_chats` tool exists but is awkward for setup).
- **Rate limits:** none observed on `/api/mcp`; confirm before Marketplace publishing.
- **Stateless-mode coupling:** the one-request flow relies on the server keeping `Stateless = true`. If that ever changes, the client needs the initialize handshake back — worth a comment in `mcp-client.ts` and an integration test that would catch it.
- **Attachments:** uploading e.g. a test-report file is out of scope for v1 (no MCP upload tool today).
