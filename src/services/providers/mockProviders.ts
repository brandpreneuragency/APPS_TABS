import type { ChatProviderId } from '../../types';
import type { CliProviderModel } from './desktopClient';

export type MockProviderId = 'mockEcho' | 'mockTools';

export const mockProviderIds: MockProviderId[] = ['mockEcho', 'mockTools'];

export function isMockProviderId(value: unknown): value is MockProviderId {
  return value === 'mockEcho' || value === 'mockTools';
}

export function isMockChatProvider(value: unknown): value is MockProviderId {
  return isMockProviderId(value);
}

export const mockProviderNames: Record<MockProviderId, string> = {
  mockEcho: 'Mock Echo',
  mockTools: 'Mock Tools',
};

export function mockProviderDisplayName(providerId: ChatProviderId): string {
  if (isMockProviderId(providerId)) return mockProviderNames[providerId];
  if (providerId === 'grok') return 'Grok';
  if (providerId === 'commandCode') return 'Command Code';
  if (providerId === 'openCode') return 'OpenCode';
  return 'Codex';
}

/** Static catalogue so mocks work in browser + desktop without a CLI probe. */
export const mockProviderModels: Record<MockProviderId, CliProviderModel[]> = {
  mockEcho: [
    { id: 'mock-echo-1', displayName: 'Mock Echo 1', isDefault: true, reasoningEfforts: ['low', 'high'] },
  ],
  mockTools: [
    { id: 'mock-tools-1', displayName: 'Mock Tools 1', isDefault: true, reasoningEfforts: ['low', 'high'] },
  ],
};

export function buildMockEchoAnswer(userText: string): { reasoning: string; answer: string } {
  const trimmed = userText.trim() || '(empty message)';
  return {
    reasoning: `Deciding how to echo this message.\nInput length: ${trimmed.length} chars.`,
    answer: `### Echo\n\nYou said:\n\n> ${trimmed}\n\n### Notes\n\nThis is a local mock response for UI testing. No network or CLI was used.`,
  };
}

export function buildMockToolsAnswer(userText: string): { reasoning: string; answer: string } {
  const trimmed = userText.trim() || '(empty message)';
  return {
    reasoning: `Planning tool calls for: "${trimmed.slice(0, 80)}".\nWill run shell_exec, then summarize.`,
    answer: `### Result\n\nMock tool run finished for:\n\n> ${trimmed}\n\nCheck the tool bubbles above for pending → done states.`,
  };
}
