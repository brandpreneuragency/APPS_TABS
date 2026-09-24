import { useEffect, useState } from 'react';
import { codexSessionService } from './sessionService';

export function useCodexService() {
  const [snapshot, setSnapshot] = useState(() => codexSessionService.snapshot());
  useEffect(() => codexSessionService.subscribe(() => setSnapshot(codexSessionService.snapshot())), []);
  return snapshot;
}
