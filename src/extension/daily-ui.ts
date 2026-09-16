import { type AppState, type Command, formatTimestamp, getDaySummary, getDeadlineRiskWarning, getMustStartBy, getProjectRemainingMinutes, getScheduleWeight, getSuggestedTimeBlocks, getLockedTimeBlocks, INTERRUPT_BUCKET_ID, SELF_REQUESTER_ID, localDateTime } from '../core';
import { field, h } from './ui';

type Send = (command: Command) => Promise<unknown>;

export function sectionTitle(icon: string, title: string): HTMLElement {
  return h('div', { className: 'section-title' }, h('span', { className: 'section-icon', 'aria-hidden': 'true' }, icon), h('strong', {}, title));
}

export function planningView(state: AppState, send?: Send): HTMLElement {
  const now = new Date();
  const suggestions = getSuggestedTimeBlocks(state, now);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(now);
  const projects = state.projects.filter(p => p.kind === 'project' && p.status === 'active');
  const warningLabels: Record<string, string> = {
    projected_completion_after_deadline: '預估完成日超過截止日',
    available_time_below_threshold: '截止日前可用時間低於門檻',
    guarantee_not_met: '今天分不到每日保底時間',
  };
  return h('section', { className: 'card stack theme-planning', 'data-planning': '' }, sectionTitle('P', '專案排程'),
    ...projects.map(p => {
      const weight = getScheduleWeight(state, p, now); const must = getMustStartBy(state, p.id, now); const warning = getDeadlineRiskWarning(state, p.id, now);
      const remaining = getProjectRemainingMinutes(state, p.id, now);
      return h('div', { className: 'planning-row' }, h('strong', {}, p.name), h('span', { className: 'small' }, `權重 ${weight.total.toFixed(2)}（截止 ${weight.deadlineUrgency.toFixed(2)} · Requester ${weight.requester.toFixed(2)} · 手動 ${weight.manualPriority.toFixed(2)}）`),
        h('span', { className: must && must <= date ? 'small warning' : 'small muted' }, must ? `Must-Start-By ${must}${must <= date ? '（今日保底）' : ''}` : '無 Must-Start-By'),
        warning ? h('span', { className: warning.conditions.length ? 'warning small' : 'small muted' }, warning.conditions.length
          ? `逾期預警：${warning.conditions.map(condition => warningLabels[condition] ?? condition).join('、')}（預估 ${warning.projectedCompletionDate ?? '無法完成'}；剩餘 ${Math.max(0, warning.remainingMinutes).toFixed(0)} 分鐘／可用 ${warning.availableMinutes.toFixed(0)} 分鐘）`
          : `預估完成 ${warning.projectedCompletionDate ?? '尚無法完成'}；剩餘 ${Math.max(0, warning.remainingMinutes).toFixed(0)} 分鐘／可用 ${warning.availableMinutes.toFixed(0)} 分鐘`) : null,
        remaining !== null && remaining <= 0 ? h('span', { className: 'warning small' }, '已用完預估工作量，請重新估計') : null,
      );
    }),
    suggestions.length ? h('div', { className: 'suggested-list stack tight' }, h('span', { className: 'small muted' }, `今天建議時段（${date}）`), ...suggestions.map(b => {
      const project = state.projects.find(p => p.id === b.projectId);
      return h('article', {
      className: 'suggested-block',
      draggable: true,
      'data-drop-target': '',
      ondragstart: (event: Event) => { (event as DragEvent).dataTransfer?.setData('application/json', JSON.stringify({ projectId: b.projectId, date: b.date })); },
      ondragover: (event: Event) => event.preventDefault(),
      ondrop: (event: Event) => {
        event.preventDefault();
        const raw = (event as DragEvent).dataTransfer?.getData('application/json');
        if (!raw || !send) return;
        const data = JSON.parse(raw) as { projectId: string; date: string };
        void send({ type: 'lockTimeBlock', projectId: data.projectId, date: data.date, start: b.start, end: b.end });
      },
    },
    h('div', { className: 'suggested-main' },
      h('span', { className: 'suggested-time' }, `${b.start}–${b.end}`),
      h('strong', {}, project?.name ?? ''),
    ),
    send ? h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'lockTimeBlock', projectId: b.projectId, date: b.date, start: b.start, end: b.end }) }, '鎖定') : null,
    );
  })) : h('span', { className: 'small muted' }, '今天沒有可分配的完整專注時段。'),
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
    gapLockForm(state, date, send),
  );
}

