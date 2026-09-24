import { useSyncExternalStore } from 'react';
import { cliProviderSessionService } from './sessionService';

export function useCliProviderService() {
  return useSyncExternalStore(cliProviderSessionService.subscribe, cliProviderSessionService.snapshot);
}
