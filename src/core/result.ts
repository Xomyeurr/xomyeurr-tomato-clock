import type { AppState } from './types';

export interface CommandError {
  code: string;
  message: string;
}

export type CommandResult = { ok: true; state: AppState } | { ok: false; error: CommandError };

export const fail = (code: string, message: string): CommandResult => ({ ok: false, error: { code, message } });
export const succeed = (state: AppState): CommandResult => ({ ok: true, state });
