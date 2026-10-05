import { describe, expect, it } from 'vitest';
import {
  buildMockEchoAnswer, buildMockToolsAnswer, isMockProviderId, mockProviderDisplayName, mockProviderModels,
} from './mockProviders';

describe('mock providers', () => {
  it('identifies only mock ids and names every provider', () => {
    expect(isMockProviderId('mockEcho')).toBe(true);
    expect(isMockProviderId('mockTools')).toBe(true);
    expect(isMockProviderId('grok')).toBe(false);
    expect(isMockProviderId('codex')).toBe(false);
    expect(mockProviderDisplayName('mockEcho')).toBe('Mock Echo');
    expect(mockProviderDisplayName('mockTools')).toBe('Mock Tools');
    expect(mockProviderDisplayName('grok')).toBe('Grok');
  });

  it('exposes a static model catalogue with defaults', () => {
    for (const providerId of ['mockEcho', 'mockTools'] as const) {
      expect(mockProviderModels[providerId].length).toBeGreaterThan(0);
      expect(mockProviderModels[providerId].some((model) => model.isDefault)).toBe(true);
    }
  });

  it('builds echo and tool answers containing reasoning plus markdown', () => {
    const echo = buildMockEchoAnswer('hello mocks');
    expect(echo.reasoning.length).toBeGreaterThan(0);
    expect(echo.answer).toContain('hello mocks');
    expect(echo.answer).toContain('###');

    const tools = buildMockToolsAnswer('run checks');
    expect(tools.reasoning.length).toBeGreaterThan(0);
    expect(tools.answer).toContain('run checks');
  });
});
