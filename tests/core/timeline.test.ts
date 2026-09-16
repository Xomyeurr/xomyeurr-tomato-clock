import { expect, test } from 'vitest';
import { createInitialState, getDayTimeline } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

test('today timeline sorts work hours, Commitments, completed entries and running work with notes', () => {
  const ctx = { now: at('2026-09-15T11:00:00+08:00'), newId: sequentialIds() };
  let state = applyOk(createInitialState(ctx), { type: 'createCommitment', title: '週會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '10:30' } }, ctx);
  state = applyOk(state, { type: 'addRetroactiveEntry', adHocTitle: '修復', startedAt: '2026-09-15T09:15:00+08:00', endedAt: '2026-09-15T09:30:00+08:00', note: '已修好' }, ctx);
  state = applyOk(state, { type: 'insertAdHocTask', title: '新工作' }, ctx);
  expect(getDayTimeline(state, ctx.now).map(e => [e.kind, e.title, e.note, e.outcome])).toEqual([
    ['workHours', '上班時段', '', null],
    ['session', '修復', '已修好', 'completed'],
    ['commitment', '週會', '', null],
    ['workHours', '上班時段', '', null],
    ['session', '新工作', '', null],
    ['workHours', '上班時段', '', null],
  ]);
});

test('today timeline subtracts Commitments from work hours', () => {
  const ctx = { now: at('2026-09-15T11:00:00+08:00'), newId: sequentialIds() };
  const state = applyOk(createInitialState(ctx), { type: 'createCommitment', title: '站會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '09:00', end: '10:00' } }, ctx);

  expect(getDayTimeline(state, ctx.now).map(e => [e.kind, e.title, e.startedAt.slice(11, 16), e.endedAt?.slice(11, 16) ?? null])).toEqual([
    ['commitment', '站會', '09:00', '10:00'],
    ['workHours', '上班時段', '10:00', '12:00'],
    ['workHours', '上班時段', '13:00', '18:00'],
  ]);
});
