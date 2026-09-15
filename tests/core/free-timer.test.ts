import { expect, test } from 'vitest';
import { apply, createInitialState, getTimerStatus, SELF_REQUESTER_ID } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup(time = '2026-09-15T09:00:00+08:00') {
  const ctx = { now: at(time), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'createProject', name: '專案', requesterId: SELF_REQUESTER_ID, startDate: '2026-09-15' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: '工作' }, ctx);
  return { state, ctx, taskId: state.tasks[0]!.id };
}

test('Free Timer supports stopwatch and optional due time, and may be finished manually', () => {
  const { state: initial, ctx, taskId } = setup();
  let state = applyOk(initial, { type: 'startFreeTimer', taskId, durationMinutes: 20 }, ctx);
  expect(getTimerStatus(state, at('2026-09-15T09:19:59+08:00')).running?.isDue).toBe(false);
  expect(getTimerStatus(state, at('2026-09-15T09:20:00+08:00')).running?.isDue).toBe(true);
  ctx.now = at('2026-09-15T09:25:00+08:00');
  state = applyOk(state, { type: 'finishSession', note: '完成' }, ctx);
  expect(state.sessions[0]).toMatchObject({ mode: 'freeTimer', endedAt: '2026-09-15T09:25:00+08:00', outcome: 'completed', note: '完成' });
  state = applyOk(state, { type: 'startFreeTimer', taskId }, ctx);
  expect(getTimerStatus(state, ctx.now).running).toMatchObject({ dueAt: null, isDue: false, elapsedSeconds: 0 });
  ctx.now = at('2026-09-15T09:30:00+08:00');
  state = applyOk(state, { type: 'finishSession', note: '' }, ctx);
  expect(state.sessions[1]!.endedAt).toBe('2026-09-15T09:30:00+08:00');
  expect(apply(state, { type: 'startFreeTimer', taskId, durationMinutes: -1 }, ctx).ok).toBe(false);
});

test('Free Timer stops at 150 minutes or the final work range, and confirmed time cannot exceed that stop', () => {
  for (const [start, stop] of [['2026-09-15T09:00:00+08:00', '2026-09-15T11:30:00+08:00'], ['2026-09-15T17:30:00+08:00', '2026-09-15T18:00:00+08:00']]) {
    const { state: initial, ctx, taskId } = setup(start);
    let state = applyOk(initial, { type: 'startFreeTimer', taskId }, ctx);
    expect(getTimerStatus(state, ctx.now).running?.autoStopAt).toBe(stop);
    ctx.now = at('2026-09-16T09:00:00+08:00');
    state = applyOk(state, { type: 'reconcileTimers' }, ctx);
    expect(state.sessions[0]).toMatchObject({ endedAt: stop, endTimeUnconfirmed: true });
    expect(getTimerStatus(state, ctx.now).running).toBe(null);
    expect(apply(state, { type: 'confirmSessionEnd', sessionId: state.sessions[0]!.id, endedAt: '2026-09-16T08:00:00+08:00', note: '' }, ctx).ok).toBe(false);
    const earlier = new Date(Date.parse(stop!) - 60_000).toISOString();
    state = applyOk(state, { type: 'confirmSessionEnd', sessionId: state.sessions[0]!.id, endedAt: earlier, note: '確認' }, ctx);
    expect(state.sessions[0]).toMatchObject({ endTimeUnconfirmed: false, note: '確認' });
    expect(Date.parse(state.sessions[0]!.endedAt!)).toBe(Date.parse(earlier));
  }
});

test('queries cap unattended Free Timers and new work does not interrupt an already auto-stopped session', async () => {
  const { getDaySummary } = await import('../../src/core');
  const { state: initial, ctx, taskId } = setup();
  let state = applyOk(initial, { type: 'startFreeTimer', taskId }, ctx);
  ctx.now = at('2026-09-15T13:00:00+08:00');
  expect(getDaySummary(state, ctx.now).plannedMinutes).toBe(150);
  expect(getTimerStatus(state, ctx.now).running).toBe(null);
  state = applyOk(state, { type: 'insertAdHocTask', title: '新工作' }, ctx);
  expect(state.sessions[0]).toMatchObject({ outcome: 'completed', endTimeUnconfirmed: true, interruptedBySessionId: null });
});
