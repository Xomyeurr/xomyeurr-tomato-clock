import { describe, expect, test } from 'vitest';
import {
  apply,
  createInitialState,
  getDeadlineRiskWarning,
  getMustStartBy,
  getNextTask,
  getProjectRemainingMinutes,
  getScheduleWeight,
  getSuggestedTimeBlocks,
  type AppState,
  type CommandResult,
  type Context,
} from '../../src/core';
import { applyOk, at, sequentialIds } from './helpers';

function context(iso = '2026-09-15T09:00:00+08:00') {
  const ids = sequentialIds();
  return { ctx: { now: at(iso), newId: ids }, ids };
}

function addProject(
  state: AppState,
  ctx: Context,
  fields: {
    name: string;
    requesterId?: string;
    startDate?: string;
    endDate?: string | null;
    manualPriority?: number;
    effortMinutes?: number;
  },
) {
  state = applyOk(
    state,
    {
      type: 'createProject',
      name: fields.name,
      requesterId: fields.requesterId ?? 'req_self',
      startDate: fields.startDate ?? '2026-09-15',
      endDate: fields.endDate ?? null,
      manualPriority: fields.manualPriority ?? 3,
    },
    ctx,
  );
  const project = state.projects.at(-1)!;
  state = applyOk(state, { type: 'createTask', projectId: project.id, title: `${fields.name} Task` }, ctx);
  if (fields.effortMinutes !== undefined) {
    state = applyOk(state, { type: 'setEffortEstimate', projectId: project.id, value: fields.effortMinutes, unit: 'minutes' }, ctx);
  }
  return { state, projectId: project.id, taskId: state.tasks.at(-1)!.id };
}

describe('批次 3 domain: Effort Estimate and Schedule Weight', () => {
  test('Schedule Weight combines deadline urgency, Requester weight, and manual priority with known scores', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'createRequester', name: '主管', defaultWeight: 5 }, ctx);
    const created = addProject(state, ctx, {
      name: '期限專案',
      requesterId: 'req_1',
      endDate: '2026-09-16',
      manualPriority: 1,
      effortMinutes: 240,
    });

    const project = created.state.projects.find(p => p.id === created.projectId)!;
    const weight = getScheduleWeight(created.state, project, ctx.now);

    expect(weight).toEqual({
      deadlineUrgency: 0.25,
      requester: 1,
      manualPriority: 0,
      total: 0.375,
    });
  });

  test('Project without end date has no Must-Start-By, no Deadline Risk Warning, and zero deadline urgency', () => {
    const { ctx } = context();
    const created = addProject(createInitialState(ctx), ctx, {
      name: '無期限維護',
      manualPriority: 5,
      effortMinutes: 500,
    });
    const project = created.state.projects.find(p => p.id === created.projectId)!;

    expect(getScheduleWeight(created.state, project, ctx.now)).toMatchObject({
      deadlineUrgency: 0,
      requester: 0.5,
      manualPriority: 1,
      total: 0.375,
    });
    expect(getMustStartBy(created.state, created.projectId, ctx.now)).toBeNull();
    expect(getDeadlineRiskWarning(created.state, created.projectId, ctx.now)).toBeNull();
  });

  test('Effort Estimate days use the average of configured workdays, not calendar days', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'mon', ranges: [{ start: '09:00', end: '11:00' }] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'tue', ranges: [{ start: '09:00', end: '13:00' }] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'wed', ranges: [] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'thu', ranges: [] }, ctx);
    state = applyOk(state, { type: 'setWeeklyWorkHours', weekday: 'fri', ranges: [] }, ctx);
    const created = addProject(state, ctx, { name: '平均工作日專案' });

    state = applyOk(created.state, { type: 'setEffortEstimate', projectId: created.projectId, value: 1, unit: 'days' }, ctx);

    expect(state.projects.find(p => p.id === created.projectId)?.effortEstimateMinutes).toBe(180);
  });

  test('remaining Effort Estimate counts abandoned and interrupted Work Sessions, but not linked Commitments', () => {
    const { ctx } = context();
    let { state, projectId, taskId } = addProject(createInitialState(ctx), ctx, {
      name: '投入時間專案',
      effortMinutes: 100,
    });
    state = applyOk(state, { type: 'startPomodoro', taskId }, ctx);
    ctx.now = at('2026-09-15T09:20:00+08:00');
    state = applyOk(state, { type: 'insertAdHocTask', title: '臨時插隊' }, ctx);
    state = applyOk(state, {
      type: 'createCommitment',
      title: '專案會議',
      projectId,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);

    expect(getProjectRemainingMinutes(state, projectId, ctx.now)).toBe(80);
  });
});

