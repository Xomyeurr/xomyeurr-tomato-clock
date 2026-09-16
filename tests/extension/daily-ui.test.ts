// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createInitialState, type AppState, type Command, type Context } from '../../src/core';
import { planningView, summaryView } from '../../src/extension/daily-ui';
import { applyOk, at, sequentialIds } from '../core/helpers';

/**
 * 這些測試守住批次 5 的 UI 決定(#20、#22–#26),
 * 用 jsdom 直接檢查 view function 產出的 DOM,不靠人工看畫面。
 */

const NOW = '2026-09-15T08:00:00+08:00';

function fixture(): { state: AppState; ctx: Context; projectId: string } {
  const ctx = { now: at(NOW), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '交付功能', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
  const projectId = state.projects[1]!.id;
  state = applyOk(state, { type: 'createTask', projectId, title: '實作' }, ctx);
  return { state, ctx, projectId };
}

function recorder(): { sent: Command[]; send: (command: Command) => Promise<unknown> } {
  const sent: Command[] = [];
  return { sent, send: async (command) => { sent.push(command); return undefined; } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

// #23:專案排程與時間軸要是視覺上分得開的兩個區塊,各自有主題色與圖示。
test('planning and summary render as separately themed, titled cards', () => {
  const { state } = fixture();

  const planning = planningView(state);
  expect(planning.classList.contains('theme-planning')).toBe(true);
  expect(planning.querySelector('.section-title')?.textContent).toContain('專案排程');
  expect(planning.querySelector('.section-icon')?.textContent).toBe('P');

  const summary = summaryView(state);
  expect(summary.classList.contains('theme-summary')).toBe(true);
  expect(summary.querySelector('.section-icon')?.textContent).toBe('D');
  // 兩個區塊的主題 class 不能相同,否則使用者分不出來。
  expect(planning.className).not.toBe(summary.className);
});

// #22:每一個建議時段自己就要帶操作按鈕。
test('each suggested time block carries its own lock button', () => {
  const { state } = fixture();
  const { sent, send } = recorder();

  const blocks = Array.from(planningView(state, send).querySelectorAll('.suggested-block'));
  expect(blocks.length).toBeGreaterThan(0);

  for (const block of blocks) {
    const button = block.querySelector('button');
    expect(button?.textContent).toBe('鎖定');
  }

  const first = blocks[0]!;
  const time = first.querySelector('.suggested-time')!.textContent!;
  first.querySelector('button')!.dispatchEvent(new Event('click'));

  expect(sent).toEqual([
    { type: 'lockTimeBlock', projectId: expect.any(String), date: '2026-09-15', start: time.split('–')[0], end: time.split('–')[1] },
  ]);
});

// #22:不要再依賴下方的下拉選單來選對象。
test('planning view exposes no target-picking dropdown', () => {
  const { state } = fixture();
  const { send } = recorder();

  expect(planningView(state, send).querySelectorAll('select')).toHaveLength(0);
});

// #22:精簡文字說明 —— 建議時段只講時間和專案,不放大段敘述。
test('a suggested block states only its time range and project name', () => {
  const { state } = fixture();

  const main = planningView(state).querySelector('.suggested-block .suggested-main')!;
  expect(main.querySelector('.suggested-time')!.textContent).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  expect(main.querySelector('strong')!.textContent).toBe('交付功能');
  expect(main.children).toHaveLength(2);
});

// #22:鎖定後的時段也要能就地操作,不用回到別的表單。
test('locked time blocks can be moved and unlocked in place', () => {
  const { state: base, ctx, projectId } = fixture();
  const state = applyOk(base, { type: 'lockTimeBlock', projectId, date: '2026-09-15', start: '09:00', end: '10:00' }, ctx);
  const { sent, send } = recorder();

  const row = planningView(state, send).querySelector('.locked-row') as HTMLFormElement;
  expect(Array.from(row.querySelectorAll('button')).map(b => b.textContent)).toEqual(['移動', '取消鎖定']);

  const [start, end] = Array.from(row.querySelectorAll('input[type="time"]')) as HTMLInputElement[];
  expect([start!.value, end!.value]).toEqual(['09:00', '10:00']);

  end!.value = '11:00';
  row.dispatchEvent(new Event('submit'));
  expect(sent).toEqual([{ type: 'moveTimeBlock', timeBlockId: expect.any(String), date: '2026-09-15', start: '09:00', end: '11:00' }]);
});

// #24:popup 要能定點替換 summary,所以 summary 必須帶得住的 hook。
test('summary exposes the data-summary hook used for in-place refresh', () => {
  const { state } = fixture();

  expect(summaryView(state).getAttribute('data-summary')).toBe('');
});

// #24:剩餘時間是即時計算值,同一份 state 在時間推進後要算出更少的剩餘分鐘。
test('summary recomputes remaining minutes as the clock advances', () => {
  const { state } = fixture();
  const remaining = () => Number(summaryView(state).querySelector('.section-title')!.textContent!.match(/今天剩餘 (\d+) 分鐘/)![1]);

  const before = remaining();
  vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'));
  const after = remaining();

  expect(before).toBe(480); // 09:00–12:00 與 13:00–18:00
  expect(after).toBe(420); // 10:00 之後只剩 120 + 300 分鐘
});

// Story 70:剩餘工作量用完但 Project 還沒完成時,要持續提醒重新估計。
test('planning view keeps asking for a re-estimate once the effort estimate is used up', () => {
  const { state: base, ctx, projectId } = fixture();
  let state = applyOk(base, { type: 'setEffortEstimate', projectId, value: 30, unit: 'minutes' }, ctx);
  state = applyOk(state, { type: 'addRetroactiveEntry', taskId: state.tasks[0]!.id,
    startedAt: '2026-09-14T09:00:00+08:00', endedAt: '2026-09-14T10:00:00+08:00', note: '' }, ctx);

  const row = planningView(state).querySelector('.planning-row')!;
  expect(row.textContent).toContain('已用完預估工作量，請重新估計');
});
