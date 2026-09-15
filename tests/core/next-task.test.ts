import { describe, expect, it } from 'vitest';
import { createInitialState, getNextTask, getStartableTasks } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

const noon = at('2026-09-15T12:00:00+08:00');

function plan() {
  const ids = sequentialIds();
  const ctx = (iso: string) => ({ now: at(iso), newId: ids });
  const t = ctx('2026-09-15T09:00:00+08:00');
  let state = createInitialState(t);
  state = applyOk(state, { type: 'createRequester', name: '老闆', defaultWeight: 5 }, t);
  state = applyOk(state, { type: 'createRequester', name: '同事 A', defaultWeight: 2 }, t);
  state = applyOk(state, { type: 'createProject', name: '報表匯出 API', startDate: '2026-09-15', requesterId: 'req_2' }, t);
  state = applyOk(state, { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_1' }, t);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_3', title: '匯出欄位規格' }, t);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_4', title: '登入流程' }, ctx('2026-09-15T09:01:00+08:00'));
  state = applyOk(state, { type: 'createTask', projectId: 'prj_4', title: '權限 bug' }, ctx('2026-09-15T09:02:00+08:00'));
  return { state, ctx };
}

describe('基本功能:現在該做什麼', () => {
  it('推薦 Schedule Weight 最高的 Project 裡最早建立的未完成 Task,並說明原因', () => {
    const { state } = plan();

    expect(getNextTask(state, noon)).toEqual({
      taskId: 'tsk_6',
      taskTitle: '登入流程',
      projectId: 'prj_4',
      projectName: '會員系統重構',
      reason: 'highestWeight',
      score: 0.375,
    });
  });

  it('Project 另外設定的 Requester 權重優先於 Requester 的預設權重', () => {
    const { state, ctx } = plan();

    const next = applyOk(state, { type: 'updateProject', projectId: 'prj_4', requesterWeightOverride: 1 }, ctx('2026-09-15T09:30:00+08:00'));

    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_5', projectId: 'prj_3', score: 0.1875 });
  });

  it('修改手動優先級後,推薦立即改變', () => {
    const { state, ctx } = plan();
    const c = ctx('2026-09-15T09:30:00+08:00');

    let next = applyOk(state, { type: 'updateProject', projectId: 'prj_4', manualPriority: 1 }, c);
    next = applyOk(next, { type: 'updateProject', projectId: 'prj_3', manualPriority: 5 }, c);

    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_5', score: 0.3125 });
  });

  it('修改 Requester 的預設權重後,沒有另外設定權重的 Project 分數跟著改變', () => {
    const { state, ctx } = plan();

    const next = applyOk(state, { type: 'updateRequester', requesterId: 'req_1', defaultWeight: 1 }, ctx('2026-09-15T09:30:00+08:00'));

    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_5', score: 0.1875 });
  });

  it('同一個 Project 內,優先推薦最近做過而且還沒完成的 Task', () => {
    const { state, ctx } = plan();

    let next = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_7' }, ctx('2026-09-15T10:00:00+08:00'));
    next = applyOk(next, { type: 'abandonSession' }, ctx('2026-09-15T10:10:00+08:00'));

    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_7', taskTitle: '權限 bug' });
  });

  it('已完成的 Task 和 Project 不會被推薦;沒有可做的 Task 時回傳 null', () => {
    const { state, ctx } = plan();
    const c = ctx('2026-09-15T11:00:00+08:00');

    let next = applyOk(state, { type: 'completeTask', taskId: 'tsk_6' }, c);
    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_7' });

    next = applyOk(next, { type: 'completeProject', projectId: 'prj_4' }, c);
    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_5' });

    next = applyOk(next, { type: 'completeTask', taskId: 'tsk_5' }, c);
    expect(getNextTask(next, noon)).toBeNull();
  });

  it('分數和建立時間都相同時,推薦清單中排在前面的 Project', () => {
    const { state, ctx } = plan();

    const next = applyOk(state, { type: 'updateRequester', requesterId: 'req_2', defaultWeight: 5 }, ctx('2026-09-15T09:30:00+08:00'));

    expect(getNextTask(next, noon)).toMatchObject({ taskId: 'tsk_5', projectId: 'prj_3', score: 0.375 });
  });
});

describe('基本功能:調整紀錄', () => {
  it('開始的 Task 和推薦不同時,記一筆「改做別的 Task」的 Override', () => {
    const { state, ctx } = plan();

    const next = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_5' }, ctx('2026-09-15T10:00:00+08:00'));

    expect(next.overrides).toEqual([
      {
        id: expect.any(String),
        at: '2026-09-15T10:00:00+08:00',
        type: 'differentTask',
        suggested: { taskId: 'tsk_6' },
        actual: { taskId: 'tsk_5' },
      },
    ]);
  });

  it('照著推薦開始時,不記 Override', () => {
    const { state, ctx } = plan();

    const next = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_6' }, ctx('2026-09-15T10:00:00+08:00'));

    expect(next.overrides).toEqual([]);
  });
});

describe('基本功能:可以開始的 Task', () => {
  it('列出進行中 Project 底下未完成的 Task,依建立時間排序;已完成的 Task 和已完成 Project 的 Task 不列出', () => {
    const { state, ctx } = plan();
    const c = ctx('2026-09-15T11:00:00+08:00');

    let next = applyOk(state, { type: 'completeTask', taskId: 'tsk_6' }, c);
    expect(getStartableTasks(next).map((t) => t.id)).toEqual(['tsk_5', 'tsk_7']);

    next = applyOk(next, { type: 'completeProject', projectId: 'prj_3' }, c);
    expect(getStartableTasks(next).map((t) => t.id)).toEqual(['tsk_7']);
  });
});

describe('基本功能:現在該做什麼(分數相同)', () => {
  it('分數相同時依建立時間挑選 Project,而不是依清單順序', () => {
    const ids = sequentialIds();
    const ctx = (iso: string) => ({ now: at(iso), newId: ids });
    let state = createInitialState(ctx('2026-09-15T08:00:00+08:00'));
    state = applyOk(state, { type: 'createProject', name: '後建立', startDate: '2026-09-15' }, ctx('2026-09-15T10:00:00+08:00'));
    state = applyOk(state, { type: 'createProject', name: '先建立', startDate: '2026-09-15' }, ctx('2026-09-15T09:00:00+08:00'));
    state = applyOk(state, { type: 'createTask', projectId: 'prj_1', title: 'A' }, ctx('2026-09-15T10:00:00+08:00'));
    state = applyOk(state, { type: 'createTask', projectId: 'prj_2', title: 'B' }, ctx('2026-09-15T10:00:00+08:00'));

    expect(getNextTask(state, noon)).toMatchObject({ projectId: 'prj_2', projectName: '先建立', taskId: 'tsk_4' });
  });
});
