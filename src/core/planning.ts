import { getCommitmentsForDate } from './commitments';
import { getWorkRanges } from './day';
import { localDateTime, nextDate } from './time';
import type { AppState, DateString, Project, Task, TimeBlock } from './types';

const DAY = 86_400_000;
const previousDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
const parseMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function dayMinutes(state: AppState, date: DateString, fromNow?: Date): number {
  const zone = state.settings.timezone;
  const ranges = getWorkRanges(state, date).map(r => ({
    start: localDateTime(date, r.start, zone).getTime(), end: localDateTime(date, r.end, zone).getTime(),
  }));
  const commitments = getCommitmentsForDate(state, date).map(c => ({
    start: localDateTime(date, c.schedule.start, zone).getTime(), end: localDateTime(date, c.schedule.end, zone).getTime(),
  }));
  const start = fromNow ? fromNow.getTime() : -Infinity;
  const clipped = ranges.map(r => ({ start: Math.max(r.start, start), end: r.end })).filter(r => r.end > r.start);
  const cuts = commitments.flatMap(c => clipped.map(r => ({ start: Math.max(c.start, r.start), end: Math.min(c.end, r.end) }))).filter(r => r.end > r.start);
  const unionMinutes = (items: { start: number; end: number }[]) => {
    let total = 0; let end = -Infinity;
    for (const r of items.sort((a, b) => a.start - b.start)) { total += Math.max(0, r.end - Math.max(end, r.start)); end = Math.max(end, r.end); }
    return total / 60_000;
  };
  return Math.max(0, unionMinutes(clipped) - unionMinutes(cuts));
}

export function getProjectWorkedMinutes(state: AppState, projectId: string, now: Date): number {
  const taskIds = new Set(state.tasks.filter(t => t.projectId === projectId).map(t => t.id));
  return state.sessions.filter(s => taskIds.has(s.taskId)).reduce((sum, s) => {
    const end = s.endedAt ? Date.parse(s.endedAt) : now.getTime();
    return sum + Math.max(0, (end - Date.parse(s.startedAt)) / 60_000);
  }, 0);
}

export function getProjectRemainingMinutes(state: AppState, projectId: string, now: Date): number | null {
  const project = state.projects.find(p => p.id === projectId);
  if (!project || project.effortEstimateMinutes === null) return null;
  return project.effortEstimateMinutes - getProjectWorkedMinutes(state, projectId, now);
}

function getProjectWorkedOnDate(state: AppState, projectId: string, date: string, now: Date): number {
  const zone = state.settings.timezone;
  const start = localDateTime(date, '00:00', zone).getTime();
  const end = localDateTime(nextDate(date), '00:00', zone).getTime();
  const taskIds = new Set(state.tasks.filter(t => t.projectId === projectId).map(t => t.id));
  return state.sessions.filter(s => taskIds.has(s.taskId)).reduce((sum, s) => {
    const from = Math.max(start, Date.parse(s.startedAt));
    const to = Math.min(end, s.endedAt ? Date.parse(s.endedAt) : now.getTime());
    return sum + Math.max(0, (to - from) / 60_000);
  }, 0);
}

function getProjectLockedMinutesOnDate(state: AppState, projectId: string, date: string): number {
  return state.timeBlocks.filter(block => block.projectId === projectId && block.date === date)
    .reduce((sum, block) => sum + Math.max(0, parseMinute(block.end) - parseMinute(block.start)), 0);
}

export function averageWorkdayMinutes(state: AppState): number {
  const days = Object.values(state.workHours.weekly).filter(ranges => ranges.length);
  if (!days.length) return 0;
  return days.reduce((sum, ranges) => sum + ranges.reduce((n, r) => n + parseMinute(r.end) - parseMinute(r.start), 0), 0) / days.length;
}

export interface ScheduleWeight {
  total: number;
  deadlineUrgency: number;
  requester: number;
  manualPriority: number;
}