/**
 * 建議時段以外的空檔也要鎖得住:今天的時間可能全被權重高的 Project 分走,
 * 或根本沒有完整空檔可建議,這時仍然要能把某段時間留給指定的 Project。
 * 收在 details 裡當次要操作,主要路徑還是每個建議時段自己的「鎖定」按鈕(#22)。
 */
function gapLockForm(state: AppState, date: string, send?: Send): HTMLElement | null {
  if (!send) return null;
  const lockable = state.projects.filter(p => p.kind === 'project' && p.status === 'active'
    && state.tasks.some(t => t.projectId === p.id && t.status === 'open'));
  if (!lockable.length) return null;
  const project = h('select', { 'aria-label': '要鎖定的專案' }, ...lockable.map(p => h('option', { value: p.id }, p.name)));
  const start = h('input', { type: 'time', value: '09:00', required: true, 'aria-label': '開始時間' });
  const end = h('input', { type: 'time', value: '09:50', required: true, 'aria-label': '結束時間' });
  return h('details', { className: 'gap-lock', id: 'gap-lock-details' },
    h('summary', { className: 'small' }, '鎖定其他時段'),
    h('form', { className: 'row small', onsubmit: (event: Event) => {
      event.preventDefault();
      void send({ type: 'lockTimeBlock', projectId: project.value, date, start: start.value, end: end.value });
    } }, project, start, h('span', {}, '–'), end, h('button', { type: 'submit', className: 'small' }, '鎖定')));
}
export function summaryView(state: AppState, adjust?: Send): HTMLElement {
  const summary = getDaySummary(state, new Date());
  const minutes = (n: number) => `${Math.floor(n)} 分鐘`;
  return h('section', { className: 'card stack theme-summary', 'data-summary': '' },
    sectionTitle('D', `${summary.date} · 今天剩餘 ${minutes(summary.remainingMinutes)}`),
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

export function adHocPromotionForm(state: AppState, send: Send): HTMLElement | null {
  const tasks = state.tasks.filter(task => task.projectId === INTERRUPT_BUCKET_ID && task.status === 'open');
  const requesters = state.requesters.filter(requester => requester.status === 'active');
  if (!tasks.length || !requesters.length) return null;
  const task = h('select', { id: 'promote-task' }, ...tasks.map(item => h('option', { value: item.id }, item.title)));
  const name = h('input', { id: 'promote-name', type: 'text', required: true, placeholder: '新的 Project 名稱' });
  const requester = h('select', { id: 'promote-requester' }, ...requesters.map(item => h('option', { value: item.id }, item.name)));
  requester.value = requesters.some(item => item.id === SELF_REQUESTER_ID) ? SELF_REQUESTER_ID : requesters[0]!.id;
  const start = h('input', { id: 'promote-start', type: 'date', value: new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(new Date()), required: true });
  const end = h('input', { id: 'promote-end', type: 'date' });
  const priority = h('select', { id: 'promote-priority' }, ...[1, 2, 3, 4, 5].map(value => h('option', { value }, String(value))));
  priority.value = '3';
  const estimate = h('input', { id: 'promote-estimate', type: 'number', min: 1, placeholder: '可留白' });
  return h('details', { className: 'card', id: 'promote-details' }, h('summary', {}, '臨時工作升級成 Project'),
    h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault();
      void send({
        type: 'promoteAdHocTaskToProject',
        taskId: task.value,
        name: name.value,
        requesterId: requester.value,
        startDate: start.value,
        endDate: end.value || null,
        manualPriority: Number(priority.value),
        effortEstimateMinutes: estimate.value ? Number(estimate.value) : null,
      });
    } }, field('臨時工作', task), field('Project 名稱', name),
      h('div', { className: 'grid' }, field('Requester', requester), field('開始日', start), field('截止日', end), field('手動優先級', priority), field('預估分鐘', estimate)),
      h('button', { type: 'submit' }, '升級成 Project')));
}
