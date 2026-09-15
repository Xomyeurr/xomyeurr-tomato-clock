import { type AppState, type Command, formatTimestamp, getDaySummary, localDateTime } from '../core';
import { field, h } from './ui';

type Send = (command: Command) => Promise<unknown>;
export function summaryView(state: AppState, adjust?: Send): HTMLElement {
  const summary = getDaySummary(state, new Date());
  const minutes = (n: number) => `${Math.floor(n)} 分鐘`;
  return h('section', { className: 'card stack', 'data-summary': '' },
    h('strong', {}, `${summary.date} · 今天剩餘 ${minutes(summary.remainingMinutes)}`),
    h('div', { className: 'muted small' }, `規劃內 ${minutes(summary.plannedMinutes)} · 臨時 ${minutes(summary.adHocMinutes)} · 行程已用 ${minutes(summary.commitmentMinutes)}`),
    adjust ? h('div', { className: 'row' },
      h('span', { className: 'small muted' }, `下班時間 ±${state.settings.pomodoro.focusMinutes + state.settings.pomodoro.breakMinutes} 分鐘`),
      h('button', { type: 'button', 'aria-label': '提早下班', onclick: () => void adjust({ type: 'shiftWorkdayEnd', direction: -1 }) }, '−'),
      h('button', { type: 'button', 'aria-label': '延後下班', onclick: () => void adjust({ type: 'shiftWorkdayEnd', direction: 1 }) }, '+')) : null);
}
export function retroactiveForm(state: AppState, send: Send): HTMLElement {
  const task = h('select', { id: 'retro-task' }, h('option', { value: '' }, '建立臨時工作'));
  for (const t of state.tasks.filter(t => t.status !== 'archived')) {
    const project = state.projects.find(p => p.id === t.projectId);
    task.append(h('option', { value: t.id }, `${project?.name ?? ''} / ${t.title}`));
  }
  const title = h('input', { id: 'retro-title', type: 'text', placeholder: '臨時工作名稱' });
  const local = formatTimestamp(new Date(), state.settings.timezone).slice(0, 16);
  const start = h('input', { id: 'retro-start', type: 'datetime-local', value: local, required: true });
  const end = h('input', { id: 'retro-end', type: 'datetime-local', value: local, required: true });
  const note = h('textarea', { id: 'retro-note', rows: 2 });
  const error = h('div', { className: 'error', hidden: true, role: 'alert' });
  return h('details', { className: 'card', id: 'retro-details' }, h('summary', {}, '事後補登'),
    h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault();
      try {
        const timestamp = (value: string) => formatTimestamp(localDateTime(value.slice(0, 10), value.slice(11), state.settings.timezone), state.settings.timezone);
        void send({ type: 'addRetroactiveEntry', taskId: task.value || undefined, adHocTitle: task.value ? undefined : title.value,
          startedAt: timestamp(start.value), endedAt: timestamp(end.value), note: note.value });
      } catch { error.hidden = false; error.textContent = '請輸入有效的本地日期與時間'; }
    } }, h('p', { className: 'small muted' }, `時間依 ${state.settings.timezone}`), field('Task', task), field('新臨時工作名稱（選既有 Task 時不需填）', title),
    field('開始', start), field('結束', end), field('備註', note), error, h('button', { type: 'submit' }, '儲存補登')));
}
export function confirmationViews(state: AppState, send: Send): HTMLElement[] {
  return state.sessions.filter(s => s.endTimeUnconfirmed).map(s => {
    const end = h('input', { id: `confirm-end-${s.id}`, type: 'datetime-local', step: 1, value: s.endedAt!.slice(0, 19), min: s.startedAt.slice(0, 19), max: s.endedAt!.slice(0, 19), required: true });
    const note = h('textarea', { id: `confirm-note-${s.id}`, rows: 2, value: s.note });
    const error = h('div', { className: 'error', hidden: true });
    return h('form', { className: 'card stack', onsubmit: (event: Event) => {
      event.preventDefault();
      try { void send({ type: 'confirmSessionEnd', sessionId: s.id, endedAt: formatTimestamp(localDateTime(end.value.slice(0, 10), end.value.slice(11), state.settings.timezone), state.settings.timezone), note: note.value }); }
      catch { error.hidden = false; error.textContent = '結束時間不正確'; }
    } }, h('strong', {}, `請確認結束時間：${state.tasks.find(t => t.id === s.taskId)?.title ?? ''}`),
      h('p', { className: 'small muted' }, `碼錶已自動停止於 ${s.endedAt!.slice(0, 19).replace('T', ' ')}（${state.settings.timezone}）`),
      field('實際結束時間', end), field('備註', note), error, h('button', { type: 'submit' }, '確認結束時間'));
  });
}