describe('批次 3 domain: Must-Start-By and Deadline Risk Warning', () => {
  test('Must-Start-By skips non-working days and subtracts Commitments from available time', () => {
    const { ctx } = context();
    let { state, projectId } = addProject(createInitialState(ctx), ctx, {
      name: '會被壓縮的截止專案',
      endDate: '2026-09-18',
      effortMinutes: 600,
    });
    state = applyOk(state, { type: 'setDayWorkHours', date: '2026-09-17', ranges: [] }, ctx);
    state = applyOk(state, {
      type: 'createCommitment',
      title: '週五半天會議',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-18', start: '09:00', end: '13:00' },
    }, ctx);

    expect(getMustStartBy(state, projectId, ctx.now)).toBe('2026-09-15');
  });

  test('Deadline Risk Warning reports late completion and available-time shortage as separate conditions', () => {
    const { ctx } = context();
    let late = addProject(createInitialState(ctx), ctx, {
      name: '只測預估延遲',
      endDate: '2026-09-15',
      effortMinutes: 500,
    }).state;
    const lateProjectId = late.projects.at(-1)!.id;
    late = applyOk(late, { type: 'setDeadlineRiskThreshold', projectId: lateProjectId, lateDays: 0, availablePercent: 90 }, ctx);

    expect(getDeadlineRiskWarning(late, lateProjectId, ctx.now)).toMatchObject({
      projectedCompletionDate: '2026-09-16',
      availableMinutes: 480,
      remainingMinutes: 500,
      conditions: ['projected_completion_after_deadline'],
    });

    const shortage = addProject(createInitialState(ctx), ctx, {
      name: '只測可用時間不足',
      endDate: '2026-09-16',
      effortMinutes: 900,
    });

    expect(getDeadlineRiskWarning(shortage.state, shortage.projectId, ctx.now)).toMatchObject({
      projectedCompletionDate: '2026-09-16',
      availableMinutes: 960,
      remainingMinutes: 900,
      conditions: ['available_time_below_threshold'],
    });
  });
});

