import { expect, test } from 'vitest';
import { apply, createInitialState, getCommitmentsForDate } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

test('single and weekly Commitments expand within their dates and allow editing and skipping one occurrence', () => {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'createCommitment', title: '週會', projectId: null,
    schedule: { type: 'weekly', weekdays: ['tue'], start: '10:00', end: '11:00', fromDate: '2026-09-15', untilDate: '2026-09-22' } }, ctx);
  const id = state.commitments[0]!.id;
  expect(getCommitmentsForDate(state, '2026-09-15').map(c => c.title)).toEqual(['週會']);
  for (const date of ['2026-09-08', '2026-09-16', '2026-09-29']) expect(getCommitmentsForDate(state, date)).toEqual([]);
  state = applyOk(state, { type: 'skipCommitment', commitmentId: id, date: '2026-09-22' }, ctx);
  expect(getCommitmentsForDate(state, '2026-09-22')).toEqual([]);
  state = applyOk(state, { type: 'updateCommitment', commitmentId: id, title: '單次', projectId: null,
    schedule: { type: 'once', date: '2026-09-16', start: '13:00', end: '14:00' } }, ctx);
  expect(getCommitmentsForDate(state, '2026-09-15')).toEqual([]);
  expect(getCommitmentsForDate(state, '2026-09-16').map(c => c.title)).toEqual(['單次']);
  expect(apply(state, { type: 'createCommitment', title: '錯誤', projectId: null,
    schedule: { type: 'weekly', weekdays: [], start: '10:00', end: '11:00', fromDate: '2026-09-15', untilDate: null } }, ctx).ok).toBe(false);
  expect(apply(state, { type: 'createCommitment', title: '錯誤', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '11:00', end: '10:00' } }, ctx).ok).toBe(false);
  state = applyOk(state, { type: 'archiveCommitment', commitmentId: id }, ctx);
  expect(getCommitmentsForDate(state, '2026-09-15')).toEqual([]);
});

test('work takes precedence over overlapping Commitments and linked Commitments do not add project work', async () => {
  const { SELF_REQUESTER_ID, getDaySummary } = await import('../../src/core');
  const ctx = { now: at('2026-09-15T10:30:00+08:00'), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'createProject', name: '專案', requesterId: SELF_REQUESTER_ID, startDate: '2026-09-15' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: '工作' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '會議', projectId: state.projects[1]!.id,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '12:00' } }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '重疊會議', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '11:00', end: '12:00' } }, ctx);
  state = applyOk(state, { type: 'startPomodoro', taskId: state.tasks[0]!.id }, ctx);
  ctx.now = at('2026-09-15T11:00:00+08:00');
  state = applyOk(state, { type: 'abandonSession' }, ctx);
  expect(getDaySummary(state, ctx.now)).toMatchObject({ plannedMinutes: 30, adHocMinutes: 0, commitmentMinutes: 30, remainingMinutes: 300 });
  expect(state.sessions).toHaveLength(1);
  expect(state.projects[1]!.effortEstimateMinutes).toBe(null);
});
