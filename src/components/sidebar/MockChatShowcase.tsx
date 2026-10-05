import { useMemo, useState } from 'react';
import type { ChatMessage } from '../../types';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ToolCallBubble } from './ToolCallBubble';
import { seedMockBubbles } from '../../services/providers/mockBubbles';

interface MockChatShowcaseProps {
  threadId: string;
}

function fixtureBase(threadId: string, timestamp: number) {
  return { threadId, mode: 'writer' as const, agentId: 'mock-agent', timestamp };
}

/**
 * Static preview of every chat bubble state (reasoning streaming/done,
 * markdown answer, tool_call pending/done/rejected) plus a one-click seeder
 * that writes the same states into the active mock thread.
 */
export function MockChatShowcase({ threadId }: MockChatShowcaseProps) {
  const [seedError, setSeedError] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [now] = useState(() => Date.now());

  const fixtures = useMemo<ChatMessage[]>(() => {
    const base = fixtureBase(threadId, now);
    return [
      { ...base, id: 'mock-showcase-user', role: 'user', content: 'Show me reasoning, answer, and tool states.' },
      {
        ...base, id: 'mock-showcase-reasoning-streaming', role: 'assistant', timestamp: now + 1,
        content: '<think>\nReading your message…\nComparing two approaches for the demo…',
      },
      {
        ...base, id: 'mock-showcase-reasoning-done', role: 'assistant', timestamp: now + 2,
        content: '<think>\nRequest understood.\n- Render one reasoning box, one markdown answer, three tool states.\n</think>\n\n### Demo answer\n\nMock providers stream this text so the **reasoning → answer → tool call** order is visible.\n\n- Reasoning collapses above\n- H3 sections collapse below\n\n### Next step\n\nApprove the pending mock tool to preview ask-mode actions.',
      },
      {
        ...base, id: 'mock-showcase-tool-pending', role: 'tool_call', content: '', timestamp: now + 3,
        toolCall: {
          toolCallId: 'mock-showcase-tool-pending', name: 'read_file',
          args: JSON.stringify({ path: 'src/components/sidebar/ChatThread.tsx', limit: 40 }, null, 2),
          status: 'pending',
        },
      },
      {
        ...base, id: 'mock-showcase-tool-done', role: 'tool_call', content: '', timestamp: now + 4,
        toolCall: {
          toolCallId: 'mock-showcase-tool-done', name: 'shell_exec',
          args: 'npm run check',
          status: 'done', resultSummary: 'Mock result: typecheck + lint + tests passed in 42s.',
        },
      },
      {
        ...base, id: 'mock-showcase-tool-rejected', role: 'tool_call', content: '', timestamp: now + 5,
        toolCall: {
          toolCallId: 'mock-showcase-tool-rejected', name: 'write_file',
          args: JSON.stringify({ path: 'src/demo.ts', bytes: 128 }, null, 2),
          status: 'rejected',
        },
      },
    ];
  }, [threadId, now]);

  const seedDemo = async () => {
    setSeedError('');
    try {
      await seedMockBubbles(threadId);
      setSeeded(true);
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : 'Could not seed demo bubbles.');
    }
  };

  return (
    <div id="mock-chat-showcase" data-testid="mock-chat-showcase" className="ai-scroll flex-1 overflow-y-a flex flex-col" style={{ gap: 16, padding: '12px 15px' }}>
      <p className="subtle" data-testid="mock-showcase-hint" style={{ fontSize: 'var(--fs-sm)', textAlign: 'center' }}>
        Mock provider preview — reasoning, answer, and tool-call states below. Send a message to watch them stream live.
      </p>
      {fixtures.map((msg) => (
        msg.role === 'tool_call' ? (
          <ToolCallBubble key={msg.id} message={msg} onApprove={() => undefined} onReject={() => undefined} />
        ) : msg.role === 'user' ? (
          <UserMessage key={msg.id} message={msg} />
        ) : (
          <AssistantMessage
            key={msg.id}
            message={msg}
            isStreaming={msg.id === 'mock-showcase-reasoning-streaming'}
            editor={null}
          />
        )
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          data-testid="mock-showcase-seed"
          onClick={() => { void seedDemo(); }}
          className="btn"
          style={{ fontSize: 'var(--fs-sm)' }}
        >
          {seeded ? 'Demo bubbles added — send a message to stream live' : 'Insert demo bubbles into this thread'}
        </button>
        {seedError && (
          <p role="alert" data-testid="mock-showcase-seed-error" style={{ fontSize: 'var(--fs-sm)', color: '#e53e3e' }}>
            {seedError}
          </p>
        )}
      </div>
    </div>
  );
}
