import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@actions/github/lib/context.js
var require_context = __commonJS({
  "node_modules/@actions/github/lib/context.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Context = void 0;
    var fs_1 = __require("fs");
    var os_1 = __require("os");
    var Context2 = class {
      /**
       * Hydrate the context from the environment
       */
      constructor() {
        var _a, _b, _c;
        this.payload = {};
        if (process.env.GITHUB_EVENT_PATH) {
          if ((0, fs_1.existsSync)(process.env.GITHUB_EVENT_PATH)) {
            this.payload = JSON.parse((0, fs_1.readFileSync)(process.env.GITHUB_EVENT_PATH, { encoding: "utf8" }));
          } else {
            const path = process.env.GITHUB_EVENT_PATH;
            process.stdout.write(`GITHUB_EVENT_PATH ${path} does not exist${os_1.EOL}`);
          }
        }
        this.eventName = process.env.GITHUB_EVENT_NAME;
        this.sha = process.env.GITHUB_SHA;
        this.ref = process.env.GITHUB_REF;
        this.workflow = process.env.GITHUB_WORKFLOW;
        this.action = process.env.GITHUB_ACTION;
        this.actor = process.env.GITHUB_ACTOR;
        this.job = process.env.GITHUB_JOB;
        this.runAttempt = parseInt(process.env.GITHUB_RUN_ATTEMPT, 10);
        this.runNumber = parseInt(process.env.GITHUB_RUN_NUMBER, 10);
        this.runId = parseInt(process.env.GITHUB_RUN_ID, 10);
        this.apiUrl = (_a = process.env.GITHUB_API_URL) !== null && _a !== void 0 ? _a : `https://api.github.com`;
        this.serverUrl = (_b = process.env.GITHUB_SERVER_URL) !== null && _b !== void 0 ? _b : `https://github.com`;
        this.graphqlUrl = (_c = process.env.GITHUB_GRAPHQL_URL) !== null && _c !== void 0 ? _c : `https://api.github.com/graphql`;
      }
      get issue() {
        const payload = this.payload;
        return Object.assign(Object.assign({}, this.repo), { number: (payload.issue || payload.pull_request || payload).number });
      }
      get repo() {
        if (process.env.GITHUB_REPOSITORY) {
          const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
          return { owner, repo };
        }
        if (this.payload.repository) {
          return {
            owner: this.payload.repository.owner.login,
            repo: this.payload.repository.name
          };
        }
        throw new Error("context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo'");
      }
    };
    exports.Context = Context2;
  }
});

// src/main.ts
var import_context = __toESM(require_context(), 1);

