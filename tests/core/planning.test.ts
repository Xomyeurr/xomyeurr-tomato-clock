import { expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getDeadlineRiskWarning,
  getMustStartBy,
  getProjectRemainingMinutes,
  getScheduleWeight,
} from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup() {
  const ctx = { now: at('2026-09-15T10:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: 'A', requesterId: 'req_self', startDate: '2026-09-15', endDate: '2026-09-18' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: '工作' }, ctx);
  return { state, ctx, projectId: state.projects[1]!.id, taskId: state.tasks[0]!.id };
}

test('Effort Estimate converts hours and average workdays, and remaining excludes Commitment time', () => {
  const { state: initial, ctx, projectId, taskId } = setup();
  let state = applyOk(initial, { type: 'setEffortEstimate', projectId, value: 2, unit: 'hours' }, ctx);
  expect(state.projects[1]!.effortEstimateMinutes).toBe(120);
  state = applyOk(state, { type: 'startPomodoro', taskId }, ctx);
  ctx.now = at('2026-09-15T10:50:00+08:00');
  state = applyOk(state, { type: 'finishSession', note: '' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '會議', projectId, schedule: { type: 'once', date: '2026-09-15', start: '11:00', end: '12:00' } }, ctx);
  expect(getProjectRemainingMinutes(state, projectId, ctx.now)).toBe(70);
  state = applyOk(state, { type: 'setEffortEstimate', projectId, value: 1, unit: 'days' }, ctx);
  expect(state.projects[1]!.effortEstimateMinutes).toBe(480);
});

test('deadline urgency is capped and contributes to Schedule Weight', () => {
  const { state: initial, ctx, projectId } = setup();
  const state = applyOk(initial, { type: 'setEffortEstimate', projectId, value: 3000, unit: 'minutes' }, ctx);
  const weight = getScheduleWeight(state, state.projects[1]!, ctx.now);
  expect(weight.deadlineUrgency).toBe(1);
  expect(weight.total).toBeGreaterThan(0);
});

test('Must-Start-By and Deadline Risk Warning report due pressure and disappear for done projects', () => {
  const { state: initial, ctx, projectId } = setup();
  let state = applyOk(initial, { type: 'setEffortEstimate', projectId, value: 3000, unit: 'minutes' }, ctx);
  expect(getMustStartBy(state, projectId, ctx.now)).toBe('2026-09-15');
  const warning = getDeadlineRiskWarning(state, projectId, ctx.now);
  expect(warning?.conditions).toContain('available_time_below_threshold');
  state = applyOk(state, { type: 'completeProject', projectId }, ctx);
  expect(getDeadlineRiskWarning(state, projectId, ctx.now)).toBeNull();
});

test('invalid estimate and deadline thresholds are rejected', () => {
  const { state, ctx, projectId } = setup();
  expect(apply(state, { type: 'setEffortEstimate', projectId, value: 0, unit: 'hours' }, ctx).ok).toBe(false);
  expect(apply(state, { type: 'setDeadlineRiskThreshold', projectId, lateDays: -1 }, ctx).ok).toBe(false);
});
