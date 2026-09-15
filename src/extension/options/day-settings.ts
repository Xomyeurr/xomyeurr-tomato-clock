import { type AppState, type Command, type Commitment, type CommitmentSchedule, type TimeRange, type Weekday } from '../../core';
import { field, h, todayIn } from '../ui';

type Send = (command: Command) => Promise<unknown>;
const weekdays: [Weekday, string][] = [['mon', '週一'], ['tue', '週二'], ['wed', '週三'], ['thu', '週四'], ['fri', '週五'], ['sat', '週六'], ['sun', '週日']];
function rangesEditor(ranges: TimeRange[]) {
  const rows = h('div', { className: 'stack' });
  const controls: { start: HTMLInputElement; end: HTMLInputElement; row: HTMLElement }[] = [];
  function add(range: TimeRange = { start: '09:00', end: '18:00' }): void {
    const start = h('input', { type: 'time', value: range.start, required: true, 'aria-label': '上班時間' });
    const end = h('input', { type: 'time', value: range.end, required: true, 'aria-label': '下班時間' });
    const row = h('div', { className: 'row' }, start, end, h('button', { type: 'button', onclick: () => row.remove() }, '移除時段'));
    controls.push({ start, end, row }); rows.append(row);
  }
  ranges.forEach(add);
  return { element: h('div', { className: 'stack' }, rows, h('button', { type: 'button', onclick: () => add() }, '新增時段')),
    read: () => controls.filter(c => c.row.parentElement === rows).map(c => ({ start: c.start.value, end: c.end.value })) };
}
export function workHoursSection(state: AppState, send: Send): HTMLElement {
  const weekly = weekdays.map(([weekday, label]) => {
    const editor = rangesEditor(state.workHours.weekly[weekday]);
    return h('details', {}, h('summary', {}, label), h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault(); void send({ type: 'setWeeklyWorkHours', weekday, ranges: editor.read() });
    } }, editor.element, h('button', { type: 'submit' }, `儲存${label}`)));
  });
  const date = h('input', { type: 'date', value: todayIn(state.settings.timezone), required: true });
  let editor = rangesEditor(state.workHours.dayOverrides[date.value] ?? []);
  const holder = h('div', {}, editor.element);
  date.addEventListener('change', () => { editor = rangesEditor(state.workHours.dayOverrides[date.value] ?? []); holder.replaceChildren(editor.element); });
  return h('section', { className: 'card stack' }, h('h2', {}, '每週工時範本與單日調整'),
    h('p', { className: 'small muted' }, `時間依 ${state.settings.timezone}。可新增多段時段；移除全部時段並儲存代表不上班。`), ...weekly,
    h('h3', {}, '單日調整'), h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault(); void send({ type: 'setDayWorkHours', date: date.value, ranges: editor.read() });
    } }, field('日期', date), holder, h('div', { className: 'row' }, h('button', { type: 'submit' }, '儲存單日調整'),
      h('button', { type: 'button', onclick: () => void send({ type: 'resetDayWorkHours', date: date.value }) }, '恢復週範本'))),
    h('p', { className: 'small muted' }, `已調整：${Object.keys(state.workHours.dayOverrides).sort().join('、') || '無'}`));
}
function commitmentForm(state: AppState, send: Send, commitment?: Commitment): HTMLElement {
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
  return h('form', { className: 'stack', onsubmit: (event: Event) => {
    event.preventDefault();
    const schedule: CommitmentSchedule = type.value === 'once' ? { type: 'once', date: date.value, start: start.value, end: end.value } :
      { type: 'weekly', fromDate: date.value, untilDate: until.value || null, weekdays: choices.filter(c => c.input.checked).map(c => c.day), start: start.value, end: end.value };
    const fields = { title: title.value, projectId: project.value || null, schedule };
    void send(commitment ? { type: 'updateCommitment', commitmentId: commitment.id, ...fields } : { type: 'createCommitment', ...fields });
  } }, field('行程名稱', title), h('div', { className: 'grid' }, field('重複方式', type), field('日期 / 重複開始日', date), field('開始時間', start), field('結束時間', end), field('連結專案', project)),
  weeklyFields, h('button', { type: 'submit' }, commitment ? '儲存行程' : '新增行程'));
}
export function commitmentsSection(state: AppState, send: Send): HTMLElement {
  return h('section', { className: 'card stack' }, h('h2', {}, '固定行程'), commitmentForm(state, send),
    ...state.commitments.filter(c => c.status === 'active').map(c => {
      const date = h('input', { type: 'date', value: todayIn(state.settings.timezone), required: true });
      return h('details', {}, h('summary', {}, `${c.title} · ${c.schedule.start}–${c.schedule.end}`), commitmentForm(state, send, c),
        h('form', { className: 'row', onsubmit: (event: Event) => { event.preventDefault(); void send({ type: 'skipCommitment', commitmentId: c.id, date: date.value }); } }, field('取消其中一次的日期', date), h('button', { type: 'submit' }, '取消這一次')),
        h('p', { className: 'small muted' }, `已取消日期：${c.skippedDates.join('、') || '無'}`),
        h('button', { type: 'button', onclick: () => void send({ type: 'archiveCommitment', commitmentId: c.id }) }, '封存行程'));
    }));
}
