import { type AppState, apply, type Command, type CommandResult, type Context, createInitialState } from '../core';

const SCHEMA_VERSION = 1;
const STATE_KEYS = ['settings', 'requesters', 'projects', 'tasks'] as const;
const MONTHLY_LISTS = [
  { prefix: 'sessions/', field: 'sessions', monthOf: (item: { startedAt: string }) => item.startedAt.slice(0, 7) },
  { prefix: 'overrides/', field: 'overrides', monthOf: (item: { at: string }) => item.at.slice(0, 7) },
] as const;

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const random = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
  return `${prefix}_${random}`;
}

function context(): Context {
  return { now: new Date(), newId };
}

function toEntries(state: AppState): Record<string, unknown> {
  const entries: Record<string, unknown> = { meta: { schemaVersion: SCHEMA_VERSION } };
  for (const key of STATE_KEYS) entries[key] = state[key];
  for (const list of MONTHLY_LISTS) {
    for (const item of state[list.field]) {
      const key = `${list.prefix}${list.monthOf(item as never)}`;
      ((entries[key] ??= []) as unknown[]).push(item);
    }
  }
  return entries;
}

function fromEntries(entries: Record<string, unknown>): AppState {
  const state = Object.fromEntries(STATE_KEYS.map((key) => [key, entries[key]])) as Pick<AppState, (typeof STATE_KEYS)[number]>;
  const monthly = Object.fromEntries(
    MONTHLY_LISTS.map((list) => [
      list.field,
      Object.keys(entries)
        .filter((key) => key.startsWith(list.prefix))
        .sort()
        .flatMap((key) => entries[key] as unknown[]),
    ]),
  ) as Pick<AppState, 'sessions' | 'overrides'>;
  return { ...state, ...monthly };
}

export async function loadState(): Promise<AppState> {
  const entries = await chrome.storage.local.get(null);
  if (!entries.settings) {
    const initial = createInitialState(context());
    await chrome.storage.local.set(toEntries(initial));
    return initial;
  }
  return fromEntries(entries);
}

export async function runCommand(command: Command): Promise<CommandResult> {
  const state = await loadState();
  const result = apply(state, command, context());
  if (result.ok) await chrome.storage.local.set(toEntries(result.state));
  return result;
}

export function onStateChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') listener();
  });
}