describe('批次 3 domain: Suggested and Locked Time Blocks', () => {
  test('Project past Must-Start-By receives the first Suggested Time Block even when another Project has higher base weight', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const urgent = addProject(state, ctx, {
      name: '今天必須開始',
      endDate: '2026-09-15',
      manualPriority: 1,
      effortMinutes: 480,
    });
    state = urgent.state;
    state = applyOk(state, { type: 'createRequester', name: '重要 requester', defaultWeight: 5 }, ctx);
    const requesterId = state.requesters.at(-1)!.id;
    const highWeight = addProject(state, ctx, {
      name: '高權重但無期限',
      requesterId,
      manualPriority: 5,
      effortMinutes: 480,
    });

    expect(getSuggestedTimeBlocks(highWeight.state, ctx.now)[0]).toMatchObject({
      projectId: urgent.projectId,
      date: '2026-09-15',
      start: '09:00',
      end: '09:50',
    });
    expect(getNextTask(highWeight.state, ctx.now)).toMatchObject({
      projectId: urgent.projectId,
      reason: 'mustStartBy',
    });
  });

  test('locked Time Block is removed from suggestions and counts toward Must-Start-By guarantee', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const urgent = addProject(state, ctx, {
      name: '已鎖保底',
      endDate: '2026-09-15',
      manualPriority: 1,
      effortMinutes: 50,
    });
    state = applyOk(urgent.state, { type: 'createRequester', name: '大權重 requester', defaultWeight: 5 }, ctx);
    const requesterId = state.requesters.at(-1)!.id;
    const highWeight = addProject(state, ctx, {
      name: '下一段應該做',
      requesterId,
      manualPriority: 5,
      effortMinutes: 480,
    });
    state = applyOk(highWeight.state, { type: 'setDayWorkHours', date: '2026-09-15', ranges: [{ start: '09:00', end: '10:40' }] }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId: urgent.projectId, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);

    const suggestions = getSuggestedTimeBlocks(state, ctx.now);

    expect(suggestions).not.toContainEqual(expect.objectContaining({ start: '09:00', end: '09:50' }));
    expect(suggestions[0]).toMatchObject({ projectId: highWeight.projectId, start: '09:50', end: '10:40' });
  });

  test('Suggested Time Blocks ignore Projects that are done, archived, or have no open Task', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const active = addProject(state, ctx, { name: '唯一可做', manualPriority: 3 });
    state = active.state;
    const done = addProject(state, ctx, { name: '已完成專案', manualPriority: 5 });
    state = applyOk(done.state, { type: 'completeProject', projectId: done.projectId }, ctx);
    const archived = addProject(state, ctx, { name: '已封存專案', manualPriority: 5 });
    state = {
      ...archived.state,
      projects: archived.state.projects.map(project =>
        project.id === archived.projectId ? { ...project, status: 'archived' as const } : project,
      ),
    };
    state = applyOk(state, { type: 'createProject', name: '沒有 Task 的專案', requesterId: 'req_self', startDate: '2026-09-15', manualPriority: 5 }, ctx);

    const suggestedProjectIds = new Set(getSuggestedTimeBlocks(state, ctx.now).map(block => block.projectId));

    expect(suggestedProjectIds).toEqual(new Set([active.projectId]));
  });

  test('locking rejects time outside work hours, Commitments, and existing locked Time Blocks', () => {
    const { ctx } = context();
    let { state, projectId } = addProject(createInitialState(ctx), ctx, { name: '鎖定驗證' });
    state = applyOk(state, {
      type: 'createCommitment',
      title: '不能覆蓋的行程',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '13:00', end: '13:50' }, ctx);

    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '08:00', end: '08:50' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '10:10', end: '10:50' }, ctx).ok).toBe(false);
    expect(apply(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '13:20', end: '14:10' }, ctx).ok).toBe(false);
  });

  // 期望值依 docs/data-model.md 的規則手算,不是照實作推回來的:
  // 2026-09-15(週二)預設工時 09:00-12:00 + 13:00-18:00,focus 50 分 → floor(480/50) = 9 個完整單位。
  // 兩個 Project 都沒有截止日(緊迫度 0)、都掛 req_self(權重 3 → 0.5)。
  //   高優先 manualPriority 5 → 0.25×0.5 + 0.25×1.0 = 0.375
  //   低優先 manualPriority 1 → 0.25×0.5 + 0.25×0   = 0.125
  // 最大餘數法:9 × 0.375/0.5 = 6.75 → 先給 6,餘 .75;9 × 0.125/0.5 = 2.25 → 先給 2,餘 .25。
  // 剩下的 1 個單位給餘數大的高優先 → 7 : 2。
  test('remaining focus units are split between Projects by weight using the largest-remainder method', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const high = addProject(state, ctx, { name: '高優先', manualPriority: 5 });
    const low = addProject(high.state, ctx, { name: '低優先', manualPriority: 1 });

    const suggestions = getSuggestedTimeBlocks(low.state, ctx.now);
    const unitsPerProject = new Map<string, number>();
    for (const block of suggestions) unitsPerProject.set(block.projectId, (unitsPerProject.get(block.projectId) ?? 0) + 1);

    expect(suggestions).toHaveLength(9);
    expect(unitsPerProject.get(high.projectId)).toBe(7);
    expect(unitsPerProject.get(low.projectId)).toBe(2);
    // 權重高的先排,所以低優先只拿到當天最後兩段
    expect(suggestions.slice(7).map(block => ({ projectId: block.projectId, start: block.start }))).toEqual([
      { projectId: low.projectId, start: '16:20' },
      { projectId: low.projectId, start: '17:10' },
    ]);
  });
});

