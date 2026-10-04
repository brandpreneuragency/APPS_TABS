import { invoke } from '@tauri-apps/api/core';
export const saveTaskAcceptanceResult = (report: unknown) => invoke('tasks_acceptance_report', { report });
