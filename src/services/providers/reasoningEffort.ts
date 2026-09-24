import type { CliProviderId, CliProviderModel } from './desktopClient';

/** Keep CLI effort choices with the model that advertised them. */
export function cliReasoningEffortSettingKey(providerId: CliProviderId, modelId: string): string {
  return `providerReasoningEffort:${providerId}:${modelId}`;
}

export function supportedCliReasoningEffort(model: CliProviderModel, value: unknown): string | undefined {
  return typeof value === 'string' && model.reasoningEfforts.includes(value) ? value : undefined;
}
