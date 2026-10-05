import { useSyncExternalStore } from 'react';
import { mockProviderSessionService } from './mockSessionService';

export function useMockProviderService() {
  return useSyncExternalStore(mockProviderSessionService.subscribe, mockProviderSessionService.snapshot);
}
