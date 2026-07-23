# voxt-action

Post build/test notifications from GitHub Actions to a [Voxt](https://actual.chat) chat.

```yaml
- uses: Actual-Chat/voxt-action@v1
  if: always()
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    status: ${{ job.status }}
```

That posts a message like:

> ✅ **Actual-Chat/actual-chat — Build & Test #1234 succeeded**
> `main` · `a1b2c3d` fix: handle empty transcript · by frolchizhov
> https://github.com/Actual-Chat/actual-chat/actions/runs/987654321

## Setup

1. **API key** — in Voxt: **Settings → API keys → New API key**. Copy the key
   (it is revealed only once) and save it as a repository secret named
   `VOXT_API_KEY`. Messages are posted as the key's owner, so consider
   creating a dedicated CI account.
2. **Chat id** — the id of the target chat (the part after `/chat/` in the
   chat's URL).

## Usage

### Status notification

Pass `status: ${{ job.status }}` and the message is built automatically from
the workflow context: status emoji, repo, workflow name and run number,
branch/PR, commit, actor, and a link to the run.

```yaml
- uses: Actual-Chat/voxt-action@v1
  if: always()          # notify on failure and cancellation too
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    status: ${{ job.status }}
```

### Custom message

Write your own text instead (or in addition — with both inputs set, the
custom text is appended to the status block). Voxt markup is supported:
`**bold**`, `*italic*`, `` `code` ``, code blocks; bare URLs become links.

```yaml
- uses: Actual-Chat/voxt-action@v1
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    message: |
      **Deployed** `${{ github.sha }}` to production 🚀
      https://actual.chat
```

### Post at start, update with the result

The action outputs the posted message's id; pass it back via `message-id` to
edit that message instead of posting a new one — one message per run, updated
in place:

```yaml
- uses: Actual-Chat/voxt-action@v1
  id: notify
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    title: 'Build running…'
    status: running

# ... build steps ...

- uses: Actual-Chat/voxt-action@v1
  if: always()
  with:
    api-key: ${{ secrets.VOXT_API_KEY }}
    chat-id: dpwo1cnb1k
    message-id: ${{ steps.notify.outputs.message-id }}
    status: ${{ job.status }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | yes | — | Voxt API key (store as a secret) |
| `chat-id` | yes | — | Target chat id |
| `status` | one of these | — | `success` / `failure` / `cancelled` — pass `${{ job.status }}`; enables the automatic message |
| `message` | one of these | — | Custom text (Voxt markup); appended if `status` is also set |
| `title` | no | auto | Overrides the generated title |
| `message-id` | no | — | Id of an earlier message to edit instead of posting |
| `base-url` | no | `https://actual.chat` | Voxt server base URL |
| `fail-on-error` | no | `true` | Whether a notification failure fails the step |

## Outputs

| Output | Description |
|---|---|
| `message-id` | Id of the posted/edited message; feed it back via `message-id` to update it later |

## Development

```sh
npm ci
npm run all   # typecheck + tests + bundle to dist/
```

`dist/index.js` is committed (required for JS actions); CI fails if it is out
of date.
