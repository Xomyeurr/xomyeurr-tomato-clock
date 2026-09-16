import { expect, test } from 'vitest';
import { apply, createInitialState, getLockedTimeBlocks, getNextTask, getSuggestedTimeBlocks } from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function setup() {
  const ctx = { now: at('2026-09-15T09:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '高優先', requesterId: 'req_self', startDate: '2026-09-15', manualPriority: 5 }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: '任務 A' }, ctx);
  state = applyOk(state, { type: 'createProject', name: '低優先', requesterId: 'req_self', startDate: '2026-09-15', manualPriority: 1 }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[2]!.id, title: '任務 B' }, ctx);
  return { state, ctx, first: state.projects[1]!.id, second: state.projects[2]!.id };
}

test('suggested blocks allocate only full focus units, exclude Commitments, and lock a block with a snapshot Override', () => {
  const { state: initial, ctx, first } = setup();
  let state = applyOk(initial, { type: 'createCommitment', title: '會議', projectId: null, schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' } }, ctx);
  const suggestions = getSuggestedTimeBlocks(state, ctx.now);
  expect(suggestions.every(b => b.start !== '10:00')).toBe(true);
  expect(suggestions.every(b => b.end !== '12:00')).toBe(true);
  const locked = applyOk(state, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: suggestions[0]!.start, end: suggestions[0]!.end }, ctx);
  expect(getLockedTimeBlocks(locked, '2026-09-15')).toHaveLength(1);
  expect(locked.overrides[0]).toMatchObject({ type: 'lockedTimeBlock', actual: { projectId: first }, suggested: { projectId: first } });
  expect(Object.keys(locked.overrides[0]!.suggested!)).toEqual(['projectId', 'date', 'start', 'end']);
  expect(apply(locked, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: suggestions[0]!.start, end: suggestions[0]!.end }, ctx).ok).toBe(false);
});

test('locked block controls recommendation, moving creates another snapshot and unlocking creates no Override', () => {
  const { state: initial, ctx, first, second } = setup();
  let state = applyOk(initial, { type: 'lockTimeBlock', projectId: second, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);
  expect(getNextTask(state, ctx.now)?.projectId).toBe(second);
  const id = state.timeBlocks[0]!.id;
  state = applyOk(state, { type: 'moveTimeBlock', timeBlockId: id, date: '2026-09-15', start: '13:00', end: '13:50' }, ctx);
  expect(state.overrides).toHaveLength(2);
  expect(state.overrides[1]!.suggested).toMatchObject({ projectId: second, start: '09:00', end: '09:50' });
  const before = state.overrides.length;
  state = applyOk(state, { type: 'unlockTimeBlock', timeBlockId: id }, ctx);
  expect(state.overrides).toHaveLength(before);
  expect(getNextTask(state, at('2026-09-15T09:10:00+08:00'))?.projectId).toBe(first);
});

test('locked project without open Tasks explains fallback to general recommendation', () => {
  const { state: initial, ctx, first } = setup();
  let state = applyOk(initial, { type: 'createProject', name: '空專案', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
  const emptyProject = state.projects[3]!.id;
  state = applyOk(state, { type: 'lockTimeBlock', projectId: emptyProject, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);
  expect(getNextTask(state, at('2026-09-15T09:10:00+08:00'))).toMatchObject({ projectId: first, reason: 'lockedTimeBlockNoTask' });
});

test('creating a Commitment trims conflicting locked Time Blocks', () => {
  const { state: initial, ctx, first } = setup();
  let state = applyOk(initial, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: '09:00', end: '12:00' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '早會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '09:00', end: '10:00' } }, ctx);

  expect(getLockedTimeBlocks(state, '2026-09-15').map(b => [b.start, b.end])).toEqual([['10:00', '12:00']]);
});

test('updating a Commitment splits or removes conflicting locked Time Blocks', () => {
  const { state: initial, ctx, first } = setup();
  let state = applyOk(initial, { type: 'createCommitment', title: '晚點的會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '16:00', end: '17:00' } }, ctx);
  const commitmentId = state.commitments[0]!.id;
  state = applyOk(state, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: '09:00', end: '12:00' }, ctx);
  state = applyOk(state, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: '13:00', end: '14:00' }, ctx);

  state = applyOk(state, { type: 'updateCommitment', commitmentId, title: '跨段會議', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '14:00' } }, ctx);

  expect(getLockedTimeBlocks(state, '2026-09-15').map(b => [b.start, b.end])).toEqual([['09:00', '10:00']]);
});

test('creating a middle Commitment splits a locked Time Block into remaining parts', () => {
  const { state: initial, ctx, first } = setup();
  let state = applyOk(initial, { type: 'lockTimeBlock', projectId: first, date: '2026-09-15', start: '09:00', end: '12:00' }, ctx);
  state = applyOk(state, { type: 'createCommitment', title: '中段會議', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' } }, ctx);

  expect(getLockedTimeBlocks(state, '2026-09-15').map(b => [b.start, b.end])).toEqual([['09:00', '10:00'], ['11:00', '12:00']]);
});
