import { expect, test } from 'vitest';
import { createInitialState, getDeadlineRiskWarning, getMustStartBy } from '../../src/core';
import { applyOk, at, sequentialIds } from '../core/helpers';
const log = (...a: unknown[]) => process.stderr.write('LOG ' + JSON.stringify(a) + '\n');
function build(n: number) {
  const ctx = { now: at('2026-09-15T08:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  // 緊迫截止日 -> 全部已過 Must-Start-By
  for (let i = 0; i < n; i++) state = applyOk(state, { type: 'createProject', name: `P${i}`, requesterId: 'req_self', startDate: '2026-09-01', endDate: '2026-09-18', effortEstimateMinutes: 2000 }, ctx);
  for (const p of state.projects.filter(x => x.kind === 'project')) state = applyOk(state, { type: 'createTask', projectId: p.id, title: 't' }, ctx);
  return { state, ctx };
}
test('perf late projects', () => {
  for (const n of [5, 10, 20]) {
    const { state, ctx } = build(n);
    const ps = state.projects.filter(x => x.kind === 'project');
    log('sample must', getMustStartBy(state, ps[0]!.id, ctx.now));
    const t = Date.now();
    for (const p of ps) getDeadlineRiskWarning(state, p.id, ctx.now);
    log(n, 'late projects: getDeadlineRiskWarning total ms =', Date.now() - t);
  }
  expect(true).toBe(true);
});
