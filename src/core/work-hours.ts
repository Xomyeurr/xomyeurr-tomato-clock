import { fail, succeed, type CommandResult } from './result';
import { formatTimestamp } from './time';
import { getWorkRanges } from './day';
import { isValidDate } from './validation';
import type { AppState, Context, TimeRange, Weekday } from './types';

export type WorkHoursCommand =
  | { type: 'setDayWorkHours'; date: string; ranges: TimeRange[] }
  | { type: 'setWeeklyWorkHours'; weekday: Weekday; ranges: TimeRange[] }
  | { type: 'resetDayWorkHours'; date: string }
  | { type: 'shiftWorkdayEnd'; direction: 1 | -1 };

export function validRanges(ranges: TimeRange[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  return sorted.every((r, i) => /^([01]\d|2[0-3]):[0-5]\d$/.test(r.start) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(r.end) && r.end > r.start &&
    (i === 0 || sorted[i - 1]!.end <= r.start));
}

export function applyWorkHoursCommand(state: AppState, command: WorkHoursCommand, ctx: Context): CommandResult {
  const updatedAt = formatTimestamp(ctx.now, state.settings.timezone);
  if (command.type === 'setDayWorkHours') {
    if (!isValidDate(command.date) || !validRanges(command.ranges)) return fail('invalid_work_hours', '請輸入有效日期與不重疊的上班時段');
    return succeed({ ...state, workHours: { ...state.workHours, updatedAt,
      dayOverrides: { ...state.workHours.dayOverrides, [command.date]: [...command.ranges].sort((a, b) => a.start.localeCompare(b.start)) } } });
  }
  if (command.type === 'setWeeklyWorkHours') {
    if (!(command.weekday in state.workHours.weekly) || !validRanges(command.ranges)) return fail('invalid_work_hours', '上班時段必須有效且不能重疊');
    return succeed({ ...state, workHours: { ...state.workHours, updatedAt,
      weekly: { ...state.workHours.weekly, [command.weekday]: [...command.ranges].sort((a, b) => a.start.localeCompare(b.start)) } } });
  }
  if (command.type === 'resetDayWorkHours') {
    if (!isValidDate(command.date)) return fail('invalid_date', '日期格式不正確');
    const dayOverrides = { ...state.workHours.dayOverrides };
    delete dayOverrides[command.date];
    return succeed({ ...state, workHours: { ...state.workHours, dayOverrides, updatedAt } });
  }
  const date = updatedAt.slice(0, 10);
  const ranges = getWorkRanges(state, date).map(r => ({ ...r }));
  const last = ranges.at(-1);
  if (!last || ![1, -1].includes(command.direction)) return fail('invalid_work_hours', '今天沒有可調整的上班時段');
  const end = Number(last.end.slice(0, 2)) * 60 + Number(last.end.slice(3)) + command.direction * (state.settings.pomodoro.focusMinutes + state.settings.pomodoro.breakMinutes);
  if (end < 0 || end >= 1440) return fail('invalid_work_hours', '下班時間不能跨日');
  last.end = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  return applyWorkHoursCommand(state, { type: 'setDayWorkHours', date, ranges }, ctx);
}
