import { describe, expect, it } from 'vitest';
import { buildMessage, type BuildContext } from '../src/message.js';

function pushContext(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    serverUrl: 'https://github.com',
    repo: { owner: 'Actual-Chat', repo: 'actual-chat' },
    workflow: 'Build & Test',
    runId: 987654321,
    runNumber: 1234,
    eventName: 'push',
    ref: 'refs/heads/main',
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    actor: 'frolchizhov',
    payload: {
      head_commit: { message: 'fix: handle empty transcript\n\ndetails here' },
    },
    ...overrides,
  };
}

function prContext(): BuildContext {
  return pushContext({
    eventName: 'pull_request',
    ref: 'refs/pull/123/merge',
    payload: {
      pull_request: {
        number: 123,
        title: 'Add location sharing',
        html_url: 'https://github.com/Actual-Chat/actual-chat/pull/123',
      },
    },
  });
}

describe('buildMessage', () => {
  it('builds a success message for a push', () => {
    expect(buildMessage(pushContext(), { status: 'success' })).toBe(
      [
        '✅ **Actual-Chat/actual-chat — Build & Test #1234 succeeded**',
        '`main` · `a1b2c3d` fix: handle empty transcript · by frolchizhov',
        'https://github.com/Actual-Chat/actual-chat/actions/runs/987654321',
      ].join('\n'),
    );
  });

  it('builds a failure message', () => {
    const text = buildMessage(pushContext(), { status: 'failure' });
    expect(text).toContain('❌');
    expect(text).toContain('failed**');
  });

  it('builds a cancelled message', () => {
    const text = buildMessage(pushContext(), { status: 'cancelled' });
    expect(text).toContain('⚠️');
    expect(text).toContain('was cancelled**');
  });

  it('shows an unknown status as-is with a neutral emoji', () => {
    const text = buildMessage(pushContext(), { status: 'skipped' });
    expect(text).toContain('ℹ️');
    expect(text).toContain('skipped**');
  });

  it('uses PR number, title and URL on pull_request events', () => {
    expect(buildMessage(prContext(), { status: 'failure' })).toBe(
      [
        '❌ **Actual-Chat/actual-chat — Build & Test #1234 failed**',
        'PR #123: Add location sharing',
        'https://github.com/Actual-Chat/actual-chat/pull/123',
        'https://github.com/Actual-Chat/actual-chat/actions/runs/987654321',
      ].join('\n'),
    );
  });

  it('appends the custom message after the status block', () => {
    const text = buildMessage(pushContext(), { status: 'success', message: '512 tests, 0 failed' });
    expect(text.endsWith('\n\n512 tests, 0 failed')).toBe(true);
  });

  it('returns just the custom message when no status is given', () => {
    expect(buildMessage(pushContext(), { message: 'deploy done' })).toBe('deploy done');
  });

  it('honors the title override', () => {
    const text = buildMessage(pushContext(), { status: 'success', title: 'Nightly tests passed' });
    expect(text.startsWith('✅ **Nightly tests passed**')).toBe(true);
  });

  it('handles tag refs and missing head_commit', () => {
    const context = pushContext({ ref: 'refs/tags/v1.0.0', payload: {} });
    const text = buildMessage(context, { status: 'success' });
    expect(text).toContain('`v1.0.0` · `a1b2c3d` · by frolchizhov');
  });
});
