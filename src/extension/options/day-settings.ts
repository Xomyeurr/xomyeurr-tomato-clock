import { type AppState, type Command, type Commitment, type CommitmentSchedule, getWorkRanges, type TimeRange, type Weekday } from '../../core';
import { field, h, todayIn } from '../ui';

type Send = (command: Command) => Promise<boolean>;
type Refresh = () => Promise<void>;
const weekdays: [Weekday, string][] = [['mon', '週一'], ['tue', '週二'], ['wed', '週三'], ['thu', '週四'], ['fri', '週五'], ['sat', '週六'], ['sun', '週日']];
const editingWeekdays = new Set<Weekday>();
const editingCommitments = new Set<string>();
function rangesEditor(ranges: TimeRange[], compact = false) {
  const rows = h('div', { className: compact ? 'range-list' : 'stack' });
  const controls: { start: HTMLInputElement; end: HTMLInputElement; row: HTMLElement }[] = [];
  function add(range: TimeRange = { start: '09:00', end: '18:00' }): void {
    const start = h('input', { type: 'time', value: range.start, required: true, 'aria-label': '上班時間' });
    const end = h('input', { type: 'time', value: range.end, required: true, 'aria-label': '下班時間' });
    const row = h('div', { className: compact ? 'range-row compact' : 'row' }, start, end,
      h('button', { type: 'button', className: compact ? 'small ghost' : undefined, 'aria-label': '移除時段', onclick: () => row.remove() }, compact ? 'x' : '移除時段'));
    controls.push({ start, end, row }); rows.append(row);
  }
  ranges.forEach(add);
  return { element: h('div', { className: compact ? 'range-editor compact' : 'stack' }, rows,
    h('button', { type: 'button', className: compact ? 'small' : undefined, 'aria-label': '新增時段', onclick: () => add() }, compact ? '+' : '新增時段')),
    read: () => controls.filter(c => c.row.parentElement === rows).map(c => ({ start: c.start.value, end: c.end.value })) };
}
function sameRanges(a: TimeRange[], b: TimeRange[]): boolean {
  return a.length === b.length && a.every((range, index) => range.start === b[index]?.start && range.end === b[index]?.end);
}
function rangeSummary(ranges: TimeRange[]): string {
  return ranges.length ? ranges.map(r => `${r.start}-${r.end}`).join('、') : '不上班';
}
export function workHoursSection(state: AppState, send: Send): HTMLElement {
  const rows = weekdays.map(([weekday, label]) => ({
    weekday,
    label,
    ranges: state.workHours.weekly[weekday],
    editor: editingWeekdays.has(weekday) ? rangesEditor(state.workHours.weekly[weekday], true) : null,
  }));
  return h('section', { className: 'card stack' }, h('h2', {}, '每週工時範本'),
    h('p', { className: 'small muted' }, `時間依 ${state.settings.timezone}。週一到週日一眼可看；點一列編輯，移除全部時段並儲存代表不上班。`),
    h('form', { className: 'stack', onsubmit: async (event: Event) => {
      event.preventDefault();
      for (const row of rows.filter(item => item.editor !== null)) {
        const editor = row.editor;
        if (!editor) continue;
        const ranges = editor.read();
        if (!sameRanges(ranges, state.workHours.weekly[row.weekday])) await send({ type: 'setWeeklyWorkHours', weekday: row.weekday, ranges });
      }
    } },
    h('div', { className: 'work-hours-grid' }, ...rows.map(row =>
      h('div', { className: 'work-hours-row' },
        h('strong', { className: 'work-hours-day' }, row.label),
        row.editor ? h('div', { className: 'grow' }, row.editor.element) : h('div', { className: 'grow work-hours-summary' }, rangeSummary(row.ranges)),
        h('button', { type: 'button', className: 'small', onclick: (event: Event) => {
          if (editingWeekdays.has(row.weekday)) editingWeekdays.delete(row.weekday);
          else {
            editingWeekdays.clear();
            editingWeekdays.add(row.weekday);
          }
          (event.currentTarget as HTMLElement).closest('section')?.replaceWith(workHoursSection(state, send));
        } }, row.editor ? '收合' : '編輯')))),
    h('button', { type: 'submit', className: 'primary' }, '儲存每週工時')));
}
export function dayOverrideSection(state: AppState, send: Send): HTMLElement {
  const date = h('input', { type: 'date', value: todayIn(state.settings.timezone), required: true });
  const rangesForDate = (value: string) => (state.workHours.dayOverrides[value] ?? getWorkRanges(state, value)).map(r => ({ ...r }));
  let editor = rangesEditor(rangesForDate(date.value));
  const holder = h('div', {}, editor.element);
  const loadDate = (value: string) => { date.value = value; editor = rangesEditor(rangesForDate(date.value)); holder.replaceChildren(editor.element); };
  date.addEventListener('change', () => loadDate(date.value));
  const overrideDates = Object.keys(state.workHours.dayOverrides).sort();
  return h('section', { className: 'card stack' }, h('h2', {}, '單日調整'),
    h('p', { className: 'small muted' }, '單日調整只覆蓋選定日期；沒有調整的日期會沿用每週工時範本。'),
    h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault(); void send({ type: 'setDayWorkHours', date: date.value, ranges: editor.read() });
    } }, field('日期', date), holder, h('div', { className: 'row' }, h('button', { type: 'submit' }, '儲存單日調整'),
      h('button', { type: 'button', onclick: () => void send({ type: 'resetDayWorkHours', date: date.value }) }, '恢復週範本'))),
    h('div', { className: 'row' }, h('span', { className: 'small muted' }, '已調整：'), overrideDates.length ? null : h('span', { className: 'small muted' }, '無'),
      ...overrideDates.map(value => h('button', { type: 'button', className: 'small', onclick: () => loadDate(value) }, value))));
}
function commitmentForm(state: AppState, send: Send, commitment?: Commitment, afterSubmit?: () => void, refresh?: Refresh): HTMLElement {
  const schedule = commitment?.schedule;
  const title = h('input', { type: 'text', value: commitment?.title ?? '', required: true });
  const type = h('select', {}, h('option', { value: 'once' }, '單次'), h('option', { value: 'weekly' }, '每週重複'));
  type.value = schedule?.type ?? 'once';
  const start = h('input', { type: 'time', value: schedule?.start ?? '10:00', required: true });
  const end = h('input', { type: 'time', value: schedule?.end ?? '11:00', required: true });
  const date = h('input', { type: 'date', value: schedule?.type === 'once' ? schedule.date : schedule?.fromDate ?? todayIn(state.settings.timezone), required: true });
  const until = h('input', { type: 'date', value: schedule?.type === 'weekly' ? schedule.untilDate ?? '' : '' });
  const choices = weekdays.map(([day, label]) => ({ day, label, input: h('input', { type: 'checkbox', checked: schedule?.type === 'weekly' && schedule.weekdays.includes(day) }) }));
  const project = h('select', {}, h('option', { value: '' }, '不連結專案'), ...state.projects.filter(p => p.kind === 'project').map(p => h('option', { value: p.id }, p.name)));
  project.value = commitment?.projectId ?? '';
  const weeklyFields = h('div', {}, field('重複結束日（可留白）', until), h('div', { className: 'row' }, ...choices.map(c => h('label', { className: 'row' }, c.input, c.label))));
  const updateType = () => { weeklyFields.hidden = type.value !== 'weekly'; };
  type.addEventListener('change', updateType); updateType();
  return h('form', { className: 'stack', onsubmit: async (event: Event) => {
    event.preventDefault();
    const selectedWeekdays = choices.filter(c => c.input.checked).map(c => c.day);
    if (type.value === 'weekly' && selectedWeekdays.length === 0) {
      window.alert('每週重複至少要選一天');
      return;
    }
    if (type.value === 'weekly' && until.value && until.value < date.value) {
      window.alert('重複結束日不能早於開始日');
      return;
    }
    const schedule: CommitmentSchedule = type.value === 'once' ? { type: 'once', date: date.value, start: start.value, end: end.value } :
      { type: 'weekly', fromDate: date.value, untilDate: until.value || null, weekdays: selectedWeekdays, start: start.value, end: end.value };
    const fields = { title: title.value, projectId: project.value || null, schedule };
    if (await send(commitment ? { type: 'updateCommitment', commitmentId: commitment.id, ...fields } : { type: 'createCommitment', ...fields })) {
      afterSubmit?.();
      await refresh?.();
    }
  } }, field('行程名稱', title), h('div', { className: 'grid' }, field('重複方式', type), field('日期 / 重複開始日', date), field('開始時間', start), field('結束時間', end), field('連結專案', project)),
  weeklyFields, h('button', { type: 'submit' }, commitment ? '儲存行程' : '新增行程'));
}
function commitmentScheduleSummary(commitment: Commitment): string {
  const schedule = commitment.schedule;
  if (schedule.type === 'once') return `${schedule.date} · ${schedule.start}-${schedule.end}`;
  const labels = schedule.weekdays.map(day => weekdays.find(([value]) => value === day)?.[1] ?? day).join('、');
  return `每週 ${labels} · ${schedule.start}-${schedule.end} · 自 ${schedule.fromDate}${schedule.untilDate ? ` · 到 ${schedule.untilDate}` : ''}`;
}

