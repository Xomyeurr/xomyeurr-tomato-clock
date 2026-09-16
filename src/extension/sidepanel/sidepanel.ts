import { type AppState, type Command, getDayTimeline } from '../../core';
import { loadState, onStateChanged, runCommand } from '../storage';
import { adHocPromotionForm, confirmationViews, retroactiveForm, summaryView, planningView, sectionTitle } from '../daily-ui';
import { h, preserveDrafts } from '../ui';

const app = document.querySelector<HTMLElement>('#app')!;
const timeline = h('div', { className: 'stack' });
const form = h('div');
const error = h('div', { role: 'alert' });
app.replaceChildren(
  h('header', { className: 'app-header' },
    h('h1', {}, '今日時間軸'),
    h('button', { type: 'button', className: 'ghost', onclick: () => void chrome.runtime.openOptionsPage() }, '設定')),
  error,
  timeline,
  form,
);
async function send(command: Command): Promise<void> {
  const result = await runCommand(command);
  error.className = result.ok ? '' : 'error';
  error.textContent = result.ok ? '' : result.error.message;
  await render(result.ok);
}

function timelineView(state: AppState): HTMLElement {
  const entries = getDayTimeline(state, new Date());
  return h('section', { className: 'card stack theme-timeline' },
    sectionTitle('T', '時間軸'),
    entries.length ? null : h('p', { className: 'empty' }, '今天還沒有時間紀錄。'),
    ...entries.map(e => {
      const status = e.kind === 'session' ? e.outcome === null ? '計時中' : { completed: '完成', abandoned: '放棄', interrupted: '被中斷' }[e.outcome] : e.kind === 'commitment' ? '固定行程' : '上班時段';
      return h('article', { className: `timeline-entry ${e.kind} ${e.outcome ?? 'running'} ${e.adHoc ? 'adhoc' : ''}` },
        h('span', { className: 'small muted' }, `${e.startedAt.slice(11, 16)}–${e.endedAt?.slice(11, 16) ?? '現在'}`),
        h('strong', {}, e.title), h('span', { className: 'small' }, `${status}${e.adHoc ? ' · 臨時工作' : ''}${e.endTimeUnconfirmed ? ' · 結束時間待確認' : ''}`),
        e.note ? h('p', { className: 'session-note' }, e.note) : null);
    }));
}

async function render(updateForm = false): Promise<void> {
  const state = await loadState();
  const restore = updateForm ? () => {} : preserveDrafts(app);
  timeline.replaceChildren(summaryView(state), timelineView(state), planningView(state, send), ...confirmationViews(state, send));
  form.replaceChildren(...[adHocPromotionForm(state, send), retroactiveForm(state, send)].filter((item): item is HTMLElement => item !== null));
  restore();
}
void render();
onStateChanged(() => void render());
setInterval(() => void render(), 30_000);
