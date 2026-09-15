import { describe, expect, it } from 'vitest';
import { apply, type Command, createInitialState } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

describe('基本設定:初始狀態', () => {
  it('內建預設設定、「自己」Requester 和 Interrupt Bucket', () => {
    const state = createInitialState({ now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() });

    expect(state.settings).toEqual({
      timezone: 'Asia/Taipei',
      pomodoro: { focusMinutes: 50, breakMinutes: 10 },
      freeTimer: { maxMinutes: 150 },
      scheduleWeightFactors: { deadlineUrgency: 0.5, requester: 0.25, manualPriority: 0.25 },
      mustStartBy: { safetyBufferWorkdays: 1, guaranteedMinutesPerDay: 50 },
      deadlineRisk: { lateDays: 0, availablePercent: 120 },
      updatedAt: '2026-09-15T09:00:00+08:00',
    });
    expect(state.requesters).toEqual([
      {
        id: 'req_self',
        name: '自己',
        defaultWeight: 3,
        status: 'active',
        createdAt: '2026-09-15T09:00:00+08:00',
        updatedAt: '2026-09-15T09:00:00+08:00',
      },
    ]);
    expect(state.projects).toEqual([
      {
        id: 'interrupt-bucket',
        kind: 'interruptBucket',
        name: '臨時工作區',
        requesterId: null,
        requesterWeightOverride: null,
        manualPriority: null,
        startDate: null,
        endDate: null,
        effortEstimateMinutes: null,
        deadlineRiskOverride: null,
        status: 'active',
        doneAt: null,
        createdAt: '2026-09-15T09:00:00+08:00',
        updatedAt: '2026-09-15T09:00:00+08:00',
      },
    ]);
    expect(state.tasks).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.overrides).toEqual([]);
  });
});