// src/core.ts
import { appendFileSync } from "node:fs";
import { EOL } from "node:os";
import * as crypto from "node:crypto";
function getInput(name, options) {
  const value = (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
  if (options?.required && !value)
    throw new Error(`Input required and not supplied: ${name}`);
  return value;
}
function getBooleanInput(name, options) {
  const value = getInput(name, options);
  if (["true", "True", "TRUE"].includes(value))
    return true;
  if (["false", "False", "FALSE"].includes(value))
    return false;
  throw new TypeError(`Input is not boolean: ${name} (got: ${value})`);
}
function setSecret(secret) {
  issueCommand("add-mask", secret);
}
function setOutput(name, value) {
  const filePath = process.env["GITHUB_OUTPUT"];
  if (!filePath) {
    issueCommand(`set-output name=${name}`, String(value));
    return;
  }
  const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
  appendFileSync(filePath, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
}
function info(message) {
  process.stdout.write(message + EOL);
}
function error(message) {
  issueCommand("error", message);
}
function setFailed(message) {
  process.exitCode = 1;
  error(message);
}
function issueCommand(command, value) {
  const escaped = value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  process.stdout.write(`::${command}::${escaped}${EOL}`);
}

// src/message.ts
var STATUS_EMOJI = {
  success: "\u2705",
  failure: "\u274C",
  cancelled: "\u26A0\uFE0F"
};
var STATUS_VERB = {
  success: "succeeded",
  failure: "failed",
  cancelled: "was cancelled"
};
function buildMessage(context, options) {
  const { status, message, title } = options;
  if (!status)
    return message ?? "";
  const emoji = STATUS_EMOJI[status] ?? "\u2139\uFE0F";
  const verb = STATUS_VERB[status] ?? status;
  const { owner, repo } = context.repo;
  const titleText = title ?? `${owner}/${repo} \u2014 ${context.workflow} #${context.runNumber} ${verb}`;
  const lines = [`${emoji} **${titleText}**`];
  const pr = context.payload.pull_request;
  if (pr) {
    const prTitle = pr.title ? `: ${pr.title}` : "";
    lines.push(`PR #${pr.number}${prTitle}`);
    if (pr.html_url)
      lines.push(pr.html_url);
  } else {
    const branch = context.ref.replace(/^refs\/(heads|tags)\//, "");
    const shortSha = context.sha.slice(0, 7);
    const commitTitle = firstLine(context.payload.head_commit?.message);
    const commit = commitTitle ? `\`${shortSha}\` ${commitTitle}` : `\`${shortSha}\``;
    lines.push(`\`${branch}\` \xB7 ${commit} \xB7 by ${context.actor}`);
  }
  lines.push(runUrl(context));
  if (message)
    lines.push("", message);
  return lines.join("\n");
}
function runUrl(context) {
  const { owner, repo } = context.repo;
  return `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
}
function firstLine(s) {
  return s?.split("\n", 1)[0]?.trim() ?? "";
}

// src/mcp-client.ts
var VoxtError = class extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
    this.name = "VoxtError";
  }
};
var VoxtClient = class {
  endpoint;
  apiKey;
  timeoutMs;
  maxAttempts;
  backoffMs;
  constructor(options) {
    this.endpoint = options.baseUrl.replace(/\/+$/, "") + "/mcp";
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15e3;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 1e3;
  }
  /** Posts a new message; returns its id (the entry LID). */
  async postMessage(chatId, text) {
    const result = await this.callTool("post_message", { chatId, text });
    const id = extractNumber(result);
    if (id === null)
      throw new VoxtError(`post_message succeeded but returned no message id: ${JSON.stringify(result)}`);
    return id;
  }
  /** Edits a previously posted message in place. */
  async editMessage(chatId, entryId, text) {
    await this.callTool("edit_message", { chatId, entryId, text });
  }
  // Internal
  async callTool(name, args) {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args }
    };
    let lastError = null;
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
    throw new VoxtError(`${lastError.message} (after ${this.maxAttempts} attempts)`);
  }
  async send(request) {
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // The streamable HTTP spec mandates accepting both; the server
          // rejects the request with 406 otherwise.
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError" ? `request timed out after ${this.timeoutMs}ms` : `network error: ${e instanceof Error ? e.message : String(e)}`;
      throw new VoxtError(`POST ${this.endpoint} failed: ${reason}`, true);
    }
    const body = await response.text();
    if (response.status === 401)
      throw new VoxtError(
        `Voxt rejected the API key (401). Check that the \`api-key\` input is a valid, non-expired Voxt API key (Voxt \u2192 Settings \u2192 API keys). Server response: ${body.trim()}`
      );
    if (!response.ok)
      throw new VoxtError(
        `POST ${this.endpoint} failed: HTTP ${response.status} ${body.trim()}`.trim(),
        response.status >= 500
      );
    const rpc = parseRpcResponse(body, response.headers.get("content-type") ?? "");
    if (rpc.error)
      throw new VoxtError(`Voxt returned a JSON-RPC error: ${rpc.error.message} (code ${rpc.error.code})`);
    const result = rpc.result ?? {};
    if (result.isError) {
      const text = result.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(result);
      throw new VoxtError(`Voxt tool call failed: ${text}`);
    }
    return result;
  }
};
function parseRpcResponse(body, contentType) {
  if (!contentType.includes("text/event-stream")) {
    try {
      return JSON.parse(body);
    } catch {
      throw new VoxtError(`Voxt returned an unparseable response: ${truncate(body)}`);
    }
  }
  for (const event of body.split(/\n\n|\r\n\r\n/)) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data)
      continue;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (parsed.result !== void 0 || parsed.error !== void 0)
      return parsed;
  }
  throw new VoxtError(`Voxt returned no JSON-RPC response in the event stream: ${truncate(body)}`);
}
function extractNumber(result) {
  const structured = result.structuredContent;
  if (typeof structured === "number")
    return structured;
  if (structured !== null && typeof structured === "object") {
    const inner = structured.result;
    if (typeof inner === "number")
      return inner;
  }
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (text !== void 0) {
    const n = Number(text.trim());
    if (Number.isFinite(n))
      return n;
  }
  return null;
}
function truncate(s, max = 500) {
  return s.length <= max ? s : s.slice(0, max) + "\u2026";
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/main.ts
async function run() {
  const apiKey = getInput("api-key", { required: true });
  setSecret(apiKey);
  const chatId = getInput("chat-id", { required: true });
  const status = getInput("status") || void 0;
  const message = getInput("message") || void 0;
  const title = getInput("title") || void 0;
  const messageIdInput = getInput("message-id") || void 0;
  const baseUrl = getInput("base-url") || "https://actual.chat";
  const failOnError = getBooleanInput("fail-on-error");
  try {
    if (!status && !message)
      throw new Error("At least one of the `status` / `message` inputs is required.");
    let messageId;
    if (messageIdInput !== void 0) {
      messageId = Number(messageIdInput);
      if (!Number.isSafeInteger(messageId))
        throw new Error(`The \`message-id\` input must be an integer, got: ${messageIdInput}`);
    }
    const text = buildMessage(new import_context.Context(), { status, message, title });
    if (!text)
      throw new Error("The message to post is empty.");
    const client = new VoxtClient({ baseUrl, apiKey });
    if (messageId !== void 0) {
      await client.editMessage(chatId, messageId, text);
      info(`Edited message ${messageId} in chat ${chatId}.`);
    } else {
      messageId = await client.postMessage(chatId, text);
      info(`Posted message ${messageId} to chat ${chatId}.`);
    }
    setOutput("message-id", messageId);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (failOnError)
      setFailed(errorMessage);
    else
      error(`Voxt notification failed (ignored because fail-on-error is false): ${errorMessage}`);
  }
}
await run();
export {
  run
};