export function getAvailableMinutesUntil(state: AppState, now: Date, endDate: DateString): number {
  const zone = state.settings.timezone;
  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  let date = localToday;
  let total = 0;
  for (let i = 0; i <= 366 && date <= endDate; i++) {
    total += dayMinutes(state, date, i === 0 ? now : undefined);
    date = nextDate(date);
  }
  return total;
}

export function getScheduleWeight(state: AppState, project: Project, now: Date): ScheduleWeight {
  const remaining = getProjectRemainingMinutes(state, project.id, now) ?? 0;
  const urgency = project.endDate && remaining > 0
    ? Math.min(1, remaining / Math.max(0, getAvailableMinutesUntil(state, now, project.endDate))) : 0;
  const requester = state.requesters.find(r => r.id === project.requesterId)?.defaultWeight ?? 3;
  const requesterScore = ((project.requesterWeightOverride ?? requester) - 1) / 4;
  const manualScore = ((project.manualPriority ?? 3) - 1) / 4;
  const factors = state.settings.scheduleWeightFactors;
  return { deadlineUrgency: urgency, requester: requesterScore, manualPriority: manualScore,
    total: factors.deadlineUrgency * urgency + factors.requester * requesterScore + factors.manualPriority * manualScore };
}

export function getMustStartBy(state: AppState, projectId: string, now: Date): DateString | null {
  const project = state.projects.find(p => p.id === projectId);
  if (!project?.endDate || project.effortEstimateMinutes === null) return null;
  let need = Math.max(0, getProjectRemainingMinutes(state, projectId, now) ?? 0);
  let date = project.endDate;
  let found = project.endDate;
  for (let i = 0; i < 367 && need > 0; i++) {
    const available = dayMinutes(state, date);
    if (available > 0) { need -= available; found = date; }
    date = previousDate(date);
  }
  for (let i = 0; i < state.settings.mustStartBy.safetyBufferWorkdays; i++) {
    date = previousDate(found);
    let searched = 0;
    while (dayMinutes(state, date) === 0 && searched++ < 367) date = previousDate(date);
    if (searched >= 367 && dayMinutes(state, date) === 0) break;
    found = date;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(now);
  return found < today ? today : found;
}

export interface DeadlineRiskWarning { projectId: string; projectedCompletionDate: DateString | null; availableMinutes: number; remainingMinutes: number; conditions: string[] }
export function getDeadlineRiskWarning(state: AppState, projectId: string, now: Date): DeadlineRiskWarning | null {
  const project = state.projects.find(p => p.id === projectId);
  const remaining = getProjectRemainingMinutes(state, projectId, now);
  if (!project || project.status !== 'active' || !project.endDate || remaining === null) return null;
  let need = Math.max(0, remaining); let date = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(now); let projected: string | null = need <= 0 ? date : null;
  for (let i = 0; i <= 366 && projected === null; i++) { need -= dayMinutes(state, date, i === 0 ? now : undefined); if (need <= 0) projected = date; date = nextDate(date); }
  const available = getAvailableMinutesUntil(state, now, project.endDate);
  const threshold = { ...state.settings.deadlineRisk, ...(project.deadlineRiskOverride ?? {}) };
  const deadlineMs = Date.parse(`${project.endDate}T23:59:59Z`) + threshold.lateDays * DAY;
  const conditions: string[] = [];
  if (projected && Date.parse(`${projected}T23:59:59Z`) > deadlineMs) conditions.push('projected_completion_after_deadline');
  if (available < remaining * threshold.availablePercent / 100) conditions.push('available_time_below_threshold');
  return { projectId, projectedCompletionDate: projected, availableMinutes: available, remainingMinutes: remaining, conditions };
}

export function getSuggestedTimeBlocks(state: AppState, now: Date): TimeBlock[] {
  const zone = state.settings.timezone; const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  const available: { start: number; end: number }[] = getWorkRanges(state, date).map(r => ({ start: localDateTime(date, r.start, zone).getTime(), end: localDateTime(date, r.end, zone).getTime() })).map(r => ({ ...r, start: Math.max(r.start, now.getTime()) }));
  const commitments = getCommitmentsForDate(state, date).map(c => ({ start: localDateTime(date, c.schedule.start, zone).getTime(), end: localDateTime(date, c.schedule.end, zone).getTime() }));
  const locked = state.timeBlocks.filter(b => b.date === date).map(b => ({ start: localDateTime(date, b.start, zone).getTime(), end: localDateTime(date, b.end, zone).getTime() }));
  const free = available.flatMap(r => {
    const cuts = [...commitments, ...locked].sort((a, b) => a.start - b.start); let cursor = r.start; const out: { start: number; end: number }[] = [];
    for (const cut of cuts) { if (cut.end <= cursor || cut.start >= r.end) continue; if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, r.end) }); cursor = Math.max(cursor, cut.end); } if (cursor < r.end) out.push({ start: cursor, end: r.end }); return out;
  }).filter(r => r.end - r.start >= state.settings.pomodoro.focusMinutes * 60_000);
  const candidates = state.projects.filter(p => p.kind === 'project' && p.status === 'active' && state.tasks.some(t => t.projectId === p.id && t.status === 'open'));
  const scored = candidates.map(p => ({ project: p, score: getScheduleWeight(state, p, now).total, must: getMustStartBy(state, p.id, now) })).sort((a, b) => Number(b.must !== null && b.must <= date) - Number(a.must !== null && a.must <= date) || b.score - a.score || Date.parse(a.project.createdAt) - Date.parse(b.project.createdAt) || a.project.id.localeCompare(b.project.id));
  const unitMs = state.settings.pomodoro.focusMinutes * 60_000;
  const units = Math.floor(free.reduce((n, r) => n + r.end - r.start, 0) / unitMs);
  const allocations = new Map<string, number>(); for (const s of scored) allocations.set(s.project.id, 0);
  const must = scored.filter(s => s.must !== null && s.must <= date);
  const remainingGuarantees = must.map(s => ({ s, units: Math.max(0, Math.ceil((state.settings.mustStartBy.guaranteedMinutesPerDay - getProjectWorkedOnDate(state, s.project.id, date, now) - getProjectLockedMinutesOnDate(state, s.project.id, date)) / state.settings.pomodoro.focusMinutes)) }));
  const guaranteed = Math.min(units, remainingGuarantees.reduce((sum, item) => sum + item.units, 0));
  for (const item of remainingGuarantees) for (let i = 0; i < item.units && allocations.get(item.s.project.id)! < guaranteed; i++) allocations.set(item.s.project.id, allocations.get(item.s.project.id)! + 1);
  const remainingUnits = units - guaranteed;
  const weightTotal = scored.reduce((sum, s) => sum + Math.max(0, s.score), 0);
  const fractions = scored.map(s => ({ s, exact: weightTotal ? remainingUnits * Math.max(0, s.score) / weightTotal : 0 }));
  for (const f of fractions) allocations.set(f.s.project.id, allocations.get(f.s.project.id)! + Math.floor(f.exact));
  let leftovers = remainingUnits - fractions.reduce((sum, f) => sum + Math.floor(f.exact), 0);
  for (const f of [...fractions].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.s.project.id.localeCompare(b.s.project.id))) { if (!leftovers--) break; allocations.set(f.s.project.id, allocations.get(f.s.project.id)! + 1); }
  const result: TimeBlock[] = []; let cursor = 0;
  const clock = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  for (const range of free) { let at = range.start; while (at + unitMs <= range.end) { const selected = scored.find(s => (allocations.get(s.project.id) ?? 0) > 0); if (!selected) break; allocations.set(selected.project.id, allocations.get(selected.project.id)! - 1); result.push({ id: `suggested-${date}-${cursor++}`, projectId: selected.project.id, date, start: clock(at), end: clock(at + unitMs), createdAt: '', updatedAt: '' }); at += unitMs; } }
  return result;
}

export function getProjectTasks(state: AppState, projectId: string): Task[] { return state.tasks.filter(t => t.projectId === projectId && t.status === 'open'); }
