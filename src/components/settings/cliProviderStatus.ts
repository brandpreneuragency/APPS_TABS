import type { CliProviderProbe } from '../../services/providers/desktopClient';

export interface CliProviderState {
  probe?: CliProviderProbe;
  loading?: boolean;
  error?: string;
}

export type CliProviderStatus = 'notChecked' | 'checking' | 'checkFailed' | 'notInstalled'
  | 'signedIn' | 'signInRequired' | 'signInUnknown';

export function cliProviderStatus(state?: CliProviderState): CliProviderStatus {
  if (state?.loading) return 'checking';
  if (state?.error) return 'checkFailed';
  if (!state?.probe) return 'notChecked';
  if (!state.probe.installed) return 'notInstalled';
  if (state.probe.authState === 'authenticated') return 'signedIn';
  if (state.probe.authState === 'notAuthenticated') return 'signInRequired';
  return 'signInUnknown';
}
