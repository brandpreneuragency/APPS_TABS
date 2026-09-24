import { isTauriRuntime } from '../runtime';
import type { ProviderId } from './modelVisibility';

export type CliProviderId = Exclude<ProviderId, 'codex'>;

export interface CliProviderModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  reasoningEfforts: string[];
}

export interface CliProviderProbe {
  providerId: CliProviderId;
  installed: boolean;
  executablePath?: string;
  version?: string;
  authState: 'authenticated' | 'notAuthenticated' | 'unknown';
  models: CliProviderModel[];
  error?: string;
}

/** Only the desktop adapter can ask an installed CLI about its state. */
export async function probeCliProvider(providerId: CliProviderId): Promise<CliProviderProbe> {
  if (!isTauriRuntime()) throw new Error('CLI discovery requires the TABS desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CliProviderProbe>('cli_provider_probe', { providerId });
}
