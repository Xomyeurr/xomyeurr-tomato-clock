// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createInitialState, type AppState, type Command, type Context } from '../../src/core';
import { applyOk, at, sequentialIds } from '../core/helpers';
import { bootEntryPoint, installExtensionEnvironment, seedFromState } from './harness';

/**
 * Settings page 各區塊的迴歸測試。
 * day-settings 用模組層級的 Set 記住展開中的列,所以每個測試都重載模組。
 */

const NOW = '2026-09-15T09:00:00+08:00';

function fixture(): { state: AppState; ctx: Context } {
  const ctx = { now: at(NOW), newId: sequentialIds() };
  let state = createInitialState(ctx);
  state = applyOk(state, { type: 'createProject', name: '交付功能', requesterId: 'req_self', startDate: '2026-09-15' }, ctx);
  state = applyOk(state, { type: 'createTask', projectId: state.projects[1]!.id, title: '實作' }, ctx);
  return { state, ctx };
}

function recorder(): { sent: Command[]; send: (command: Command) => Promise<boolean> } {
  const sent: Command[] = [];
  return { sent, send: async (command) => { sent.push(command); return true; } };
}

const mount = (element: HTMLElement) => { document.body.replaceChildren(element); return element; };
const byText = (root: ParentNode, selector: string, text: string) =>
  Array.from(root.querySelectorAll(selector)).find(el => el.textContent === text) as HTMLElement | undefined;

async function daySettings() {
  vi.resetModules();
  return import('../../src/extension/options/day-settings');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// 「儲存每週工時」是一顆全域按鈕,展開第二列不該把第一列改到一半的內容默默丟掉。
test('weekly work hours saves every expanded weekday, not just the last one opened', async () => {
  const { workHoursSection } = await daySettings();
  const { state } = fixture();
  const { sent, send } = recorder();
  mount(workHoursSection(state, send));

  const expand = (label: string) => {
    const row = Array.from(document.querySelectorAll('.work-hours-row')).find(r => r.querySelector('.work-hours-day')?.textContent === label)!;
    byText(row, 'button', '編輯')!.click();
  };
  expand('週一');
  expand('週二');

  // 兩列都還展開著。
  expect(document.querySelectorAll('.range-editor').length).toBe(2);

  for (const [index, value] of [['10:00'], ['11:00']].entries()) {
    const editors = document.querySelectorAll('.work-hours-row .range-editor');
    (editors[index]!.querySelector('input[type="time"]') as HTMLInputElement).value = value[0]!;
  }
  document.querySelector('form')!.dispatchEvent(new Event('submit'));
  await vi.advanceTimersByTimeAsync(0);

  expect(sent.map(c => (c as { weekday: string }).weekday)).toEqual(['mon', 'tue']);
});

test('the weekly save button is disabled while no weekday is expanded', async () => {
  const { workHoursSection } = await daySettings();
  const { state } = fixture();
  const { send } = recorder();
  mount(workHoursSection(state, send));

  expect((byText(document, 'button', '儲存每週工時') as HTMLButtonElement).disabled).toBe(true);
});

// 單日調整的表單會先填入週範本當起點,原封不動送出不該把那天釘住。
test('submitting an untouched day override does not pin the date away from the template', async () => {
  const { dayOverrideSection } = await daySettings();
  const { state } = fixture();
  const { sent, send } = recorder();
  mount(dayOverrideSection(state, send));

  document.querySelector('form')!.dispatchEvent(new Event('submit'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toEqual([]);

  // 真的改過就要存。
  (document.querySelector('.stack input[type="time"]') as HTMLInputElement).value = '10:00';
  document.querySelector('form')!.dispatchEvent(new Event('submit'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'setDayWorkHours', date: '2026-09-15' });
});

// 存檔後編輯表單要收起來,不然使用者看不出成功,可能會再按一次。
test('saving an edited Commitment closes the edit form', async () => {
  const { commitmentsSection } = await daySettings();
  const { state: base, ctx } = fixture();
  const state = applyOk(base, { type: 'createCommitment', title: '週會', projectId: null,
    schedule: { type: 'once', date: '2026-09-15', start: '10:00', end: '11:00' } }, ctx);
  const { send } = recorder();
  let refreshed = 0;
  const refresh = async () => { refreshed += 1; };
  mount(commitmentsSection(state, send, refresh));

  byText(document, 'button', '編輯')!.click();
  const editForm = document.querySelector('li.stack form') as HTMLFormElement;
  expect(editForm).not.toBeNull();

  editForm.dispatchEvent(new Event('submit'));
  await vi.advanceTimersByTimeAsync(0);

  expect(refreshed).toBe(1);
});

// 「封存」和「刪除」在同一個下拉選單裡相鄰,刪除必須先確認。
test('deleting a Task asks for confirmation and does nothing when declined', async () => {
  const { state } = fixture();
  installExtensionEnvironment(seedFromState(state));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await bootEntryPoint('../../src/extension/options/options');

  const select = Array.from(document.querySelectorAll('select')).find(
    s => Array.from(s.options).some(o => o.value === 'delete') && Array.from(s.options).some(o => o.value === 'rename'),
  )!;
  expect(select).toBeDefined();
  select.value = 'delete';
  byText(select.closest('li') ?? document, 'button', '執行')!.click();
  await vi.advanceTimersByTimeAsync(0);

  expect(confirm).toHaveBeenCalledOnce();
  // 按取消,Task 還在。
  expect(document.body.textContent).toContain('實作');
});
