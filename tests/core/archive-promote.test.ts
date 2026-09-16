import { describe, expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getCommitmentsForDate,
  getDaySummary,
  getNextTask,
  getProjectRemainingMinutes,
  getSuggestedTimeBlocks,
  SELF_REQUESTER_ID,
} from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup() {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createRequester', name: '主管', defaultWeight: 5 }, ctx);
  state = applyOk(state, { type: 'createProject', name: '專案 A', requesterId: 'req_1', startDate: '2026-09-15', manualPriority: 5 }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_2', title: '任務 A' }, ctx);
  state = applyOk(state, { type: 'createProject', name: '專案 B', requesterId: SELF_REQUESTER_ID, startDate: '2026-09-15', manualPriority: 1 }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_4', title: '任務 B' }, ctx);
  return { state, ctx };
}

describe('封存與刪除', () => {
  test('封存 Project、Task、Commitment 後不再推薦、分配時間或扣可用時間', () => {
    const { state: initial, ctx } = setup();
    let state = applyOk(initial, {
      type: 'createCommitment',
      title: '會議',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '12:00' },
    }, ctx);

    expect(getNextTask(state, ctx.now)).toMatchObject({ projectId: 'prj_2' });
    expect(getDaySummary(state, ctx.now).remainingMinutes).toBe(360);

    state = applyOk(state, { type: 'archiveProject', projectId: 'prj_2' }, ctx);
    state = applyOk(state, { type: 'archiveTask', taskId: 'tsk_5' }, ctx);
    state = applyOk(state, { type: 'archiveCommitment', commitmentId: 'cmt_6' }, ctx);

    expect(getNextTask(state, ctx.now)).toBeNull();
    expect(new Set(getSuggestedTimeBlocks(state, ctx.now).map(block => block.projectId))).toEqual(new Set());
    expect(getCommitmentsForDate(state, '2026-09-15')).toEqual([]);
    expect(getDaySummary(state, ctx.now).remainingMinutes).toBe(480);
  });

  test('內建 Requester 不能封存；有 Work Session 歷史的 Project、Task、Requester 不能刪除', () => {
    const { state: initial, ctx } = setup();
    let state = applyOk(initial, { type: 'startPomodoro', taskId: 'tsk_3' }, ctx);
    ctx.now = at('2026-09-15T09:20:00+08:00');
    state = applyOk(state, { type: 'abandonSession' }, ctx);

    expect(apply(state, { type: 'archiveRequester', requesterId: SELF_REQUESTER_ID }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'deleteProject', projectId: 'prj_2' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'deleteTask', taskId: 'tsk_3' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'deleteRequester', requesterId: 'req_1' }, ctx).ok).toBe(false);
  });

  test('沒有 Work Session 歷史的資料可以刪除', () => {
    const { state: initial, ctx } = setup();
    let state = applyOk(initial, { type: 'createRequester', name: '可刪 Requester', defaultWeight: 3 }, ctx);
    state = applyOk(state, { type: 'deleteTask', taskId: 'tsk_5' }, ctx);
    state = applyOk(state, { type: 'deleteProject', projectId: 'prj_4' }, ctx);
    state = applyOk(state, { type: 'deleteRequester', requesterId: 'req_6' }, ctx);
    state = applyOk(state, {
      type: 'createCommitment',
      title: '可刪行程',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);
    state = applyOk(state, { type: 'deleteCommitment', commitmentId: 'cmt_7' }, ctx);

    expect(state.tasks.some(task => task.id === 'tsk_5')).toBe(false);
    expect(state.projects.some(project => project.id === 'prj_4')).toBe(false);
    expect(state.requesters.some(requester => requester.id === 'req_6')).toBe(false);
    expect(state.commitments).toEqual([]);
  });
});

describe('Ad-hoc Task 升級', () => {
  test('升級後 Task 移到新的 Project，舊 Work Session 保持 adHoc，新 Work Session 算規劃內', () => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
    let state = applyOk(createInitialState(ctx), { type: 'insertAdHocTask', title: '緊急修復' }, ctx);
    ctx.now = at('2026-09-15T09:20:00+08:00');
    state = applyOk(state, { type: 'abandonSession' }, ctx);
    const adHocTaskId = state.tasks[0]!.id;

    state = applyOk(state, {
      type: 'promoteAdHocTaskToProject',
      taskId: adHocTaskId,
      name: '正式追蹤緊急修復',
      requesterId: SELF_REQUESTER_ID,
      startDate: '2026-09-15',
      endDate: '2026-09-20',
      manualPriority: 4,
      effortEstimateMinutes: 100,
    }, ctx);

    const project = state.projects.find(item => item.name === '正式追蹤緊急修復')!;
    expect(project.kind).toBe('project');
    expect(state.tasks.find(task => task.id === adHocTaskId)).toMatchObject({ projectId: project.id });
    expect(state.sessions[0]).toMatchObject({ taskId: adHocTaskId, adHoc: true });
    expect(getProjectRemainingMinutes(state, project.id, ctx.now)).toBe(80);

    ctx.now = at('2026-09-15T10:00:00+08:00');
    state = applyOk(state, { type: 'startPomodoro', taskId: adHocTaskId }, ctx);
    expect(state.sessions[1]).toMatchObject({ taskId: adHocTaskId, adHoc: false });
  });

  test('只能升級 Interrupt Bucket 底下的 Task', () => {
    const { state, ctx } = setup();
    expect(apply(state, {
      type: 'promoteAdHocTaskToProject',
      taskId: 'tsk_3',
      name: '不合法',
      requesterId: SELF_REQUESTER_ID,
      startDate: '2026-09-15',
    }, ctx).ok).toBe(false);
  });
});
