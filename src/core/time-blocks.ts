import { getCommitmentsForDate } from './commitments';
import { getWorkRanges } from './day';
import { getSuggestedTimeBlocks } from './planning';
import { fail, succeed, type CommandResult } from './result';
import { formatTimestamp, localDateTime } from './time';
import type { AppState, Context, TimeBlock } from './types';
import { isValidDate } from './validation';

export type TimeBlockCommand =
  | { type: 'lockTimeBlock'; projectId: string; date: string; start: string; end: string }
  | { type: 'moveTimeBlock'; timeBlockId: string; date: string; start: string; end: string }
  | { type: 'unlockTimeBlock'; timeBlockId: string };

export function getLockedTimeBlocks(state: AppState, date: string): TimeBlock[] {
  return state.timeBlocks.filter(b => b.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

function interval(state: AppState, date: string, start: string, end: string): { start: number; end: number } {
  const zone = state.settings.timezone;
  return { start: localDateTime(date, start, zone).getTime(), end: localDateTime(date, end, zone).getTime() };
}
function validSlot(state: AppState, date: string, start: string, end: string, exceptId?: string): boolean {
  if (!isValidDate(date)) return false;
  let range: { start: number; end: number };
  try { range = interval(state, date, start, end); } catch { return false; }
  if (range.end <= range.start) return false;
  const workRanges = getWorkRanges(state, date).map(r => interval(state, date, r.start, r.end));
  if (!workRanges.some(work => work.start <= range.start && range.end <= work.end)) return false;
  const commitments = getCommitmentsForDate(state, date).map(c => interval(state, date, c.schedule.start, c.schedule.end));
  const blocks = state.timeBlocks.filter(b => b.id !== exceptId && b.date === date).map(b => interval(state, date, b.start, b.end));
  return ![...commitments, ...blocks].some(other => range.start < other.end && range.end > other.start);
}
function snapshot(block: { projectId: string; date: string; start: string; end: string }) {
  return { projectId: block.projectId, date: block.date, start: block.start, end: block.end };
}

export function applyTimeBlockCommand(state: AppState, command: TimeBlockCommand, ctx: Context): CommandResult {
  const ts = formatTimestamp(ctx.now, state.settings.timezone);
  if (command.type === 'unlockTimeBlock') {
    if (!state.timeBlocks.some(b => b.id === command.timeBlockId)) return fail('time_block_not_found', '找不到鎖定時段');
    return succeed({ ...state, timeBlocks: state.timeBlocks.filter(b => b.id !== command.timeBlockId) });
  }
  if (command.type === 'moveTimeBlock' && !state.timeBlocks.some(b => b.id === command.timeBlockId)) return fail('time_block_not_found', '找不到鎖定時段');
  const projectId = command.type === 'moveTimeBlock' ? state.timeBlocks.find(b => b.id === command.timeBlockId)?.projectId : command.projectId;
  if (!projectId || !state.projects.some(p => p.id === projectId && p.kind === 'project' && p.status === 'active')) return fail('project_not_found', '找不到可鎖定的專案');
  const id = command.type === 'moveTimeBlock' ? command.timeBlockId : undefined;
  if (!validSlot(state, command.date, command.start, command.end, id)) return fail('invalid_time_block', '時段無效、重疊或撞到固定行程');
  const actual = snapshot({ projectId, date: command.date, start: command.start, end: command.end });
  const previous = command.type === 'moveTimeBlock' ? state.timeBlocks.find(b => b.id === command.timeBlockId) : undefined;
  const suggested = previous ?? getSuggestedTimeBlocks(state, ctx.now).find(b => b.date === command.date && b.start === command.start && b.end === command.end);
  const override = { id: ctx.newId('ovr'), at: ts, type: 'lockedTimeBlock' as const, suggested: suggested ? snapshot(suggested) : null, actual };
  if (command.type === 'moveTimeBlock') {
    return succeed({ ...state, timeBlocks: state.timeBlocks.map(b => b.id === id ? { ...b, ...actual, updatedAt: ts } : b), overrides: [...state.overrides, override] });
  }
  const block: TimeBlock = { ...actual, id: ctx.newId('blk'), createdAt: ts, updatedAt: ts };
  return succeed({ ...state, timeBlocks: [...state.timeBlocks, block], overrides: [...state.overrides, override] });
}
