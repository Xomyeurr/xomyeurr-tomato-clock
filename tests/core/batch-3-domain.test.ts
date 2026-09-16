import { describe, expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getDeadlineRiskWarning,
  getMustStartBy,
  getNextTask,
  getProjectRemainingMinutes,
  getScheduleWeight,
  getSuggestedTimeBlocks,
  type AppState,
  type Context,
} from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function context(iso = '2026-09-15T09:00:00+08:00') {
  const ids = sequentialIds();
  return { ctx: { now: at(iso), newId: ids }, ids };
}

function addProject(
  state: AppState,
  ctx: Context,
  fields: {
    name: string;
    requesterId?: string;
    startDate?: string;
    endDate?: string | null;
    manualPriority?: number;
    effortMinutes?: number;
  },
) {
  state = applyOk(
    state,
    {
      type: 'createProject',
      name: fields.name,
      requesterId: fields.requesterId ?? 'req_self',
      startDate: fields.startDate ?? '2026-09-15',
      endDate: fields.endDate ?? null,
      manualPriority: fields.manualPriority ?? 3,
    },
    ctx,
  );
  const project = state.projects.at(-1)!;
  state = applyOk(state, { type: 'createTask', projectId: project.id, title: `${fields.name} Task` }, ctx);
  if (fields.effortMinutes !== undefined) {
    state = applyOk(state, { type: 'setEffortEstimate', projectId: project.id, value: fields.effortMinutes, unit: 'minutes' }, ctx);
  }
  return { state, projectId: project.id, taskId: state.tasks.at(-1)!.id };
}

describe('批次 3 domain: Effort Estimate and Schedule Weight', () => {
  test('Schedule Weight combines deadline urgency, Requester weight, and manual priority with known scores', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'createRequester', name: '主管', defaultWeight: 5 }, ctx);
    const created = addProject(state, ctx, {
      name: '期限專案',
      requesterId: 'req_1',
      endDate: '2026-09-16',
      manualPriority: 1,
      effortMinutes: 240,
    });

    const project = created.state.projects.find(p => p.id === created.projectId)!;
    const weight = getScheduleWeight(created.state, project, ctx.now);

    expect(weight).toEqual({
      deadlineUrgency: 0.25,
      requester: 1,
      manualPriority: 0,
      total: 0.375,
    });
  });

  test('Project without end date has no Must-Start-By, no Deadline Risk Warning, and zero deadline urgency', () => {
    const { ctx } = context();
    const created = addProject(createInitialState(ctx), ctx, {
      name: '無期限維護',
      manualPriority: 5,
      effortMinutes: 500,
    });
    const project = created.state.projects.find(p => p.id === created.projectId)!;

    expect(getScheduleWeight(created.state, project, ctx.now)).toMatchObject({
      deadlineUrgency: 0,
      requester: 0.5,
      manualPriority: 1,
      total: 0.375,
    });
    expect(getMustStartBy(created.state, created.projectId, ctx.now)).toBeNull();
    expect(getDeadlineRiskWarning(created.state, created.projectId, ctx.now)).toBeNull();
  });

  test('Effort Estimate days use the average of configured workdays, not calendar days', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'mon', ranges: [{ start: '09:00', end: '11:00' }] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'tue', ranges: [{ start: '09:00', end: '13:00' }] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'wed', ranges: [] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'thu', ranges: [] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'fri', ranges: [] }, ctx);
    const created = addProject(state, ctx, { name: '平均工作日專案' });

    state = applyOk(created.state, { type: 'setEffortEstimate', projectId: created.projectId, value: 1, unit: 'days' }, ctx);

    expect(state.projects.find(p => p.id === created.projectId)?.effortEstimateMinutes).toBe(180);
  });

  test('remaining Effort Estimate counts abandoned and interrupted Work Sessions, but not linked Commitments', () => {
    const { ctx } = context();
    let { state, projectId, taskId } = addProject(createInitialState(ctx), ctx, {
      name: '投入時間專案',
      effortMinutes: 100,
    });
    state = applyOk(state, { type: 'startPomodoro', taskId }, ctx);
    ctx.now = at('2026-09-15T09:20:00+08:00');
    state = applyOk(state, { type: 'insertAdHocTask', title: '臨時插隊' }, ctx);
    state = applyOk(state, {
      type: 'createCommitment',
      title: '專案會議',
      projectId,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);

    expect(getProjectRemainingMinutes(state, projectId, ctx.now)).toBe(80);
  });
});

