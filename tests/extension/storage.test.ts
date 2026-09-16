import { beforeEach, describe, expect, test } from 'vitest';
import { loadState, runCommand } from '../../src/extension/storage';
import type { AppState, Command } from '../../src/core';

type Store = Record<string, unknown>;

/**
 * 只假造 chrome.storage.local,因為 Node 沒有這個 API:
 * get 回傳整份資料,set 依 chrome 的語義做淺層合併(只覆蓋傳入的鍵,不刪除其他鍵)。
 * navigator.locks 用 Node 內建的 Web Locks 實作,不另外假造,
 * 這樣 storage.ts 真正的上鎖路徑也會被跑到。
 */
function installFakes(seed: Store): Store {
  const store: Store = structuredClone(seed);
  const local = {
    get: async () => structuredClone(store),
    set: async (items: Store) => {
      Object.assign(store, structuredClone(items));
    },
  };
  globalThis.chrome = {
    storage: { local, onChanged: { addListener: () => {} } },
  } as unknown as typeof chrome;
  return store;
}

const ts = '2026-09-01T09:00:00+08:00';

// schemaVersion 1 的資料:沒有 work-hours、commitments、time-blocks,
// Project 也還沒有 effortEstimateMinutes 和 deadlineRiskOverride。
function v1Store(): Store {
  return {
    meta: { schemaVersion: 1 },
    settings: {
      timezone: 'Asia/Taipei',
      pomodoro: { focusMinutes: 50, breakMinutes: 10 },
      freeTimer: { maxMinutes: 150 },
      updatedAt: ts,
    },
    requesters: [{ id: 'req_self', name: '自己', defaultWeight: 3, status: 'active', createdAt: ts, updatedAt: ts }],
    projects: [
      {
        id: 'interrupt-bucket', kind: 'interruptBucket', name: '臨時工作區', requesterId: null,
        requesterWeightOverride: null, manualPriority: null, startDate: null, endDate: null,
        status: 'active', doneAt: null, createdAt: ts, updatedAt: ts,
      },
      {
        id: 'prj_old', kind: 'project', name: '舊專案', requesterId: 'req_self',
        requesterWeightOverride: null, manualPriority: 3, startDate: '2026-09-01', endDate: null,
        status: 'active', doneAt: null, createdAt: ts, updatedAt: ts,
      },
    ],
    tasks: [{ id: 'tsk_old', projectId: 'prj_old', title: '舊工作', status: 'open', doneAt: null, createdAt: ts, updatedAt: ts }],
    'sessions/2026-09': [{
      id: 'ses_old', taskId: 'tsk_old', mode: 'pomodoro', startedAt: ts, endedAt: '2026-09-01T09:50:00+08:00',
      outcome: 'completed', adHoc: false, interruptedBySessionId: null, endTimeUnconfirmed: false,
      note: '舊紀錄', createdAt: ts, updatedAt: ts,
    }],
    'overrides/2026-09': [{
      id: 'ovr_old', at: ts, type: 'differentTask',
      suggested: { taskId: 'tsk_old' }, actual: { taskId: 'tsk_old' },
    }],
  };
}

describe('storage:schemaVersion 3 遷移', () => {
  let store: Store;

  beforeEach(() => {
    store = installFakes(v1Store());
  });

  test('舊版資料保留既有紀錄,並補上批次 3 的預設值', async () => {
    const state = await loadState();

    // 既有紀錄原封不動
    expect(state.requesters).toHaveLength(1);
    expect(state.tasks).toMatchObject([{ id: 'tsk_old', title: '舊工作' }]);
    expect(state.sessions).toMatchObject([{ id: 'ses_old', outcome: 'completed' }]);
    expect(state.overrides).toMatchObject([{ id: 'ovr_old', type: 'differentTask' }]);
    expect(state.projects.map(p => p.id)).toEqual(['interrupt-bucket', 'prj_old']);

    // Project 補上批次 3 的新欄位
    expect(state.projects.find(p => p.id === 'prj_old')).toMatchObject({
      name: '舊專案',
      effortEstimateMinutes: null,
      deadlineRiskOverride: null,
    });

    // 補上預設週工時、空行程、空鎖定時段
    expect(state.workHours.weekly.mon).toEqual([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }]);
    expect(state.workHours.weekly.sat).toEqual([]);
    expect(state.commitments).toEqual([]);
    expect(state.timeBlocks).toEqual([]);

    // 補上批次 3 才有的設定,既有設定不被覆蓋
    expect(state.settings).toMatchObject({
      timezone: 'Asia/Taipei',
      scheduleWeightFactors: { deadlineUrgency: 0.5, requester: 0.25, manualPriority: 0.25 },
      mustStartBy: { safetyBufferWorkdays: 1, guaranteedMinutesPerDay: 50 },
      deadlineRisk: { lateDays: 0, availablePercent: 120 },
    });
  });

  test('遷移結果寫回 chrome.storage.local,版本標記升到 3', async () => {
    await loadState();

    expect(store.meta).toEqual({ schemaVersion: 3 });
    expect(store['work-hours']).toMatchObject({ weekly: { sat: [] } });
    expect(store.commitments).toEqual([]);
    expect((store.projects as { id: string; effortEstimateMinutes: unknown }[]).find(p => p.id === 'prj_old'))
      .toMatchObject({ effortEstimateMinutes: null });
  });
});

async function run(command: Command): Promise<AppState> {
  const result = await runCommand(command);
  if (!result.ok) throw new Error(`expected ${command.type} to succeed, got: ${result.error.message}`);
  return result.state;
}

describe('storage:按月分檔', () => {
  // 2026-09-15 是週二、2026-10-15 是週四,都在預設工時內。
  // 兩筆鎖定時段依 date 的年月分別落到不同的 storage 鍵,載入時再合併回單一陣列。
  test('鎖定時段依日期分月存放,載入時合併回來', async () => {
    const store = installFakes({});
    await loadState();
    const created = await run({ type: 'createProject', name: '專案', requesterId: 'req_self', startDate: '2026-09-01' });
    const projectId = created.projects.at(-1)!.id;

    await run({ type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '09:00', end: '09:50' });
    await run({ type: 'lockTimeBlock', projectId, date: '2026-10-15', start: '09:00', end: '09:50' });

    expect((store['time-blocks/2026-09'] as { date: string }[]).map(b => b.date)).toEqual(['2026-09-15']);
    expect((store['time-blocks/2026-10'] as { date: string }[]).map(b => b.date)).toEqual(['2026-10-15']);

    const reloaded = await loadState();
    expect(reloaded.timeBlocks.map(b => b.date)).toEqual(['2026-09-15', '2026-10-15']);
  });
});

describe('storage:安全機制', () => {
  test('資料版本比擴充套件新時拒絕載入,避免把新格式覆寫成舊格式', async () => {
    installFakes({ ...v1Store(), meta: { schemaVersion: 4 } });

    await expect(loadState()).rejects.toThrow('資料來自較新版本');
  });

  test('指令失敗時完全不寫入 storage', async () => {
    const store = installFakes({});
    await loadState();
    const before = structuredClone(store);

    const result = await runCommand({ type: 'lockTimeBlock', projectId: 'prj_missing', date: '2026-09-15', start: '09:00', end: '09:50' });

    expect(result.ok).toBe(false);
    expect(store).toEqual(before);
  });
});