describe('批次 3 domain: Moving and unlocking Time Blocks', () => {
  function errorCode(result: CommandResult): string | null {
    return result.ok ? null : result.error.code;
  }

  // 09:00-09:50 與 13:00-13:50 兩段鎖定,加上 10:00-11:00 的 Commitment
  function twoLockedBlocks() {
    const { ctx } = context();
    let { state, projectId } = addProject(createInitialState(ctx), ctx, { name: '移動驗證' });
    state = applyOk(state, {
      type: 'createCommitment',
      title: '固定會議',
      projectId: null,
      schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' },
    }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);
    state = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '13:00', end: '13:50' }, ctx);
    return { state, ctx, morning: state.timeBlocks.find(block => block.start === '09:00')!.id };
  }

  test('moveTimeBlock rejects slots outside work hours, on Commitments, on another locked block, and unknown ids', () => {
    const { state, ctx, morning } = twoLockedBlocks();
    const move = (fields: { timeBlockId?: string; start: string; end: string }) =>
      errorCode(apply(state, {
        type: 'moveTimeBlock',
        timeBlockId: fields.timeBlockId ?? morning,
        date: '2026-09-15',
        start: fields.start,
        end: fields.end,
      }, ctx));

    expect(move({ start: '08:00', end: '08:50' })).toBe('invalid_time_block');
    expect(move({ start: '10:10', end: '10:50' })).toBe('invalid_time_block');
    expect(move({ start: '13:20', end: '14:10' })).toBe('invalid_time_block');
    expect(move({ timeBlockId: 'blk_missing', start: '15:00', end: '15:50' })).toBe('time_block_not_found');
  });

  // 移動時要排除自己,否則任何小幅度挪動都會和原位置重疊而被擋下
  test('moveTimeBlock allows a slot that overlaps the block own current position', () => {
    const { state, ctx, morning } = twoLockedBlocks();

    const moved = applyOk(state, { type: 'moveTimeBlock', timeBlockId: morning, date: '2026-09-15', start: '09:20', end: '10:00' }, ctx);

    expect(moved.timeBlocks.find(block => block.id === morning)).toMatchObject({ start: '09:20', end: '10:00' });
    expect(moved.timeBlocks).toHaveLength(2);
  });

  test('unlockTimeBlock rejects an unknown id', () => {
    const { state, ctx } = twoLockedBlocks();

    expect(errorCode(apply(state, { type: 'unlockTimeBlock', timeBlockId: 'blk_missing' }, ctx))).toBe('time_block_not_found');
  });
});

describe('批次 3 domain: lockedTimeBlock Override snapshot', () => {
  // 建議時段一律從空檔開頭起算 50 分一段(09:00、09:50、10:40…),
  // 所以 09:10-10:00 是合法但從來不曾被建議過的空檔,依 data-model.md 應記成 suggested: null。
  test('locking a gap that was never suggested records a null suggestion, unlike locking a suggested slot', () => {
    const { ctx } = context();
    const { state, projectId } = addProject(createInitialState(ctx), ctx, { name: '空檔鎖定' });

    const gap = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '09:10', end: '10:00' }, ctx);
    const onSuggestion = applyOk(state, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '09:00', end: '09:50' }, ctx);

    expect(gap.overrides.at(-1)).toMatchObject({
      type: 'lockedTimeBlock',
      suggested: null,
      actual: { projectId, date: '2026-09-15', start: '09:10', end: '10:00' },
    });
    expect(onSuggestion.overrides.at(-1)!.suggested).toMatchObject({ projectId, start: '09:00', end: '09:50' });
  });
});

