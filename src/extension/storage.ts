import { type AppState, apply, type Command, type CommandResult, type Context, createInitialState } from '../core';

const SCHEMA_VERSION = 3;
const STATE_KEYS = ['settings', 'requesters', 'projects', 'tasks', 'commitments'] as const;
const MONTHLY_LISTS = [
  { prefix: 'sessions/', field: 'sessions', monthOf: (item: { startedAt: string }) => item.startedAt.slice(0, 7) },
  { prefix: 'time-blocks/', field: 'timeBlocks', monthOf: (item: { date: string }) => item.date.slice(0, 7) },
  { prefix: 'overrides/', field: 'overrides', monthOf: (item: { at: string }) => item.at.slice(0, 7) },
] as const;

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}_${Array.from(bytes, b => (b % 36).toString(36)).join('')}`;
}
function context(): Context { return { now: new Date(), newId }; }

function toEntries(state: AppState): Record<string, unknown> {
  const entries: Record<string, unknown> = { meta: { schemaVersion: SCHEMA_VERSION }, 'work-hours': state.workHours };
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
  const state = Object.fromEntries(STATE_KEYS.map(key => [key, entries[key]])) as Pick<AppState, (typeof STATE_KEYS)[number]>;
  const monthly = Object.fromEntries(MONTHLY_LISTS.map(list => [list.field,
    Object.keys(entries).filter(key => key.startsWith(list.prefix)).sort().flatMap(key => entries[key] as unknown[]),
  ])) as Pick<AppState, 'sessions' | 'overrides' | 'timeBlocks'>;
  return { ...state, ...monthly, workHours: entries['work-hours'] as AppState['workHours'] };
}

function normaliseState(raw: AppState, ctx: Context): AppState {
  const defaults = createInitialState(ctx);
  return {
    ...defaults,
    ...raw,
    settings: {
      ...defaults.settings,
      ...raw.settings,
      pomodoro: { ...defaults.settings.pomodoro, ...(raw.settings?.pomodoro ?? {}) },
      freeTimer: { ...defaults.settings.freeTimer, ...(raw.settings?.freeTimer ?? {}) },
      scheduleWeightFactors: { ...defaults.settings.scheduleWeightFactors, ...(raw.settings?.scheduleWeightFactors ?? {}) },
      mustStartBy: { ...defaults.settings.mustStartBy, ...(raw.settings?.mustStartBy ?? {}) },
      deadlineRisk: { ...defaults.settings.deadlineRisk, ...(raw.settings?.deadlineRisk ?? {}) },
    },
    projects: (raw.projects ?? []).map(project => ({
      ...project,
      effortEstimateMinutes: project.effortEstimateMinutes ?? null,
      deadlineRiskOverride: project.deadlineRiskOverride ?? null,
    })),
    commitments: raw.commitments ?? [],
    timeBlocks: raw.timeBlocks ?? [],
    sessions: raw.sessions ?? [],
    overrides: raw.overrides ?? [],
  };
}

// Call only while holding the shared extension-origin lock.
async function loadUnlocked(ctx: Context): Promise<AppState> {
  const entries = await chrome.storage.local.get(null);
  const version = (entries.meta as { schemaVersion?: number } | undefined)?.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) throw new Error('資料來自較新版本,請先更新擴充套件');
  if (!entries.settings) {
    const initial = createInitialState(ctx);
    await chrome.storage.local.set(toEntries(initial));
    return initial;
  }
  const needsMigration = version < SCHEMA_VERSION || !entries['work-hours'] || !entries.commitments;
  entries['work-hours'] ??= entries.workHours ?? createInitialState(ctx).workHours;
  entries.commitments ??= [];
  const state = normaliseState(fromEntries(entries), ctx);
  const reconciled = apply(state, { type: 'reconcileTimers' }, ctx);
  const current = reconciled.ok ? reconciled.state : state;
  if (needsMigration || current !== state) await chrome.storage.local.set(toEntries(current));
  return current;
}

export async function loadState(): Promise<AppState> {
  return navigator.locks.request('tomato-clock-state', () => loadUnlocked(context()));
}
export async function runCommand(command: Command): Promise<CommandResult> {
  return navigator.locks.request('tomato-clock-state', async () => {
    const ctx = context();
    const state = await loadUnlocked(ctx);
    const result = apply(state, command, ctx);
    if (result.ok && result.state !== state) await chrome.storage.local.set(toEntries(result.state));
    return result;
  });
}
export function onStateChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') listener(); });
}
