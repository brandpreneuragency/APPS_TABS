import { invoke } from '@tauri-apps/api/core';
import { decodeReply, type Request, type Row } from './model';
import type { TaskTransport } from './engine';

export const desktopTaskTransport: TaskTransport = {
  async request(request: Request) {
    const reply: unknown = await invoke('task_authority_rpc', { request });
    return decodeReply(reply);
  },
  async backup(records: Row[]) {
    return invoke<{ path: string }>('task_authority_backup', { records });
  },
};
