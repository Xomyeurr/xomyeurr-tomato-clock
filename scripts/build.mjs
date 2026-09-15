import { context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outdir = 'dist';
const watch = process.argv.includes('--watch');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const ctx = await context({
  entryPoints: {
    popup: 'src/extension/popup/popup.ts',
    options: 'src/extension/options/options.ts',
    sidepanel: 'src/extension/sidepanel/sidepanel.ts',
    background: 'src/extension/background.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  outdir,
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-static',
      setup(build) {
        build.onEnd(async () => {
          await cp('static', outdir, { recursive: true });
        });
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
  console.log('watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
