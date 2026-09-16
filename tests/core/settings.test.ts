import { describe, expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getDeadlineRiskWarning,
  getMustStartBy,
  getScheduleWeight,
  getSuggestedTimeBlocks,
  getTimerStatus,
} from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup() {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createRequester', name: '主管', defaultWeight: 5 }, ctx);
  state = applyOk(state, { type: 'createProject', name: '期限專案', requesterId: 'req_1', startDate: '2026-09-15', endDate: '2026-09-16', manualPriority: 5 }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_2', title: '工作' }, ctx);
  state = applyOk(state, { type: 'setEffortEstimate', projectId: 'prj_2', value: 900, unit: 'minutes' }, ctx);
  return { state, ctx, projectId: 'prj_2', taskId: 'tsk_3' };
}

describe('全域設定', () => {
  test('修改全域設定後，排程權重、保底、預警和建議時段立即重算', () => {
    const { state: initial, ctx, projectId } = setup();
    const beforeWeight = getScheduleWeight(initial, initial.projects.find(p => p.id === projectId)!, ctx.now);
    expect(beforeWeight.total).toBe(0.96875);
    expect(getMustStartBy(initial, projectId, ctx.now)).toBe('2026-09-15');
    expect(getSuggestedTimeBlocks(initial, ctx.now)[0]).toMatchObject({ start: '09:00', end: '09:50' });

    const state = applyOk(initial, {
      type: 'updateSettings',
      patch: {
        pomodoro: { focusMinutes: 25, breakMinutes: 5 },
        scheduleWeightFactors: { deadlineUrgency: 1, requester: 0, manualPriority: 0 },
        mustStartBy: { safetyBufferWorkdays: 0, guaranteedMinutesPerDay: 25 },
        deadlineRisk: { lateDays: 1, availablePercent: 80 },
      },
    }, ctx);

    expect(state.settings.updatedAt).toBe('2026-09-15T09:00:00+08:00');
    expect(getScheduleWeight(state, state.projects.find(p => p.id === projectId)!, ctx.now).total).toBe(900 / 960);
    expect(getMustStartBy(state, projectId, ctx.now)).toBe('2026-09-15');
    expect(getDeadlineRiskWarning(state, projectId, ctx.now)?.conditions).toEqual([]);
    expect(getSuggestedTimeBlocks(state, ctx.now)[0]).toMatchObject({ start: '09:00', end: '09:25' });
  });

  test('不合理的設定會被拒絕', () => {
    const { state, ctx } = setup();

    expect(apply(state, { type: 'updateSettings', patch: { pomodoro: { focusMinutes: 0 } } }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'updateSettings', patch: { freeTimer: { maxMinutes: -1 } } }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'updateSettings', patch: { scheduleWeightFactors: { deadlineUrgency: 0.4, requester: 0.4, manualPriority: 0.4 } } }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'updateSettings', patch: { mustStartBy: { safetyBufferWorkdays: -1 } } }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'updateSettings', patch: { deadlineRisk: { lateDays: -1 } } }, ctx).ok).toBe(false);
  });

  test('計時中的 Pomodoro 維持開始時的專注長度，下一段才套用新設定', () => {
    const { state: initial, ctx, taskId } = setup();
    let state = applyOk(initial, { type: 'startPomodoro', taskId }, ctx);
    state = applyOk(state, { type: 'updateSettings', patch: { pomodoro: { focusMinutes: 25, breakMinutes: 5 } } }, ctx);

    expect(getTimerStatus(state, at('2026-09-15T09:30:00+08:00')).running).toMatchObject({
      dueAt: '2026-09-15T09:50:00+08:00',
      remainingSeconds: 1200,
    });
    expect(apply(state, { type: 'finishSession', note: '' }, { ...ctx, now: at('2026-09-15T09:30:00+08:00') }).ok).toBe(false);

    ctx.now = at('2026-09-15T09:50:00+08:00');
    state = applyOk(state, { type: 'finishSession', note: '' }, ctx);
    state = applyOk(state, { type: 'startPomodoro', taskId }, { ...ctx, now: at('2026-09-15T10:00:00+08:00') });

    expect(getTimerStatus(state, at('2026-09-15T10:10:00+08:00')).running).toMatchObject({
      dueAt: '2026-09-15T10:25:00+08:00',
      remainingSeconds: 900,
    });
  });
});
