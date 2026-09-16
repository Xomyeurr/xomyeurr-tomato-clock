import { expect, test } from 'vitest';
import { createInitialState, getDaySummary, getDayTimeline, getLockedTimeBlocks, getSuggestedTimeBlocks } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

test('today only includes future working ranges and weekends default to no work', () => {
  const state = createInitialState({ now: at('2026-09-15T10:00:00+08:00'), newId: sequentialIds() });
  expect(getDaySummary(state, at('2026-09-15T10:00:00+08:00')).remainingMinutes).toBe(420);
  expect(getDaySummary(state, at('2026-09-19T10:00:00+08:00')).remainingMinutes).toBe(0);
});

test('a date override replaces the template, including a day off, and uses the configured timezone', async () => {
  const { apply } = await import('../../src/core');
  const ctx = { now: at('2026-09-15T17:00:00Z'), newId: sequentialIds() };
  const initial = createInitialState(ctx);
  const result = apply(initial, { type: 'setDayWorkHours', date: '2026-09-16', ranges: [{ start: '09:00', end: '15:00' }] }, ctx);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(getDaySummary(result.state, ctx.now)).toMatchObject({ date: '2026-09-16', remainingMinutes: 360 });
  const off = apply(result.state, { type: 'setDayWorkHours', date: '2026-09-16', ranges: [] }, ctx);
  expect(off.ok && getDaySummary(off.state, ctx.now).remainingMinutes).toBe(0);
});

test('weekly hours and cycle adjustments validate ranges and only override today', async () => {
  const { apply } = await import('../../src/core');
  const { applyOk } = await import('./helpers');
  const ctx = { now: at('2026-09-15T10:00:00+08:00'), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'setWeeklyWorkHours', weekday: 'tue', ranges: [{ start: '09:00', end: '17:00' }] }, ctx);
  state = applyOk(state, { type: 'shiftWorkdayEnd', direction: -1 }, ctx);
  expect(getDaySummary(state, ctx.now).remainingMinutes).toBe(360);
  state = applyOk(state, { type: 'shiftWorkdayEnd', direction: 1 }, ctx);
  expect(getDaySummary(state, ctx.now).remainingMinutes).toBe(420);
  expect(state.workHours.weekly.tue).toEqual([{ start: '09:00', end: '17:00' }]);
  for (const ranges of [[{ start: '12:00', end: '09:00' }], [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]]) {
    expect(apply(state, { type: 'setWeeklyWorkHours', weekday: 'tue', ranges }, ctx).ok).toBe(false);
  }
  state = applyOk(state, { type: 'resetDayWorkHours', date: '2026-09-15' }, ctx);
  expect(state.workHours.dayOverrides).toEqual({});
});

test('day scheduling surfaces consistently subtract Commitments from available work time', () => {
  const ctx = { now: at('2026-09-15T08:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '交付功能', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
  const projectId = state.projects[1]!.id;
  state = applyOk(state, { type: 'createTask', projectId, title: '實作' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '早會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '09:00', end: '10:00' } }, ctx);

  expect(getDaySummary(state, ctx.now).remainingMinutes).toBe(420);
  expect(getDayTimeline(state, ctx.now).filter(e => e.kind === 'workHours').map(e => [e.startedAt.slice(11, 16), e.endedAt?.slice(11, 16)])).toEqual([
    ['10:00', '12:00'],
    ['13:00', '18:00'],
  ]);
  expect(getSuggestedTimeBlocks(state, ctx.now).every(block => block.end <= '09:00' || block.start >= '10:00')).toBe(true);

  state = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '10:00', end: '12:00' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '補會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' } }, ctx);
  expect(getLockedTimeBlocks(state, '2026-09-15').map(block => [block.start, block.end])).toEqual([['11:00', '12:00']]);
});
