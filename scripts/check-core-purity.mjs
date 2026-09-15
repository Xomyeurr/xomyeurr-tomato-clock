import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const forbidden = [
  { pattern: /\bchrome\./, reason: '核心不能使用 Chrome API' },
  { pattern: /\bDate\.now\s*\(/, reason: '核心不能直接讀系統時鐘,請使用傳入的 now' },
  { pattern: /\bnew Date\s*\(\s*\)/, reason: '核心不能直接讀系統時鐘,請使用傳入的 now' },
  { pattern: /\bMath\.random\s*\(/, reason: '核心不能自己產生亂數 id,請使用傳入的 newId' },
  { pattern: /\bcrypto\.randomUUID\s*\(/, reason: '核心不能自己產生亂數 id,請使用傳入的 newId' },
];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return files.flat().filter((f) => f.endsWith('.ts'));
}

const problems = [];
for (const file of await listFiles('src/core')) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, reason } of forbidden) {
      if (pattern.test(line)) problems.push(`${file}:${i + 1} ${reason}\n  ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('core purity check passed');