describe('批次 3 domain: Must-Start-By and Deadline Risk Warning', () => {
  test('Must-Start-By skips non-working days and subtracts Commitments from available time', () => {
    const { ctx } = context();
    let { state, projectId } = addProject(createInitialState(ctx), ctx, {
      name: '會被壓縮的截止專案',
      endDate: '2026-09-18',
      effortMinutes: 600,
    });
    state = applyOk(state, { type: 'setDayWorkHours', date: '2026-09-17', ranges: [] }, ctx);
    state = applyOk(state, {
      type: 'createCommitment',
      title: '週五半天會議',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-18', start: '09:00', end: '13:00' },
    }, ctx);

    expect(getMustStartBy(state, projectId, ctx.now)).toBe('2026-09-15');
  });

  test('Deadline Risk Warning reports late completion and available-time shortage as separate conditions', () => {
    const { ctx } = context();
    let late = addProject(createInitialState(ctx), ctx, {
      name: '只測預估延遲',
      endDate: '2026-09-15',
      effortMinutes: 500,
    }).state;
    const lateProjectId = late.projects.at(-1)!.id;
    late = applyOk(late, { type: 'setDeadlineRiskThreshold', projectId: lateProjectId, lateDays: 0, availablePercent: 90 }, ctx);

    expect(getDeadlineRiskWarning(late, lateProjectId, ctx.now)).toMatchObject({
      projectedCompletionDate: '2026-09-16',
      availableMinutes: 480,
      remainingMinutes: 500,
      conditions: ['projected_completion_after_deadline'],
    });

    const shortage = addProject(createInitialState(ctx), ctx, {
      name: '只測可用時間不足',
      endDate: '2026-09-16',
      effortMinutes: 900,
    });

    expect(getDeadlineRiskWarning(shortage.state, shortage.projectId, ctx.now)).toMatchObject({
      projectedCompletionDate: '2026-09-16',
      availableMinutes: 960,
      remainingMinutes: 900,
      conditions: ['available_time_below_threshold'],
    });
  });
});

describe('批次 3 domain: Suggested and Locked Time Blocks', () => {
  test('Project past Must-Start-By receives the first Suggested Time Block even when another Project has higher base weight', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const urgent = addProject(state, ctx, {
      name: '今天必須開始',
      endDate: '2026-09-15',
      manualPriority: 1,
      effortMinutes: 480,
    });
    state = urgent.state;
    state = applyOk(state, { type: 'createRequester', name: '重要 requester', defaultWeight: 5 }, ctx);
    const requesterId = state.requesters.at(-1)!.id;
    const highWeight = addProject(state, ctx, {
      name: '高權重但無期限',
      requesterId,
      manualPriority: 5,
      effortMinutes: 480,
    });

    expect(getSuggestedTimeBlocks(highWeight.state, ctx.now)[0]).toMatchObject({
      projectId: urgent.projectId,
      date: '2026-09-15',
      start: '09:00',
      end: '09:50',
    });
    expect(getNextTask(highWeight.state, ctx.now)).toMatchObject({
      projectId: urgent.projectId,
      reason: 'mustStartBy',
    });
  });

  test('locked Time Block is removed from suggestions and counts toward Must-Start-By guarantee', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const urgent = addProject(state, ctx, {
      name: '已鎖保底',
      endDate: '2026-09-15',
      manualPriority: 1,
      effortMinutes: 50,
    });
    state = applyOk(urgent.state, { type: 'createRequester', name: '大權重 requester', defaultWeight: 5 }, ctx);
    const requesterId = state.requesters.at(-1)!.id;
    const highWeight = addProject(state, ctx, {
      name: '下一段應該做',
      requesterId,
      manualPriority: 5,
      effortMinutes: 480,
    });
    state = applyOk(highWeight.state, { type: 'setDayWorkHours', date: '2026-09-15', ranges: [{ start: '09:00', end: '10:40' }] }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId: urgent.projectId, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);

    const suggestions = getSuggestedTimeBlocks(state, ctx.now);

    expect(suggestions).not.toContainEqual(expect.objectContaining({ start: '09:00', end: '09:50' }));
    expect(suggestions[0]).toMatchObject({ projectId: highWeight.projectId, start: '09:50', end: '10:40' });
  });

  test('Suggested Time Blocks ignore Projects that are done, archived, or have no open Task', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const active = addProject(state, ctx, { name: '唯一可做', manualPriority: 3 });
    state = active.state;
    const done = addProject(state, ctx, { name: '已完成專案', manualPriority: 5 });
    state = applyOk(done.state, { type: 'completeProject', projectId: done.projectId }, ctx);
    const archived = addProject(state, ctx, { name: '已封存專案', manualPriority: 5 });
    state = {
      ...archived.state,
      projects: archived.state.projects.map(project =>
        project.id === archived.projectId ? { ...project, status: 'archived' as const } : project,
      ),
    };
    state = applyOk(state, { type: 'createProject', name: '沒有 Task 的專案', requesterId: 'req_self', startDate: '2026-09-15', manualPriority: 5 }, ctx);

    const suggestedProjectIds = new Set(getSuggestedTimeBlocks(state, ctx.now).map(block => block.projectId));

    expect(suggestedProjectIds).toEqual(new Set([active.projectId]));
  });

  test('locking rejects time outside work hours, Commitments, and existing locked Time Blocks', () => {
    const { ctx } = context();
    let { state, projectId } = addProject(createInitialState(ctx), ctx, { name: '鎖定驗證' });
    state = applyOk(state, {
      type: 'createCommitment',
      title: '不能覆蓋的行程',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '13:00', end: '13:50' }, ctx);

    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '08:00', end: '08:50' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '10:10', end: '10:50' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '13:20', end: '14:10' }, ctx).ok).toBe(false);
  });
});