describe('基本設定:Project', () => {
  it('用名稱、Requester 和開始日建立 Project,手動優先級預設 3', () => {
    const ctx = { now: at('2026-09-15T09:30:00+08:00'), newId: sequentialIds() };

    const state = applyOk(
      createInitialState(ctx),
      { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_self' },
      ctx,
    );

    expect(state.projects.filter((p) => p.kind === 'project')).toEqual([
      {
        id: 'prj_1',
        kind: 'project',
        name: '會員系統重構',
        requesterId: 'req_self',
        requesterWeightOverride: null,
        manualPriority: 3,
        startDate: '2026-09-15',
        endDate: null,
        effortEstimateMinutes: null,
        deadlineRiskOverride: null,
        status: 'active',
        doneAt: null,
        createdAt: '2026-09-15T09:30:00+08:00',
        updatedAt: '2026-09-15T09:30:00+08:00',
      },
    ]);
  });

  it.each([
    ['名稱空白', { name: '   ', startDate: '2026-09-15', requesterId: 'req_self' }, 'invalid_name'],
    ['開始日格式錯誤', { name: 'A', startDate: '2026/09/15', requesterId: 'req_self' }, 'invalid_date'],
    ['截止日早於開始日', { name: 'A', startDate: '2026-09-15', endDate: '2026-09-10', requesterId: 'req_self' }, 'invalid_date_range'],
    ['手動優先級小於 1', { name: 'A', startDate: '2026-09-15', manualPriority: 0, requesterId: 'req_self' }, 'invalid_manual_priority'],
    ['手動優先級大於 5', { name: 'A', startDate: '2026-09-15', manualPriority: 6, requesterId: 'req_self' }, 'invalid_manual_priority'],
    ['手動優先級不是整數', { name: 'A', startDate: '2026-09-15', manualPriority: 2.5, requesterId: 'req_self' }, 'invalid_manual_priority'],
    ['沒有選 Requester', { name: 'A', startDate: '2026-09-15', requesterId: '' }, 'requester_required'],
    ['Requester 不存在', { name: 'A', startDate: '2026-09-15', requesterId: 'req_nobody' }, 'requester_not_found'],
  ])('%s時拒絕建立 Project 並回傳原因', (_label, input, code) => {
    const ctx = { now: at('2026-09-15T09:30:00+08:00'), newId: sequentialIds() };

    const result = apply(createInitialState(ctx), { type: 'createProject', ...input }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message).not.toBe('');
    }
  });

  function stateWithOneProject() {
    const ids = sequentialIds();
    const ctx = { now: at('2026-09-15T09:30:00+08:00'), newId: ids };
    const state = applyOk(
      createInitialState(ctx),
      { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_self' },
      ctx,
    );
    return { state, ids };
  }

  it('修改 Project 的名稱、截止日和手動優先級,只更新 updatedAt', () => {
    const { state, ids } = stateWithOneProject();
    const later = { now: at('2026-09-16T14:00:00+08:00'), newId: ids };

    const updated = applyOk(
      state,
      { type: 'updateProject', projectId: 'prj_1', name: '會員系統 v2', endDate: '2026-09-30', manualPriority: 5 },
      later,
    );

    expect(updated.projects.find((p) => p.id === 'prj_1')).toMatchObject({
      name: '會員系統 v2',
      startDate: '2026-09-15',
      endDate: '2026-09-30',
      manualPriority: 5,
      requesterId: 'req_self',
      createdAt: '2026-09-15T09:30:00+08:00',
      updatedAt: '2026-09-16T14:00:00+08:00',
    });
  });

  it.each([
    ['找不到 Project', { projectId: 'prj_nobody', name: 'B' }, 'project_not_found'],
    ['名稱改成空白', { projectId: 'prj_1', name: '' }, 'invalid_name'],
    ['截止日改成早於開始日', { projectId: 'prj_1', endDate: '2026-09-01' }, 'invalid_date_range'],
    ['手動優先級改成超出範圍', { projectId: 'prj_1', manualPriority: 9 }, 'invalid_manual_priority'],
  ])('%s時拒絕修改 Project', (_label, input, code) => {
    const { state, ids } = stateWithOneProject();
    const ctx = { now: at('2026-09-16T14:00:00+08:00'), newId: ids };

    const result = apply(state, { type: 'updateProject', ...input }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('手動標記 Project 完成,記錄完成時間', () => {
    const { state, ids } = stateWithOneProject();
    const later = { now: at('2026-09-20T17:45:00+08:00'), newId: ids };

    const done = applyOk(state, { type: 'completeProject', projectId: 'prj_1' }, later);

    expect(done.projects.find((p) => p.id === 'prj_1')).toMatchObject({
      status: 'done',
      doneAt: '2026-09-20T17:45:00+08:00',
      updatedAt: '2026-09-20T17:45:00+08:00',
      createdAt: '2026-09-15T09:30:00+08:00',
    });
  });

  it('找不到或已經完成的 Project 不能再標記完成', () => {
    const { state, ids } = stateWithOneProject();
    const ctx = { now: at('2026-09-20T17:45:00+08:00'), newId: ids };
    const done = applyOk(state, { type: 'completeProject', projectId: 'prj_1' }, ctx);

    const missing = apply(state, { type: 'completeProject', projectId: 'prj_nobody' }, ctx);
    const again = apply(done, { type: 'completeProject', projectId: 'prj_1' }, ctx);

    expect(missing.ok ? null : missing.error.code).toBe('project_not_found');
    expect(again.ok ? null : again.error.code).toBe('project_already_done');
  });
});

describe('基本設定:Task', () => {
  function stateWithProject() {
    const ids = sequentialIds();
    const ctx = { now: at('2026-09-15T09:30:00+08:00'), newId: ids };
    const state = applyOk(
      createInitialState(ctx),
      { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_self' },
      ctx,
    );
    return { state, ids };
  }

  it('在 Project 底下建立 Task,標題前後空白會去掉', () => {
    const { state, ids } = stateWithProject();
    const ctx = { now: at('2026-09-15T10:00:00+08:00'), newId: ids };

    const next = applyOk(state, { type: 'createTask', projectId: 'prj_1', title: '  修 code review 抓到的權限 bug  ' }, ctx);

    expect(next.tasks).toEqual([
      {
        id: 'tsk_2',
        projectId: 'prj_1',
        title: '修 code review 抓到的權限 bug',
        status: 'open',
        doneAt: null,
        createdAt: '2026-09-15T10:00:00+08:00',
        updatedAt: '2026-09-15T10:00:00+08:00',
      },
    ]);
  });

  it.each([
    ['標題空白', false, { projectId: 'prj_1', title: '  ' }, 'invalid_title'],
    ['找不到 Project', false, { projectId: 'prj_nobody', title: 'A' }, 'project_not_found'],
    ['指定臨時工作區', false, { projectId: 'interrupt-bucket', title: 'A' }, 'project_not_found'],
    ['Project 已經完成', true, { projectId: 'prj_1', title: 'A' }, 'project_done'],
  ])('%s時拒絕建立 Task', (_label, completeFirst, input, code) => {
    const { state, ids } = stateWithProject();
    const ctx = { now: at('2026-09-15T10:00:00+08:00'), newId: ids };
    const before = completeFirst ? applyOk(state, { type: 'completeProject', projectId: 'prj_1' }, ctx) : state;

    const result = apply(before, { type: 'createTask', ...input }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  function stateWithTask() {
    const { state, ids } = stateWithProject();
    const ctx = { now: at('2026-09-15T10:00:00+08:00'), newId: ids };
    return { state: applyOk(state, { type: 'createTask', projectId: 'prj_1', title: '登入流程' }, ctx), ids };
  }

  it('修改 Task 標題,只更新 updatedAt', () => {
    const { state, ids } = stateWithTask();
    const later = { now: at('2026-09-15T11:00:00+08:00'), newId: ids };

    const next = applyOk(state, { type: 'updateTask', taskId: 'tsk_2', title: ' 登入流程改用新 token ' }, later);

    expect(next.tasks[0]).toMatchObject({
      title: '登入流程改用新 token',
      status: 'open',
      createdAt: '2026-09-15T10:00:00+08:00',
      updatedAt: '2026-09-15T11:00:00+08:00',
    });
  });

  it('手動標記 Task 完成,記錄完成時間', () => {
    const { state, ids } = stateWithTask();
    const later = { now: at('2026-09-15T16:20:00+08:00'), newId: ids };

    const next = applyOk(state, { type: 'completeTask', taskId: 'tsk_2' }, later);

    expect(next.tasks[0]).toMatchObject({
      status: 'done',
      doneAt: '2026-09-15T16:20:00+08:00',
      updatedAt: '2026-09-15T16:20:00+08:00',
    });
  });

  const taskErrorCases: [string, Command, string][] = [
    ['修改時找不到 Task', { type: 'updateTask', taskId: 'tsk_nobody', title: 'A' }, 'task_not_found'],
    ['標題改成空白', { type: 'updateTask', taskId: 'tsk_2', title: ' ' }, 'invalid_title'],
    ['標記完成時找不到 Task', { type: 'completeTask', taskId: 'tsk_nobody' }, 'task_not_found'],
  ];

  it.each(taskErrorCases)('%s時回傳錯誤', (_label, command, code) => {
    const { state, ids } = stateWithTask();
    const ctx = { now: at('2026-09-15T11:00:00+08:00'), newId: ids };

    const result = apply(state, command, ctx);

    expect(result.ok ? null : result.error.code).toBe(code);
  });

  it('已經完成的 Task 不能再標記完成', () => {
    const { state, ids } = stateWithTask();
    const ctx = { now: at('2026-09-15T16:20:00+08:00'), newId: ids };
    const done = applyOk(state, { type: 'completeTask', taskId: 'tsk_2' }, ctx);

    const again = apply(done, { type: 'completeTask', taskId: 'tsk_2' }, ctx);

    expect(again.ok ? null : again.error.code).toBe('task_already_done');
  });
});

describe('基本設定:Requester', () => {
  it('建立 Requester,設定名稱和預設權重', () => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };

    const state = applyOk(createInitialState(ctx), { type: 'createRequester', name: ' 老闆 ', defaultWeight: 5 }, ctx);

    expect(state.requesters).toContainEqual({
      id: 'req_1',
      name: '老闆',
      defaultWeight: 5,
      status: 'active',
      createdAt: '2026-09-15T09:00:00+08:00',
      updatedAt: '2026-09-15T09:00:00+08:00',
    });
  });

  it('修改 Requester 的名稱和預設權重,只更新 updatedAt', () => {
    const ids = sequentialIds();
    const morning = { now: at('2026-09-15T09:00:00+08:00'), newId: ids };
    const created = applyOk(createInitialState(morning), { type: 'createRequester', name: '老闆', defaultWeight: 5 }, morning);

    const updated = applyOk(
      created,
      { type: 'updateRequester', requesterId: 'req_1', name: '部門主管', defaultWeight: 4 },
      { now: at('2026-09-15T10:00:00+08:00'), newId: ids },
    );

    expect(updated.requesters.find((r) => r.id === 'req_1')).toMatchObject({
      name: '部門主管',
      defaultWeight: 4,
      createdAt: '2026-09-15T09:00:00+08:00',
      updatedAt: '2026-09-15T10:00:00+08:00',
    });
  });

  it('可以修改內建「自己」的預設權重', () => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };

    const state = applyOk(createInitialState(ctx), { type: 'updateRequester', requesterId: 'req_self', defaultWeight: 2 }, ctx);

    expect(state.requesters.find((r) => r.id === 'req_self')).toMatchObject({ name: '自己', defaultWeight: 2 });
  });

  const requesterErrorCases: [string, Command, string][] = [
    ['名稱空白', { type: 'createRequester', name: '  ', defaultWeight: 3 }, 'invalid_name'],
    ['權重超出 1–5', { type: 'createRequester', name: 'A', defaultWeight: 6 }, 'invalid_weight'],
    ['修改時找不到 Requester', { type: 'updateRequester', requesterId: 'req_nobody', name: 'A' }, 'requester_not_found'],
    ['修改時權重不是整數', { type: 'updateRequester', requesterId: 'req_self', defaultWeight: 2.5 }, 'invalid_weight'],
    ['修改時名稱改成空白', { type: 'updateRequester', requesterId: 'req_self', name: '' }, 'invalid_name'],
  ];

  it.each(requesterErrorCases)('%s時回傳錯誤', (_label, command, code) => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };

    const result = apply(createInitialState(ctx), command, ctx);

    expect(result.ok ? null : result.error.code).toBe(code);
  });
});

describe('基本設定:Project 的 Requester 與權重', () => {
  it('Project 選擇 Requester,並可另外設定這個 Project 的 Requester 權重,也能清掉改回沿用', () => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
    let state = applyOk(createInitialState(ctx), { type: 'createRequester', name: '老闆', defaultWeight: 5 }, ctx);

    state = applyOk(
      state,
      { type: 'createProject', name: '報表匯出 API', startDate: '2026-09-15', requesterId: 'req_1', requesterWeightOverride: 2 },
      ctx,
    );
    expect(state.projects.find((p) => p.id === 'prj_2')).toMatchObject({ requesterId: 'req_1', requesterWeightOverride: 2 });

    state = applyOk(state, { type: 'updateProject', projectId: 'prj_2', requesterWeightOverride: null }, ctx);
    expect(state.projects.find((p) => p.id === 'prj_2')?.requesterWeightOverride).toBeNull();
  });

  const overrideErrorCases: [string, Command][] = [
    ['建立時', { type: 'createProject', name: 'A', startDate: '2026-09-15', requesterId: 'req_self', requesterWeightOverride: 0 }],
    ['修改時', { type: 'updateProject', projectId: 'prj_1', requesterWeightOverride: 6 }],
  ];

  it.each(overrideErrorCases)('%s Requester 權重超出 1–5 會被拒絕', (_label, command) => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
    const state = applyOk(
      createInitialState(ctx),
      { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_self' },
      ctx,
    );

    const result = apply(state, command, ctx);

    expect(result.ok ? null : result.error.code).toBe('invalid_weight');
  });
});
