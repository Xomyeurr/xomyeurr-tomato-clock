import { describe, expect, it } from 'vitest';
import { type AppState, apply, type Context, createInitialState, getTimerStatus } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup() {
  const ids = sequentialIds();
  const ctx = (iso: string) => ({ now: at(iso), newId: ids });
  const morning = ctx('2026-09-15T09:00:00+08:00');
  let state = createInitialState(morning);
  state = applyOk(state, { type: 'createProject', name: '會員系統重構', startDate: '2026-09-15', requesterId: 'req_self' }, morning);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_1', title: '登入流程' }, morning);
  state = applyOk(state, { type: 'createTask', projectId: 'prj_1', title: '權限 bug' }, morning);
  return { state, ctx };
}

describe('基本功能:番茄鐘', () => {
  it('對 Task 開始 Pomodoro,產生計時中的 Work Session', () => {
    const { state, ctx } = setup();

    const next = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    expect(next.sessions).toEqual([
      {
        id: 'ses_4',
        taskId: 'tsk_2',
        mode: 'pomodoro',
        startedAt: '2026-09-15T10:00:00+08:00',
        endedAt: null,
        outcome: null,
        adHoc: false,
        interruptedBySessionId: null,
        endTimeUnconfirmed: false,
        note: '',
        createdAt: '2026-09-15T10:00:00+08:00',
        updatedAt: '2026-09-15T10:00:00+08:00',
      },
    ]);
  });

  it('已經有計時中的 Work Session 時,不能再開始另一個 Pomodoro', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const result = apply(running, { type: 'startPomodoro', taskId: 'tsk_3' }, ctx('2026-09-15T10:05:00+08:00'));

    expect(result.ok ? null : result.error.code).toBe('session_running');
  });

  it.each([
    ['找不到 Task', (s: AppState) => s, 'tsk_nobody', 'task_not_found'],
    ['Task 已經完成', (s: AppState, c: Context) => applyOk(s, { type: 'completeTask', taskId: 'tsk_2' }, c), 'tsk_2', 'task_done'],
    ['Project 已經完成', (s: AppState, c: Context) => applyOk(s, { type: 'completeProject', projectId: 'prj_1' }, c), 'tsk_2', 'project_done'],
  ] as const)('%s時不能開始 Pomodoro', (_label, prepare, taskId, code) => {
    const { state, ctx } = setup();
    const c = ctx('2026-09-15T10:00:00+08:00');

    const result = apply(prepare(state, c), { type: 'startPomodoro', taskId }, c);

    expect(result.ok ? null : result.error.code).toBe(code);
  });

  it('查詢計時狀態:顯示到期時間和剩餘秒數,時間到了回報已到期', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const midway = getTimerStatus(running, at('2026-09-15T10:20:30+08:00'));
    const overdue = getTimerStatus(running, at('2026-09-15T10:55:00+08:00'));

    expect(midway.running).toEqual({
      sessionId: 'ses_4',
      taskId: 'tsk_2',
      taskTitle: '登入流程',
      projectName: '會員系統重構',
      mode: 'pomodoro',
      startedAt: '2026-09-15T10:00:00+08:00',
      dueAt: '2026-09-15T10:50:00+08:00',
      remainingSeconds: 1770,
      isDue: false,
    });
    expect(overdue.running).toMatchObject({ dueAt: '2026-09-15T10:50:00+08:00', remainingSeconds: 0, isDue: true });
  });

  it('沒有計時中的 Work Session 時,計時狀態為空', () => {
    const { state } = setup();

    expect(getTimerStatus(state, at('2026-09-15T10:00:00+08:00')).running).toBeNull();
  });

  it('Pomodoro 到期後結束並寫備註,結束時間固定為開始時間加 50 分鐘', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const done = applyOk(running, { type: 'finishSession', note: ' token 解析完成 ' }, ctx('2026-09-15T11:07:00+08:00'));

    expect(done.sessions[0]).toMatchObject({
      endedAt: '2026-09-15T10:50:00+08:00',
      outcome: 'completed',
      note: 'token 解析完成',
      updatedAt: '2026-09-15T11:07:00+08:00',
    });
    expect(done.tasks.find((t) => t.id === 'tsk_2')?.status).toBe('open');
    expect(getTimerStatus(done, at('2026-09-15T11:07:00+08:00')).running).toBeNull();
  });

  it('結束 Pomodoro 時可以同時把 Task 標記完成,完成時間是按下的當下', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const done = applyOk(running, { type: 'finishSession', note: '', completeTask: true }, ctx('2026-09-15T11:00:00+08:00'));

    expect(done.tasks.find((t) => t.id === 'tsk_2')).toMatchObject({
      status: 'done',
      doneAt: '2026-09-15T11:00:00+08:00',
    });
  });

  it('Pomodoro 還沒到期時不能結束', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const result = apply(running, { type: 'finishSession', note: '' }, ctx('2026-09-15T10:30:00+08:00'));

    expect(result.ok ? null : result.error.code).toBe('not_due');
  });

  it('沒有計時中的 Work Session 時不能結束', () => {
    const { state, ctx } = setup();

    const result = apply(state, { type: 'finishSession', note: '' }, ctx('2026-09-15T10:30:00+08:00'));

    expect(result.ok ? null : result.error.code).toBe('no_running_session');
  });

  it('中途放棄 Pomodoro,記錄實際結束時間並標記為放棄', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const abandoned = applyOk(running, { type: 'abandonSession', note: ' 被叫去開會 ' }, ctx('2026-09-15T10:18:00+08:00'));

    expect(abandoned.sessions[0]).toMatchObject({
      endedAt: '2026-09-15T10:18:00+08:00',
      outcome: 'abandoned',
      note: '被叫去開會',
      updatedAt: '2026-09-15T10:18:00+08:00',
    });
    expect(getTimerStatus(abandoned, at('2026-09-15T10:18:00+08:00')).running).toBeNull();
  });

  it('沒有計時中的 Work Session 時不能放棄', () => {
    const { state, ctx } = setup();

    const result = apply(state, { type: 'abandonSession' }, ctx('2026-09-15T10:18:00+08:00'));

    expect(result.ok ? null : result.error.code).toBe('no_running_session');
  });

  it('Pomodoro 完成後回報休息到幾點,休息結束後就不再顯示', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));
    const done = applyOk(running, { type: 'finishSession', note: '' }, ctx('2026-09-15T10:52:00+08:00'));

    expect(getTimerStatus(done, at('2026-09-15T10:55:00+08:00')).breakEndsAt).toBe('2026-09-15T11:00:00+08:00');
    expect(getTimerStatus(done, at('2026-09-15T11:00:00+08:00')).breakEndsAt).toBeNull();
  });

  it('放棄的 Pomodoro 沒有休息時間;計時中也不顯示休息', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));
    const abandoned = applyOk(running, { type: 'abandonSession' }, ctx('2026-09-15T10:18:00+08:00'));

    expect(getTimerStatus(abandoned, at('2026-09-15T10:20:00+08:00')).breakEndsAt).toBeNull();
    expect(getTimerStatus(running, at('2026-09-15T10:20:00+08:00')).breakEndsAt).toBeNull();
  });

  it('到期後才按放棄,結束時間記成到期的時間,不超過開始時間加 50 分鐘', () => {
    const { state, ctx } = setup();
    const running = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx('2026-09-15T10:00:00+08:00'));

    const abandoned = applyOk(running, { type: 'abandonSession' }, ctx('2026-09-15T11:20:00+08:00'));

    expect(abandoned.sessions[0]).toMatchObject({
      endedAt: '2026-09-15T10:50:00+08:00',
      outcome: 'abandoned',
      updatedAt: '2026-09-15T11:20:00+08:00',
    });
  });

  it('臨時工作區的 Task、已封存的 Task、已封存 Project 底下的 Task 都不能開始 Pomodoro', () => {
    const { state, ctx } = setup();
    const c = ctx('2026-09-15T10:00:00+08:00');
    const codeOf = (result: ReturnType<typeof apply>) => (result.ok ? null : result.error.code);
    const withBucketTask: AppState = {
      ...state,
      tasks: [...state.tasks, { ...state.tasks[0]!, id: 'tsk_bucket', projectId: 'interrupt-bucket' }],
    };
    const archivedTask: AppState = {
      ...state,
      tasks: state.tasks.map((t) => (t.id === 'tsk_2' ? { ...t, status: 'archived' as const } : t)),
    };
    const archivedProject: AppState = {
      ...state,
      projects: state.projects.map((p) => (p.id === 'prj_1' ? { ...p, status: 'archived' as const } : p)),
    };

    expect(codeOf(apply(withBucketTask, { type: 'startPomodoro', taskId: 'tsk_bucket' }, c))).toBe('task_not_startable');
    expect(codeOf(apply(archivedTask, { type: 'startPomodoro', taskId: 'tsk_2' }, c))).toBe('task_not_startable');
    expect(codeOf(apply(archivedProject, { type: 'startPomodoro', taskId: 'tsk_2' }, c))).toBe('task_not_startable');
  });
});
