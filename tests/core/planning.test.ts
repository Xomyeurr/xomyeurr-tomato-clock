import { expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getDeadlineRiskWarning,
  getMustStartBy,
  getProjectRemainingMinutes,
  getScheduleWeight,
  getSuggestedTimeBlocks,
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

test('Must-Start-By remains finite when the weekly work template has no workdays', () => {
  const { state: initial, ctx, projectId } = setup();
  const state = applyOk(initial, { type: 'setEffortEstimate', projectId, value: 50, unit: 'minutes' }, ctx);
  const noWorkdays = { ...state, workHours: { ...state.workHours, weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } } };
  expect(getMustStartBy(noWorkdays, projectId, ctx.now)).toBe('2026-09-18');
});

// getSuggestedTimeBlocks 和 dayMinutes 有以 AppState 為鍵的快取,
// 狀態換掉或時間往前走時都必須重算,不能回舊答案。
test('cached scheduling queries follow state and clock changes', () => {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '甲', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
  const projectId = state.projects[1]!.id;
  state = applyOk(state, { type: 'createTask', projectId, title: '工作' }, ctx);

  const before = getSuggestedTimeBlocks(state, ctx.now);
  expect(before.length).toBeGreaterThan(0);

  // 同一份 state、同一個時間:答案要一致。
  expect(getSuggestedTimeBlocks(state, ctx.now)).toEqual(before);

  // 時間往前走:今天剩的時間變少,建議時段跟著變少。
  const later = getSuggestedTimeBlocks(state, at('2026-09-15T16:00:00+08:00'));
  expect(later.length).toBeLessThan(before.length);

  // 狀態改變(整個下午變成固定行程):建議時段要重算。
  const busy = applyOk(state, { type: 'createCommitment', title: '整天會議', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '09:00', end: '18:00' } }, ctx);
  expect(getSuggestedTimeBlocks(busy, ctx.now)).toEqual([]);
  // 舊的 state 物件仍然給舊答案,沒有被污染。
  expect(getSuggestedTimeBlocks(state, ctx.now)).toEqual(before);
});
