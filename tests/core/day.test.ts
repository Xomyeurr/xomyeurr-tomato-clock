import { expect, test } from 'vitest';
import { createInitialState, getDaySummary } from '../../src/core';
import { at, sequentialIds } from './helpers';

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
