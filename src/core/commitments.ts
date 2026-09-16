import { fail, succeed, type CommandResult } from './result';
import { formatTimestamp } from './time';
import type { AppState, Commitment, CommitmentSchedule, Context, TimeBlock, TimeRange, Weekday } from './types';
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

const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function subtractRanges(range: TimeRange, blockers: TimeRange[]): TimeRange[] {
  let cursor = minute(range.start);
  const end = minute(range.end);
  const parts: TimeRange[] = [];
  for (const blocker of [...blockers].sort((a, b) => a.start.localeCompare(b.start))) {
    const blockerStart = minute(blocker.start);
    const blockerEnd = minute(blocker.end);
    if (blockerEnd <= cursor || blockerStart >= end) continue;
    if (blockerStart > cursor) parts.push({ start: clock(cursor), end: clock(Math.min(blockerStart, end)) });
    cursor = Math.max(cursor, blockerEnd);
  }
  if (cursor < end) parts.push({ start: clock(cursor), end: clock(end) });
  return parts;
}

function reconcileLockedTimeBlocks(state: AppState, ctx: Context, updatedAt: string): AppState {
  // 只整理今天以後的鎖定時段。重複性的 Commitment 可以從過去的日期開始,
  // 但已經發生的鎖定時段是歷史紀錄,不能被回頭改寫或刪掉。
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(ctx.now);
  const timeBlocks: TimeBlock[] = [];
  for (const block of state.timeBlocks) {
    if (block.date < today) { timeBlocks.push(block); continue; }
    const blockers = getCommitmentsForDate(state, block.date).map(c => ({ start: c.schedule.start, end: c.schedule.end }));
    const parts = subtractRanges(block, blockers);
    parts.forEach((part, index) => {
      timeBlocks.push({ ...block, id: index === 0 ? block.id : ctx.newId('blk'), start: part.start, end: part.end,
        createdAt: index === 0 ? block.createdAt : updatedAt, updatedAt: part.start === block.start && part.end === block.end ? block.updatedAt : updatedAt });
    });
  }
  return { ...state, timeBlocks };
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
  const commitments: Commitment[] = command.type === 'createCommitment' ?
    [...state.commitments, { ...fields, id: ctx.newId('cmt'), skippedDates: [], status: 'active', createdAt: ts }] :
    state.commitments.map(c => c.id === command.commitmentId ? { ...c, ...fields } : c);
  const next = { ...state, commitments };
  return succeed(reconcileLockedTimeBlocks(next, ctx, ts));
}
