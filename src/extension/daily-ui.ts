import { type AppState, type Command, formatTimestamp, getDaySummary, getDeadlineRiskWarning, getMustStartBy, getProjectRemainingMinutes, getScheduleWeight, getSuggestedTimeBlocks, getLockedTimeBlocks, localDateTime } from '../core';
import { field, h } from './ui';

type Send = (command: Command) => Promise<unknown>;
export function planningView(state: AppState, send?: Send): HTMLElement {
  const now = new Date();
  const suggestions = getSuggestedTimeBlocks(state, now);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(now);
  const projects = state.projects.filter(p => p.kind === 'project' && p.status === 'active');
  const taskProjects = projects.filter(p => state.tasks.some(t => t.projectId === p.id && t.status === 'open'));
  const warningLabels: Record<string, string> = {
    projected_completion_after_deadline: '預估完成日超過截止日',
    available_time_below_threshold: '截止日前可用時間低於門檻',
  };
  return h('section', { className: 'card stack', 'data-planning': '' }, h('strong', {}, '專案排程'),
    ...projects.map(p => {
      const weight = getScheduleWeight(state, p, now); const must = getMustStartBy(state, p.id, now); const warning = getDeadlineRiskWarning(state, p.id, now);
      const remaining = getProjectRemainingMinutes(state, p.id, now);
      return h('div', { className: 'planning-row' }, h('strong', {}, p.name), h('span', { className: 'small' }, `權重 ${weight.total.toFixed(2)}（截止 ${weight.deadlineUrgency.toFixed(2)} · Requester ${weight.requester.toFixed(2)} · 手動 ${weight.manualPriority.toFixed(2)}）`),
        h('span', { className: must && must <= date ? 'small warning' : 'small muted' }, must ? `Must-Start-By ${must}${must <= date ? '（今日保底）' : ''}` : '無 Must-Start-By'),
        warning ? h('span', { className: warning.conditions.length ? 'warning small' : 'small muted' }, warning.conditions.length
          ? `逾期預警：${warning.conditions.map(condition => warningLabels[condition] ?? condition).join('、')}（預估 ${warning.projectedCompletionDate ?? '無法完成'}；剩餘 ${Math.max(0, warning.remainingMinutes).toFixed(0)} 分鐘／可用 ${warning.availableMinutes.toFixed(0)} 分鐘）`
          : `預估完成 ${warning.projectedCompletionDate ?? '尚無法完成'}；剩餘 ${Math.max(0, warning.remainingMinutes).toFixed(0)} 分鐘／可用 ${warning.availableMinutes.toFixed(0)} 分鐘`) : null,
        remaining !== null && remaining <= 0 ? h('span', { className: 'warning small' }, '已用完預估工作量，請重新估計') : null,
        send && suggestions.find(b => b.projectId === p.id) ? h('button', { type: 'button', className: 'small', onclick: () => { const b = suggestions.find(b => b.projectId === p.id)!; void send({ type: 'lockTimeBlock', projectId: p.id, date: b.date, start: b.start, end: b.end }); } }, '鎖定建議') : null);
    }),
    suggestions.length ? h('div', { className: 'suggested-list' }, h('span', { className: 'small muted' }, `今天建議時段（${date}）· 可拖曳到其他建議時段以鎖定`), ...suggestions.map(b => h('div', {
      className: 'small suggested-block', draggable: true, 'data-drop-target': '',
      ondragstart: (event: Event) => { (event as DragEvent).dataTransfer?.setData('application/json', JSON.stringify({ projectId: b.projectId, date: b.date })); },
      ondragover: (event: Event) => event.preventDefault(),
      ondrop: (event: Event) => {
        event.preventDefault();
        const raw = (event as DragEvent).dataTransfer?.getData('application/json');
        if (!raw || !send) return;
        const data = JSON.parse(raw) as { projectId: string; date: string };
        void send({ type: 'lockTimeBlock', projectId: data.projectId, date: data.date, start: b.start, end: b.end });
      },
    }, `${b.start}–${b.end} · ${state.projects.find(p => p.id === b.projectId)?.name ?? ''}`))) : h('span', { className: 'small muted' }, '今天沒有可分配的完整專注時段。'),
    send && taskProjects.length ? h('form', { className: 'row small empty-lock-form', onsubmit: (event: Event) => {
      event.preventDefault();
      const project = (event.currentTarget as HTMLFormElement).querySelector<HTMLSelectElement>('select')!;
      const inputs = (event.currentTarget as HTMLFormElement).querySelectorAll<HTMLInputElement>('input');
      void send({ type: 'lockTimeBlock', projectId: project.value, date, start: inputs[0]!.value, end: inputs[1]!.value });
    } }, h('span', {}, '空檔鎖定'), h('select', {}, ...taskProjects.map(p => h('option', { value: p.id }, p.name))), h('input', { type: 'time', value: '09:00', required: true }), h('span', {}, '–'), h('input', { type: 'time', value: '09:50', required: true }), h('button', { type: 'submit', className: 'small' }, '鎖定')) : null,
    ...getLockedTimeBlocks(state, date).map(b => {
      const start = h('input', { type: 'time', value: b.start, required: true });
      const end = h('input', { type: 'time', value: b.end, required: true });
      return h('form', { className: 'row small locked-row', onsubmit: (event: Event) => {
        event.preventDefault();
        void send?.({ type: 'moveTimeBlock', timeBlockId: b.id, date, start: start.value, end: end.value });
      } }, h('span', { className: 'grow' }, `已鎖定 · ${state.projects.find(p => p.id === b.projectId)?.name ?? ''}`), start, h('span', {}, '–'), end,
        send ? h('button', { type: 'submit', className: 'small' }, '移動') : null,
        send ? h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'unlockTimeBlock', timeBlockId: b.id }) }, '取消鎖定') : null);
    }),
  );
}
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