describe('批次 3 domain: what consumes the Must-Start-By guarantee', () => {
  function unitsByProject(blocks: { projectId: string }[]) {
    const counts = new Map<string, number>();
    for (const block of blocks) counts.set(block.projectId, (counts.get(block.projectId) ?? 0) + 1);
    return counts;
  }

  // 兩邊都鎖掉 17:10-18:00,可用時間一樣是 430 分 → 8 個完整單位,權重也完全相同:
  //   urgent 0.5×1 + 0.25×0.5 = 0.625、high 0.25 + 0.25 = 0.5,合計 1.125。
  // 唯一的差別是那段鎖定屬於誰:
  //   鎖給 high → urgent 保底 = ceil(50/50) = 1,先給 1,剩 7 依權重
  //     urgent 7×0.625/1.125 = 3.89 → 3 餘 .89;high 7×0.5/1.125 = 3.11 → 3 餘 .11;餘數歸 urgent
  //     → urgent 1+3+1 = 5、high 3
  //   鎖給 urgent → urgent 保底 = ceil((50-50)/50) = 0,8 個全依權重
  //     urgent 8×0.625/1.125 = 4.44 → 4 餘 .44;high 8×0.5/1.125 = 3.56 → 3 餘 .56;餘數歸 high
  //     → urgent 4、high 4
  test('a locked Time Block counts against the Project own guarantee, not against another Project', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    const urgent = addProject(state, ctx, { name: '今天必須開始', endDate: '2026-09-15', manualPriority: 1, effortMinutes: 480 });
    state = applyOk(urgent.state, { type: 'createRequester', name: '重要 requester', defaultWeight: 5 }, ctx);
    const high = addProject(state, ctx, { name: '高權重無期限', requesterId: state.requesters.at(-1)!.id, manualPriority: 5 });

    const lockedForHigh = applyOk(high.state, { type: 'lockTimeBlock', projectId: high.projectId, date: '2026-09-15', start: '17:10', end: '18:00' }, ctx);
    const lockedForUrgent = applyOk(high.state, { type: 'lockTimeBlock', projectId: urgent.projectId, date: '2026-09-15', start: '17:10', end: '18:00' }, ctx);

    const keepsGuarantee = unitsByProject(getSuggestedTimeBlocks(lockedForHigh, ctx.now));
    const spendsGuarantee = unitsByProject(getSuggestedTimeBlocks(lockedForUrgent, ctx.now));

    expect([keepsGuarantee.get(urgent.projectId), keepsGuarantee.get(high.projectId)]).toEqual([5, 3]);
    expect([spendsGuarantee.get(urgent.projectId), spendsGuarantee.get(high.projectId)]).toEqual([4, 4]);
  });

  // 當天只開 09:00-09:50,剛好一個完整單位。urgent 已過 Must-Start-By,
  // 保底 = ceil(50/50) = 1,所以這個單位一定歸 urgent(即使權重和 high 打平)。
  // 補登 08:00-08:50 的 50 分鐘後保底 = ceil((50-50)/50) = 0,
  // 剩餘工作量同時歸零讓 urgency 也變 0 → urgent 權重 0,單位改判給 high。
  test('work already logged today consumes the Must-Start-By guarantee', () => {
    const { ctx } = context();
    let state = createInitialState(ctx);
    state = applyOk(state, { type: 'setDayWorkHours', date: '2026-09-15', ranges: [{ start: '09:00', end: '09:50' }] }, ctx);
    state = applyOk(state, { type: 'createRequester', name: '弱 requester', defaultWeight: 1 }, ctx);
    const urgent = addProject(state, ctx, {
      name: '今天必須開始',
      requesterId: state.requesters.at(-1)!.id,
      endDate: '2026-09-15',
      manualPriority: 1,
      effortMinutes: 50,
    });
    state = applyOk(urgent.state, { type: 'createRequester', name: '強 requester', defaultWeight: 5 }, ctx);
    const high = addProject(state, ctx, { name: '高權重無期限', requesterId: state.requesters.at(-1)!.id, manualPriority: 5 });

    expect(getSuggestedTimeBlocks(high.state, ctx.now)).toMatchObject([{ projectId: urgent.projectId, start: '09:00', end: '09:50' }]);

    const worked = applyOk(high.state, {
      type: 'addRetroactiveEntry',
      taskId: urgent.taskId,
      startedAt: '2026-09-15T08:00:00+08:00',
      endedAt: '2026-09-15T08:50:00+08:00',
      note: '',
    }, ctx);

    expect(getSuggestedTimeBlocks(worked, ctx.now)).toMatchObject([{ projectId: high.projectId, start: '09:00', end: '09:50' }]);
  });
});

describe('批次 3 domain: deadline urgency when no effort remains', () => {
  // effort 480、截止日是今天,從 09:00 起算當天可用 480 分 → urgency = min(1, 480/480) = 1,
  // 總分 0.5×1 + 0.25×0.5 + 0.25×0.5 = 0.75。
  // 剩餘工作量歸零或變成負數時 urgency 都必須是 0,
  // 只剩 requester(3 → 0.5)和 manualPriority(3 → 0.5)各佔 0.25 → 0.25。
  // 負數那組才真正把關:少了「剩餘 > 0」這個條件,urgency 會算成 -120/480 = -0.25。
  test('deadline urgency drops to zero once no effort remains, and never goes negative when overrun', () => {
    const { ctx } = context();
    const { state, projectId, taskId } = addProject(createInitialState(ctx), ctx, {
      name: '估時已用完',
      endDate: '2026-09-15',
      effortMinutes: 480,
    });
    const weightOf = (next: AppState) => getScheduleWeight(next, next.projects.find(p => p.id === projectId)!, ctx.now);
    const logWork = (startedAt: string) =>
      applyOk(state, { type: 'addRetroactiveEntry', taskId, startedAt, endedAt: '2026-09-15T09:00:00+08:00', note: '' }, ctx);

    expect(weightOf(state)).toMatchObject({ deadlineUrgency: 1, total: 0.75 });

    // 剛好做滿 480 分 → 剩餘 0
    expect(weightOf(logWork('2026-09-15T01:00:00+08:00'))).toEqual({
      deadlineUrgency: 0,
      requester: 0.5,
      manualPriority: 0.5,
      total: 0.25,
    });

    // 做了 600 分、超出估時 → 剩餘 -120,urgency 仍是 0 而不是負數
    expect(weightOf(logWork('2026-09-14T23:00:00+08:00'))).toEqual({
      deadlineUrgency: 0,
      requester: 0.5,
      manualPriority: 0.5,
      total: 0.25,
    });
  });
});

