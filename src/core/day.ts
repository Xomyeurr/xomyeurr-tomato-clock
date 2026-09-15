import { reconcileTimers } from './sessions';
import { getCommitmentsForDate } from './commitments';
import { formatTimestamp, localDateTime, nextDate } from './time';
import type { AppState, TimeRange, Weekday } from './types';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function getWorkRanges(state: AppState, date: string): TimeRange[] {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  return state.workHours.dayOverrides[date] ?? state.workHours.weekly[weekday];
}

type Interval = { start: number; end: number };
function totalMinutes(ranges: Interval[]): number {
  const sorted = ranges.filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
  let end = -Infinity;
  let total = 0;
  for (const r of sorted) {
    total += Math.max(0, r.end - Math.max(r.start, end));
    end = Math.max(end, r.end);
  }
  return total / 60_000;
}
function intersect(a: Interval[], b: Interval[]): Interval[] {
  return a.flatMap(x => b.map(y => ({ start: Math.max(x.start, y.start), end: Math.min(x.end, y.end) })));
}
export function getDaySummary(state: AppState, now: Date) {
  state = reconcileTimers(state, now);
  const zone = state.settings.timezone;
  const date = formatTimestamp(now, zone).slice(0, 10);
  const start = localDateTime(date, '00:00', zone).getTime();
  const end = localDateTime(nextDate(date), '00:00', zone).getTime();
  const past = [{ start, end: Math.min(end, now.getTime()) }];
  const future = [{ start: Math.max(start, now.getTime()), end }];
  const timedRange = (r: TimeRange): Interval => ({ start: localDateTime(date, r.start, zone).getTime(), end: localDateTime(date, r.end, zone).getTime() });
  const work = getWorkRanges(state, date).map(timedRange);
  const commitments = getCommitmentsForDate(state, date).map(c => timedRange(c.schedule));
  const sessionRange = (s: AppState['sessions'][number]): Interval => ({ start: Date.parse(s.startedAt), end: s.endedAt ? Date.parse(s.endedAt) :
    Math.min(now.getTime(), s.mode === 'pomodoro' ? Date.parse(s.startedAt) + state.settings.pomodoro.focusMinutes * 60_000 : Infinity) });
  const planned = intersect(state.sessions.filter(s => !s.adHoc).map(sessionRange), past);
  const adHoc = intersect(state.sessions.filter(s => s.adHoc).map(sessionRange), past);
  const elapsedCommitments = intersect(commitments, past);
  const futureWork = intersect(work, future);
  return {
    date,
    remainingMinutes: totalMinutes(futureWork) - totalMinutes(intersect(futureWork, commitments)),
    plannedMinutes: totalMinutes(planned),
    adHocMinutes: totalMinutes(adHoc),
    commitmentMinutes: totalMinutes(elapsedCommitments) - totalMinutes(intersect(elapsedCommitments, [...planned, ...adHoc])),
  };
}
