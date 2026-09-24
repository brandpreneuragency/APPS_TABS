import { isTauriRuntime } from '../runtime';
import type { CliProviderId } from './desktopClient';

export interface CliProviderRunRequest {
  runId: string;
  providerId: CliProviderId;
  modelId: string;
  reasoningEffort?: string;
  prompt: string;
  workspaceRoot: string;
}

export interface CliProviderRunResult {
  runId: string;
  status: 'completed' | 'stopped';
  text: string;
}

export async function runCliProvider(request: CliProviderRunRequest): Promise<CliProviderRunResult> {
  if (!isTauriRuntime()) throw new Error('CLI chat requires the TABS desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CliProviderRunResult>('cli_provider_run', { request });
}

export async function stopCliProvider(runId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cli_provider_stop', { runId });
}

export async function cliProviderDefaultWorkspace(): Promise<string> {
  if (!isTauriRuntime()) throw new Error('CLI chat requires the TABS desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('cli_provider_default_workspace');
}
