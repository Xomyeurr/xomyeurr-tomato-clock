import { fail, succeed, type CommandResult } from './result';
import { formatTimestamp } from './time';
import type { AppState, Commitment, CommitmentSchedule, Context, Weekday } from './types';
import { isValidDate } from './validation';
import { validRanges } from './work-hours';
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type Fields = { title: string; projectId: string | null; schedule: CommitmentSchedule };
export type CommitmentCommand =
  | ({ type: 'createCommitment' } & Fields)
  | ({ type: 'updateCommitment'; commitmentId: string } & Fields)
  | { type: 'archiveCommitment'; commitmentId: string }
  | { type: 'deleteCommitment'; commitmentId: string }
  | { type: 'skipCommitment'; commitmentId: string; date: string };

export function getCommitmentsForDate(state: AppState, date: string): Commitment[] {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  return state.commitments.filter(c => {
    if (c.status !== 'active' || c.skippedDates.includes(date)) return false;
    const s = c.schedule;
    return s.type === 'once' ? s.date === date : s.fromDate <= date &&
      (s.untilDate === null || s.untilDate >= date) && s.weekdays.includes(weekday);
  });
}

export function applyCommitmentCommand(state: AppState, command: CommitmentCommand, ctx: Context): CommandResult {
  const ts = formatTimestamp(ctx.now, state.settings.timezone);
  if (command.type !== 'createCommitment' && !state.commitments.some(c => c.id === command.commitmentId)) return fail('commitment_not_found', '找不到固定行程');
  if (command.type === 'archiveCommitment') {
    return succeed({ ...state, commitments: state.commitments.map(c => c.id === command.commitmentId ? { ...c, status: 'archived', updatedAt: ts } : c) });
  }
  if (command.type === 'deleteCommitment') {
    return succeed({ ...state, commitments: state.commitments.filter(c => c.id !== command.commitmentId) });
  }
  if (command.type === 'skipCommitment') {
    if (!isValidDate(command.date)) return fail('invalid_date', '日期格式不正確');
    return succeed({ ...state, commitments: state.commitments.map(c => c.id === command.commitmentId ?
      { ...c, skippedDates: [...new Set([...c.skippedDates, command.date])], updatedAt: ts } : c) });
  }
  const s = command.schedule;
  const valid = validRanges([s]) && (s.type === 'once' ? isValidDate(s.date) :
    s.type === 'weekly' && s.weekdays.length > 0 && s.weekdays.every(w => WEEKDAYS.includes(w)) && isValidDate(s.fromDate) &&
    (s.untilDate === null || (isValidDate(s.untilDate) && s.untilDate >= s.fromDate)));
  if (!command.title.trim() || !valid) return fail('invalid_commitment', '請輸入行程名稱、有效日期、星期與起訖時間');
  if (command.projectId !== null && !state.projects.some(p => p.id === command.projectId && p.kind === 'project')) return fail('project_not_found', '找不到連結的專案');
  const fields = { title: command.title.trim(), projectId: command.projectId, schedule: s.type === 'weekly' ? { ...s, weekdays: [...s.weekdays] } : { ...s }, updatedAt: ts };
  return succeed({ ...state, commitments: command.type === 'createCommitment' ?
    [...state.commitments, { ...fields, id: ctx.newId('cmt'), skippedDates: [], status: 'active', createdAt: ts }] :
    state.commitments.map(c => c.id === command.commitmentId ? { ...c, ...fields } : c) });
}
