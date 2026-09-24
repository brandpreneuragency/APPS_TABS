import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CodexPendingRecord } from '../../services/codex/sessionTypes';
import { CodexRequestPanel } from './CodexRequestPanel';

const fake = vi.hoisted(() => ({
  snapshot: { connection: null, models: [], error: null, activeRunId: null, activeAppThreadId: null },
  reply: vi.fn(async () => undefined),
  getPending: vi.fn(async () => [] as CodexPendingRecord[]),
  getRuns: vi.fn(async () => []),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../services/codex/useCodexService', () => ({ useCodexService: () => fake.snapshot }));
vi.mock('../../services/codex/sessionService', () => ({ codexSessionService: fake }));
afterEach(cleanup);

it('sends distinct answers for each native question and masks secret input', async () => {
  fake.reply.mockClear();
  fake.getPending.mockResolvedValueOnce([{ requestId: '2:question', runId: 'run-1', epoch: 2,
    status: 'pending', createdAt: 1, updatedAt: 1,
    request: { requestId: '2:question', kind: 'question', threadId: 'thread-1', turnId: 'turn-1',
      details: { questions: [
        { id: 'first', header: 'First', question: 'What should happen?', options: null },
        { id: 'second', header: 'Second', question: 'Private answer?', isSecret: true },
      ] } },
  }]);
  render(<CodexRequestPanel appThreadId="app-thread-1" />);
  const first = await screen.findByRole('textbox', { name: 'What should happen?' });
  const second = screen.getByLabelText('Private answer?');
  expect(second).toHaveAttribute('type', 'password');
  fireEvent.change(first, { target: { value: 'Make a draft' } });
  fireEvent.change(second, { target: { value: 'Private synthetic answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'codex.sendAnswer' }));
  await waitFor(() => expect(fake.reply).toHaveBeenCalledWith('2:question', {
    kind: 'question', answers: { first: ['Make a draft'], second: ['Private synthetic answer'] },
  }));
});
