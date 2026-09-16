import { formatTimestamp } from './time';
import type { AppState } from './types';

export const DATA_SCHEMA_VERSION = 3;

type ExportableItem = { startedAt?: string; date?: string; at?: string };

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function listFile(items: unknown[]): string {
  return pretty({ schemaVersion: DATA_SCHEMA_VERSION, items });
}

function monthOf(item: ExportableItem): string {
  return (item.startedAt ?? item.date ?? item.at ?? '').slice(0, 7);
}

function appendMonthly(files: Record<string, string>, path: string, item: unknown): void {
  const parsed: { schemaVersion: number; items: unknown[] } = files[path]
    ? JSON.parse(files[path]) as { schemaVersion: number; items: unknown[] }
    : { schemaVersion: DATA_SCHEMA_VERSION, items: [] };
  parsed.items.push(item);
  files[path] = pretty(parsed);
}

export function exportDataFiles(state: AppState, exportedAt: Date): Record<string, string> {
  const files: Record<string, string> = {
    'meta.json': pretty({
      schemaVersion: DATA_SCHEMA_VERSION,
      exportedAt: formatTimestamp(exportedAt, state.settings.timezone),
    }),
    'settings.json': pretty({ schemaVersion: DATA_SCHEMA_VERSION, ...state.settings }),
    'requesters.json': listFile(state.requesters),
    'projects.json': listFile(state.projects),
    'tasks.json': listFile(state.tasks),
    'commitments.json': listFile(state.commitments),
    'work-hours.json': pretty({ schemaVersion: DATA_SCHEMA_VERSION, ...state.workHours }),
  };

  for (const session of state.sessions) {
    appendMonthly(files, `sessions/${monthOf(session)}.json`, session);
  }
  for (const block of state.timeBlocks) {
    appendMonthly(files, `time-blocks/${monthOf(block)}.json`, block);
  }
  for (const override of state.overrides) {
    appendMonthly(files, `overrides/${monthOf(override)}.json`, override);
  }

  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
