import type { SettingsSubTab } from '../../stores/uiStore';

const SECTION_LABELS: Record<SettingsSubTab, string> = {
  tools: 'Tools (Codex connection, models, and reasoning)',
  actions: 'Actions',
  appearance: 'Appearance',
  agents: 'Agents',
};

/**
 * Safe system context for Settings AI chats.
 * Must never include API keys, tokens, secure-storage values, or raw secrets.
 */
export function buildSettingsAIContext(activeSettingsSubTab: SettingsSubTab): string {
  const section = SECTION_LABELS[activeSettingsSubTab] ?? activeSettingsSubTab;
  return [
    '[Application context]',
    'The user is currently in TABS Settings.',
    `Active settings section: ${section}.`,
    'Help explain this section and draft or improve configuration content such as',
    'action prompts, agent instructions, Codex setup guidance, appearance settings,',
    'and tool configuration. Never expose secret values or claim a setting was',
    'changed unless the application actually performed that change.',
    'Never request, repeat, or invent API keys or credentials.',
  ].join('\n');
}

export function settingsSectionLabel(tab: SettingsSubTab): string {
  return SECTION_LABELS[tab] ?? tab;
}
