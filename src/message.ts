// Builds the notification text from the GitHub Actions context.
//
// Note on markup: Voxt supports **bold**, *italic*, `code`, code blocks, and
// bare auto-linked URLs — but NOT markdown-style [text](url) links
// (MarkupParser has UrlMarkup for plain URLs only). So links go on their own
// lines as bare URLs.

/** The subset of `@actions/github` context this builder needs (typed for testability). */
export interface BuildContext {
  serverUrl: string;
  repo: { owner: string; repo: string };
  workflow: string;
  runId: number;
  runNumber: number;
  eventName: string;
  ref: string;
  sha: string;
  actor: string;
  payload: {
    pull_request?: { number: number; title?: string; html_url?: string };
    head_commit?: { message?: string };
  };
}

export interface MessageOptions {
  /** success | failure | cancelled — anything else is shown as-is. */
  status?: string;
  /** Custom text; appended to the status message, or the whole message if no status. */
  message?: string;
  /** Overrides the auto-generated title line (emoji is still prepended). */
  title?: string;
}

const STATUS_EMOJI: Record<string, string> = {
  success: '✅',
  failure: '❌',
  cancelled: '⚠️',
};

const STATUS_VERB: Record<string, string> = {
  success: 'succeeded',
  failure: 'failed',
  cancelled: 'was cancelled',
};

export function buildMessage(context: BuildContext, options: MessageOptions): string {
  const { status, message, title } = options;
  if (!status)
    return message ?? '';

  const emoji = STATUS_EMOJI[status] ?? 'ℹ️';
  const verb = STATUS_VERB[status] ?? status;
  const { owner, repo } = context.repo;

  const titleText = title
    ?? `${owner}/${repo} — ${context.workflow} #${context.runNumber} ${verb}`;
  const lines = [`${emoji} **${titleText}**`];

  const pr = context.payload.pull_request;
  if (pr) {
    const prTitle = pr.title ? `: ${pr.title}` : '';
    lines.push(`PR #${pr.number}${prTitle}`);
    if (pr.html_url)
      lines.push(pr.html_url);
  } else {
    const branch = context.ref.replace(/^refs\/(heads|tags)\//, '');
    const shortSha = context.sha.slice(0, 7);
    const commitTitle = firstLine(context.payload.head_commit?.message);
    const commit = commitTitle ? `\`${shortSha}\` ${commitTitle}` : `\`${shortSha}\``;
    lines.push(`\`${branch}\` · ${commit} · by ${context.actor}`);
  }

  lines.push(runUrl(context));

  if (message)
    lines.push('', message);
  return lines.join('\n');
}

export function runUrl(context: BuildContext): string {
  const { owner, repo } = context.repo;
  return `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
}

function firstLine(s: string | undefined): string {
  return s?.split('\n', 1)[0]?.trim() ?? '';
}