export function commitmentsSection(state: AppState, send: Send, refresh?: Refresh): HTMLElement {
  const active = state.commitments.filter(c => c.status === 'active');
  return h('section', { className: 'card stack' }, h('h2', {}, '固定行程'),
    commitmentForm(state, send),
    h('h3', {}, `管理固定行程(${active.length})`),
    active.length ? h('ul', { className: 'list' }, ...active.map(commitment => {
      if (editingCommitments.has(commitment.id)) {
        return h('li', { className: 'stack' }, commitmentForm(state, send, commitment, () => editingCommitments.delete(commitment.id), refresh),
          h('button', { type: 'button', className: 'small ghost', onclick: (event: Event) => {
            editingCommitments.delete(commitment.id);
            (event.currentTarget as HTMLElement).closest('section')?.replaceWith(commitmentsSection(state, send));
          } }, '取消編輯'));
      }
      const skipDate = h('input', { type: 'date', value: todayIn(state.settings.timezone), required: true, hidden: true, 'aria-label': '取消其中一次的日期' });
      const action = h('select', { 'aria-label': '固定行程操作' },
        h('option', { value: '' }, '操作'),
        h('option', { value: 'skip' }, '取消一次'),
        h('option', { value: 'archive' }, '封存'),
        h('option', { value: 'delete' }, '刪除'));
      action.addEventListener('change', () => { skipDate.hidden = action.value !== 'skip'; });
      const projectName = commitment.projectId ? state.projects.find(project => project.id === commitment.projectId)?.name ?? commitment.projectId : '不連結專案';
      return h('li', { className: 'commitment-row' },
        h('div', { className: 'grow commitment-main' },
          h('strong', {}, commitment.title),
          h('span', { className: 'muted small' }, `${commitmentScheduleSummary(commitment)} · ${projectName}${commitment.skippedDates.length ? ` · 已取消 ${commitment.skippedDates.length} 次` : ''}`)),
        h('button', { type: 'button', className: 'small', onclick: (event: Event) => {
          editingCommitments.add(commitment.id);
          (event.currentTarget as HTMLElement).closest('section')?.replaceWith(commitmentsSection(state, send));
        } }, '編輯'),
        h('div', { className: 'task-actions' }, skipDate, action,
          h('button', { type: 'button', className: 'small', onclick: () => {
            if (action.value === 'skip') void send({ type: 'skipCommitment', commitmentId: commitment.id, date: skipDate.value });
            else if (action.value === 'archive') void send({ type: 'archiveCommitment', commitmentId: commitment.id });
            else if (action.value === 'delete' && window.confirm(`刪除固定行程「${commitment.title}」？`)) void send({ type: 'deleteCommitment', commitmentId: commitment.id });
          } }, '執行')));
    })) : h('p', { className: 'muted small' }, '尚未建立固定行程。'));
}
