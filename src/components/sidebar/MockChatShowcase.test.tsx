import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../../services/db';
import { useChatStore } from '../../stores/chatStore';
import { MockChatShowcase } from './MockChatShowcase';

beforeEach(async () => {
  cleanup();
  await db.delete();
  await db.open();
  useChatStore.setState({
    threads: [], activeThreadId: null, messagesByThread: {}, currentContext: null, lastViewedPerContext: {},
  });
});

describe('MockChatShowcase', () => {
  it('renders reasoning, answer, and all three tool-call states', () => {
    render(<MockChatShowcase threadId="thread-mock" />);

    expect(screen.getByTestId('mock-chat-showcase')).toBeInTheDocument();
    // Reasoning boxes (streaming + done).
    expect(screen.getAllByText(/Reasoning/).length).toBeGreaterThanOrEqual(2);
    // Rendered markdown answer sections.
    expect(screen.getByText('Demo answer')).toBeInTheDocument();
    // Tool bubbles: pending approval, executed, rejected.
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText(/awaiting approval/i)).toBeInTheDocument();
    expect(screen.getByText('executed')).toBeInTheDocument();
    expect(screen.getByText('rejected')).toBeInTheDocument();
  });

  it('seeds demo bubbles into the active mock thread', async () => {
    await db.chatThreads.add({
      id: 'thread-mock', origin: 'mockTools', mode: 'writer', title: 'Mock', createdAt: 1, updatedAt: 1,
    });
    render(<MockChatShowcase threadId="thread-mock" />);

    fireEvent.click(screen.getByTestId('mock-showcase-seed'));
    let messages = await db.chatMessages.where('threadId').equals('thread-mock').toArray();
    await waitFor(async () => {
      messages = await db.chatMessages.where('threadId').equals('thread-mock').toArray();
      expect(messages.length).toBeGreaterThan(0);
    });
    expect(messages.some((m) => m.role === 'tool_call' && m.toolCall?.status === 'pending')).toBe(true);
    expect(messages.some((m) => m.role === 'tool_call' && m.toolCall?.status === 'done')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant' && m.content.includes('<think>'))).toBe(true);
  });
});
