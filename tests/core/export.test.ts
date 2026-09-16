import { describe, expect, test } from 'vitest';
import { createInitialState, exportDataFiles } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

describe('資料匯出', () => {
  test('把 AppState 轉成 ./data 檔案路徑和 JSON 內容，並依月份分檔', () => {
    const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'createProject', name: '專案', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
    state = applyOk(state, { type: 'createTask', projectId: 'prj_1', title: '工作' }, ctx);
    state = applyOk(state, { type: 'startPomodoro', taskId: 'tsk_2' }, ctx);
    ctx.now = at('2026-09-15T09:50:00+08:00');
    state = applyOk(state, { type: 'finishSession', note: '完成' }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId: 'prj_1', date: '2026-09-16', start: '09:00', end: '09:50' }, ctx);

    const files = exportDataFiles(state, at('2026-09-16T10:00:00+08:00'));

    expect(Object.keys(files).sort()).toEqual([
      'commitments.json',
      'meta.json',
      'overrides/2026-09.json',
      'projects.json',
      'requesters.json',
      'sessions/2026-09.json',
      'settings.json',
      'tasks.json',
      'time-blocks/2026-09.json',
      'work-hours.json',
    ]);
    expect(JSON.parse(files['meta.json']!)).toEqual({
      schemaVersion: 3,
      exportedAt: '2026-09-16T10:00:00+08:00',
    });
    expect(JSON.parse(files['projects.json']!)).toMatchObject({
      schemaVersion: 3,
      items: expect.arrayContaining([expect.objectContaining({ id: 'prj_1', name: '專案' })]),
    });
    expect(JSON.parse(files['sessions/2026-09.json']!)).toMatchObject({
      schemaVersion: 3,
      items: [expect.objectContaining({ id: 'ses_3', taskId: 'tsk_2' })],
    });
    expect(JSON.parse(files['time-blocks/2026-09.json']!)).toMatchObject({
      schemaVersion: 3,
      items: [expect.objectContaining({ id: 'blk_5', projectId: 'prj_1', date: '2026-09-16' })],
    });
    expect(JSON.parse(files['settings.json']!).schemaVersion).toBe(3);
    expect(JSON.parse(files['work-hours.json']!).schemaVersion).toBe(3);
  });
});