// Story 76:保底衝突時沒拿到保底的 Project 要出預警,不能被默默吞掉。
test('a Project past Must-Start-By that loses the guarantee conflict is warned, not silently starved', () => {
  const ctx = { now: at('2026-09-15T17:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  for (const name of ['甲', '乙']) {
    state = applyOk(state, { type: 'createProject', name, requesterId: 'req_self',
      startDate: '2026-09-01', endDate: '2026-09-21', effortEstimateMinutes: 1500 }, ctx);
  }
  const [winner, loser] = state.projects.filter(p => p.kind === 'project').map(p => p.id);
  state = applyOk(state, { type: 'createTask', projectId: winner!, title: '甲的工作' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: loser!, title: '乙的工作' }, ctx);

  // 17:00 後只剩一個番茄鐘的空檔,兩個 Project 都已過 Must-Start-By,保底只夠一份。
  expect(getMustStartBy(state, loser!, ctx.now)).toBe('2026-09-15');
  expect(getSuggestedTimeBlocks(state, ctx.now).map(b => b.projectId)).toEqual([winner]);

  expect(getDeadlineRiskWarning(state, winner!, ctx.now)!.conditions).not.toContain('guarantee_not_met');
  expect(getDeadlineRiskWarning(state, loser!, ctx.now)!.conditions).toContain('guarantee_not_met');
});

// Story 76 只針對「保底被別人搶走」。沒人拿得到保底的日子(例如休假日)不算衝突,不該每天都叫。
test('a lone late Project is not warned about the guarantee on a day nobody could be allocated time', () => {
  const ctx = { now: at('2026-09-19T17:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '獨自逾期', requesterId: 'req_self',
    startDate: '2026-09-01', endDate: '2026-09-23', effortEstimateMinutes: 1500 }, ctx);
  const projectId = state.projects[1]!.id;
  state = applyOk(state, { type: 'createTask', projectId, title: '工作' }, ctx);
  state = applyOk(state, { type: 'setDayWorkHours', date: '2026-09-19', ranges: [] }, ctx); // 當天休假,沒有人拿得到保底

  expect(getMustStartBy(state, projectId, ctx.now)! <= '2026-09-19').toBe(true);
  expect(getSuggestedTimeBlocks(state, ctx.now)).toEqual([]);
  expect(getDeadlineRiskWarning(state, projectId, ctx.now)!.conditions).not.toContain('guarantee_not_met');
});

// Story 79:沒有未完成 Task 的 Project 本來就不分配時間,不該因為別人拿了保底就被說「分不到保底」。
test('a Project with no open Task is not warned about losing the guarantee', () => {
  const ctx = { now: at('2026-09-15T17:00:00+08:00'), newId: sequentialIds() };
  let state = createInitialState(ctx);
  for (const name of ['有工作', '沒工作']) {
    state = applyOk(state, { type: 'createProject', name, requesterId: 'req_self',
      startDate: '2026-09-01', endDate: '2026-09-21', effortEstimateMinutes: 1500 }, ctx);
  }
  const [busy, idle] = state.projects.filter(p => p.kind === 'project').map(p => p.id);
  state = applyOk(state, { type: 'createTask', projectId: busy!, title: '唯一的工作' }, ctx);

  expect(getMustStartBy(state, idle!, ctx.now)! <= '2026-09-15').toBe(true);
  expect(getSuggestedTimeBlocks(state, ctx.now).map(b => b.projectId)).toEqual([busy]);
  expect(getDeadlineRiskWarning(state, idle!, ctx.now)!.conditions).not.toContain('guarantee_not_met');
});
