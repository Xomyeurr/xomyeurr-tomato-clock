import { getCommitmentsForDate } from './commitments';
import { getWorkRanges } from './day';
import { reconcileTimers } from './sessions';
import { formatTimestamp, localDateTime, nextDate } from './time';
import type { AppState, WorkSession } from './types';

export interface TimelineEntry {
  id: string;
  kind: 'workHours' | 'commitment' | 'session';
  title: string;
  startedAt: string;
  endedAt: string | null;
  note: string;
  outcome: WorkSession['outcome'];
  adHoc: boolean;
  endTimeUnconfirmed: boolean;
}
export function getDayTimeline(state: AppState, now: Date): TimelineEntry[] {
  state = reconcileTimers(state, now);
  const zone = state.settings.timezone;
  const date = formatTimestamp(now, zone).slice(0, 10);
  const start = localDateTime(date, '00:00', zone).getTime();
  const end = localDateTime(nextDate(date), '00:00', zone).getTime();
  const timestamp = (time: string) => formatTimestamp(localDateTime(date, time, zone), zone);
  const defaults = { note: '', outcome: null, adHoc: false, endTimeUnconfirmed: false };
  const entries: TimelineEntry[] = [
    ...getWorkRanges(state, date).map((r, i) => ({ ...defaults, id: `hours-${i}`, kind: 'workHours' as const, title: '上班時段', startedAt: timestamp(r.start), endedAt: timestamp(r.end) })),
    ...getCommitmentsForDate(state, date).map(c => ({ ...defaults, id: c.id, kind: 'commitment' as const, title: c.title, startedAt: timestamp(c.schedule.start), endedAt: timestamp(c.schedule.end) })),
    ...state.sessions.filter(s => Date.parse(s.startedAt) < end && (s.endedAt ? Date.parse(s.endedAt) > start : now.getTime() >= start)).map(s => ({ ...s, kind: 'session' as const, title: state.tasks.find(t => t.id === s.taskId)?.title ?? '工作' })),
  ];
  return entries.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
}
