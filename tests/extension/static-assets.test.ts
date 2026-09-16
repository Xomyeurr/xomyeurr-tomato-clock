import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

/**
 * #25 是純 CSS 的行為,jsdom 不套用樣式表,所以直接驗靜態檔案:
 * popup 要掛上 .popup-shell,而 .popup-shell 要隱藏捲軸但保留捲動。
 */

const read = (path: string) => readFileSync(new URL(`../../static/${path}`, import.meta.url), 'utf8');

test('popup shell hides its scrollbar without disabling scrolling', () => {
  expect(read('popup.html')).toContain('<body class="popup-shell">');

  const css = read('styles.css');
  const shell = css.slice(css.indexOf('.popup-shell {'));
  expect(shell).toMatch(/scrollbar-width:\s*none/);
  expect(shell).toMatch(/-ms-overflow-style:\s*none/);
  expect(css).toMatch(/\.popup-shell\s*\*?::-webkit-scrollbar/);

  // 隱藏捲軸不能變成關掉捲動。
  expect(css).not.toMatch(/\.popup-shell[^{]*\{[^}]*overflow:\s*hidden/);
});
