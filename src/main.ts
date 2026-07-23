// Import just the context class — pulling in all of @actions/github would
// bundle Octokit (~900kb) for no reason.
import { Context } from '@actions/github/lib/context.js';
import * as core from './core.js';
import { buildMessage } from './message.js';
import { VoxtClient } from './mcp-client.js';

export async function run(): Promise<void> {
  const apiKey = core.getInput('api-key', { required: true });
  core.setSecret(apiKey);

  const chatId = core.getInput('chat-id', { required: true });
  const status = core.getInput('status') || undefined;
  const message = core.getInput('message') || undefined;
  const title = core.getInput('title') || undefined;
  const messageIdInput = core.getInput('message-id') || undefined;
  const baseUrl = core.getInput('base-url') || 'https://actual.chat';
  const failOnError = core.getBooleanInput('fail-on-error');

  try {
    if (!status && !message)
      throw new Error('At least one of the `status` / `message` inputs is required.');

    let messageId: number | undefined;
    if (messageIdInput !== undefined) {
      messageId = Number(messageIdInput);
      if (!Number.isSafeInteger(messageId))
        throw new Error(`The \`message-id\` input must be an integer, got: ${messageIdInput}`);
    }

    const text = buildMessage(new Context(), { status, message, title });
    if (!text)
      throw new Error('The message to post is empty.');

    const client = new VoxtClient({ baseUrl, apiKey });
    if (messageId !== undefined) {
      await client.editMessage(chatId, messageId, text);
      core.info(`Edited message ${messageId} in chat ${chatId}.`);
    } else {
      messageId = await client.postMessage(chatId, text);
      core.info(`Posted message ${messageId} to chat ${chatId}.`);
    }
    core.setOutput('message-id', messageId);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (failOnError)
      core.setFailed(errorMessage);
    else
      core.error(`Voxt notification failed (ignored because fail-on-error is false): ${errorMessage}`);
  }
}

await run();
