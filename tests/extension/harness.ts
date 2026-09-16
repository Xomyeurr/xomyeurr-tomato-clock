import { vi } from 'vitest';

export type ChromeCalls = {
  openOptionsPage: number;
  sidePanelOpen: { windowId: number }[];
};

/**
 * 讓 popup.ts / sidepanel.ts 這種「載入就跑」的進入點能在 jsdom 裡啟動:
 * 補上 Node 與 jsdom 都沒有的 chrome API 和 navigator.locks。
 * storage 用記憶體 store,語義照 chrome 的淺層合併。
 */
export function installExtensionEnvironment(seed: Record<string, unknown> = {}): ChromeCalls {
  const store: Record<string, unknown> = structuredClone(seed);
  const calls: ChromeCalls = { openOptionsPage: 0, sidePanelOpen: [] };

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => structuredClone(store),
        set: async (items: Record<string, unknown>) => { Object.assign(store, structuredClone(items)); },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { openOptionsPage: async () => { calls.openOptionsPage += 1; } },
    windows: { getCurrent: async () => ({ id: 7 }) },
    sidePanel: { open: async (options: { windowId: number }) => { calls.sidePanelOpen.push(options); } },
  } as unknown as typeof chrome;

  // jsdom 的 navigator 沒有 Web Locks,進入點只需要「依序執行」這個語義。
  let chain: Promise<unknown> = Promise.resolve();
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: <T>(_name: string, callback: () => Promise<T>): Promise<T> => {
        const next = chain.then(callback);
        chain = next.catch(() => {});
        return next;
      },
    },
  });

  document.body.innerHTML = '<main id="app"></main>';
  return calls;
}

/** 載入進入點並等它跑完第一次 render。 */
export async function bootEntryPoint(specifier: string): Promise<void> {
  vi.resetModules();
  await import(specifier);
  await vi.advanceTimersByTimeAsync(0);
}

export function app(): HTMLElement {
  return document.querySelector<HTMLElement>('#app')!;
}

export function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find(b => b.textContent === label);
  if (!button) throw new Error(`找不到按鈕「${label}」,現有按鈕:${Array.from(root.querySelectorAll('button')).map(b => b.textContent).join('、')}`);
  return button;
}
