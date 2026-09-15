import { expect, test } from 'vitest';
import { createInitialState, INTERRUPT_BUCKET_ID, SELF_REQUESTER_ID, getDaySummary } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

test('Ad-hoc work interrupts the running session at its actual end without an Override', () => {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'createProject', name: '專案', requesterId: SELF_REQUESTER_ID, startDate: '2026-09-15' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: 'Task' }, ctx);
  state = applyOk(state, { type: 'startPomodoro', taskId: state.tasks[0]!.id }, ctx);
  ctx.now = at('2026-09-15T09:20:00+08:00');
  state = applyOk(state, { type: 'insertAdHocTask', title: '緊急修正' }, ctx);
  expect(state.tasks[1]).toMatchObject({ projectId: INTERRUPT_BUCKET_ID, title: '緊急修正' });
  expect(state.sessions[1]).toMatchObject({ taskId: state.tasks[1]!.id, adHoc: true, endedAt: null });
  expect(state.sessions[0]).toMatchObject({ outcome: 'interrupted', endedAt: '2026-09-15T09:20:00+08:00', interruptedBySessionId: state.sessions[1]!.id });
  expect(state.overrides).toEqual([]);
  ctx.now = at('2026-09-15T09:35:00+08:00');
  expect(getDaySummary(state, ctx.now)).toMatchObject({ plannedMinutes: 20, adHocMinutes: 15, remainingMinutes: 445 });
  const idle = applyOk(createInitialState(ctx), { type: 'insertAdHocTask', title: '臨時工作' }, ctx);
  expect(idle.sessions[0]).toMatchObject({ adHoc: true, endedAt: null });
});
