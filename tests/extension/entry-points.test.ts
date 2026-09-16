// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { app, bootEntryPoint, buttonLabelled, installExtensionEnvironment, type ChromeCalls } from './harness';

/**
 * popup 與側邊欄兩個進入點的迴歸測試,守住批次 5 的決定(#20、#23、#24、#26)。
 * 進入點載入時就會 render,所以每個測試都重載模組。
 */

const NOW = '2026-09-15T09:00:00+08:00';
let calls: ChromeCalls;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  calls = installExtensionEnvironment();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

// #20:側邊欄本身要有前往設定頁的入口,不必再繞到 popup。
test('side panel header opens the options page', async () => {
  await bootEntryPoint('../../src/extension/sidepanel/sidepanel');

  const settings = buttonLabelled(app().querySelector('.app-header')!, '設定');
  settings.click();
  await vi.advanceTimersByTimeAsync(0);

  expect(calls.openOptionsPage).toBe(1);
});

// #23:側邊欄要把「時間軸」排在「專案排程」上方,兩者是分開的主題區塊。
test('side panel stacks summary, then timeline, then planning', async () => {
  await bootEntryPoint('../../src/extension/sidepanel/sidepanel');

  const themed = Array.from(app().querySelectorAll('section.card'))
    .map(section => Array.from(section.classList).find(name => name.startsWith('theme-')))
    .filter((name): name is string => name !== undefined);

  expect(themed).toEqual(['theme-summary', 'theme-timeline', 'theme-planning']);
});

// #24:popup 開著的時候,「今日剩餘時間」要隨時間推進自己更新,不用關掉重開。
test('popup refreshes remaining minutes while it stays open', async () => {
  await bootEntryPoint('../../src/extension/popup/popup');
  const remaining = () => app().querySelector('[data-summary] .section-title')!.textContent!.match(/今天剩餘 (\d+) 分鐘/)![1];

  expect(remaining()).toBe('480');

  // 只把時鐘往前撥,然後讓 popup 的每秒 tick 跑一次(tick 本身也會走掉 1 秒,所以從 10:29:59 撥起)。
  vi.setSystemTime(new Date('2026-09-15T10:29:59+08:00'));
  await vi.advanceTimersByTimeAsync(1000);

  expect(remaining()).toBe('390');
});

// #26:popup 失焦關閉是 Chrome 平台行為;要一直開著就改用側邊欄,入口放在 popup 底部。
test('popup footer opens the side panel instead of pinning the popup', async () => {
  await bootEntryPoint('../../src/extension/popup/popup');

  buttonLabelled(app().querySelector('.footer')!, '開側邊欄').click();
  await vi.advanceTimersByTimeAsync(0);

  expect(calls.sidePanelOpen).toEqual([{ windowId: 7 }]);
});
