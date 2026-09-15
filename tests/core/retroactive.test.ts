import { expect, test } from 'vitest';
import { apply, createInitialState, getDaySummary, INTERRUPT_BUCKET_ID } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

test('Retroactive Entry requires a Task or creates an Ad-hoc Task, and rejects overlapping work', () => {
  const ctx = { now: at('2026-09-16T10:00:00+08:00'), newId: sequentialIds() };
  const initial = createInitialState(ctx);
  const entry = { type: 'addRetroactiveEntry' as const, startedAt: '2026-09-15T23:30:00+08:00', endedAt: '2026-09-16T00:30:00+08:00', note: '補登' };
  expect(apply(initial, { ...entry, taskId: '' }, ctx).ok).toBe(false);
  let state = applyOk(initial, { ...entry, adHocTitle: '夜間修復' }, ctx);
  expect(state.tasks[0]).toMatchObject({ projectId: INTERRUPT_BUCKET_ID, title: '夜間修復' });
  expect(state.sessions[0]).toMatchObject({ taskId: state.tasks[0]!.id, adHoc: true, mode: 'retroactive', outcome: 'completed', note: '補登' });
  expect(getDaySummary(state, ctx.now)).toMatchObject({ adHocMinutes: 30 });
  expect(apply(state, { ...entry, adHocTitle: '重疊', startedAt: '2026-09-16T00:00:00+08:00' }, ctx).ok).toBe(false);
  expect(apply(state, { ...entry, taskId: state.tasks[0]!.id, startedAt: entry.endedAt, endedAt: entry.startedAt }, ctx).ok).toBe(false);
  state = applyOk(state, { ...entry, taskId: state.tasks[0]!.id, startedAt: entry.endedAt, endedAt: '2026-09-16T01:00:00+08:00' }, ctx);
  expect(state.sessions).toHaveLength(2);
  expect(state.sessions[1]!.adHoc).toBe(true);
});
