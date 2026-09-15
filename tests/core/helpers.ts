import { apply, type AppState, type Command, type Context } from '../../src/core';

export function applyOk(state: AppState, command: Command, ctx: Context): AppState {
  const result = apply(state, command, ctx);
  if (!result.ok) throw new Error(`expected ${command.type} to succeed, got: ${result.error.message}`);
  return result.state;
}

export function at(iso: string): Date {
  return new Date(iso);
}

export function sequentialIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}
