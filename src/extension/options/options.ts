import { workHoursSection, commitmentsSection } from './day-settings';
import { getProjectRemainingMinutes, type AppState, type Command, type Project, type Requester, SELF_REQUESTER_ID, type Task } from '../../core';
import { loadState, onStateChanged, runCommand } from '../storage';
import { field, h, todayIn, weightSelect } from '../ui';

const app = document.querySelector<HTMLElement>('#app')!;
let errorMessage: string | null = null;
const editingProjects = new Set<string>();

async function send(command: Command): Promise<boolean> {
  const result = await runCommand(command);
  errorMessage = result.ok ? null : result.error.message;
  await render();
  return result.ok;
}

function requesterSelect(state: AppState, selected: string | null): HTMLSelectElement {
  const select = h('select');
  for (const r of state.requesters.filter((r) => r.status === 'active')) {
    select.append(h('option', { value: r.id }, `${r.name}(權重 ${r.defaultWeight})`));
  }
  select.value = selected ?? SELF_REQUESTER_ID;
  return select;
}

function requesterRow(requester: Requester): HTMLLIElement {
  const name = h('input', { type: 'text', value: requester.name, 'aria-label': 'Requester 名稱' });
  const weight = weightSelect(requester.defaultWeight);
  return h(
    'li',
    { className: 'row' },
    h('div', { className: 'grow' }, name),
    requester.id === SELF_REQUESTER_ID ? h('span', { className: 'chip' }, '內建') : null,
    h('label', { className: 'row' }, '預設權重', weight),
    h(
      'button',
      {
        type: 'button',
        onclick: () =>
          void send({ type: 'updateRequester', requesterId: requester.id, name: name.value, defaultWeight: Number(weight.value) }),
      },
      '儲存',
    ),
  );
}

function requesterSection(state: AppState): HTMLElement {
  const name = h('input', { type: 'text', placeholder: '例如:老闆、同事 A' });
  const weight = weightSelect(3);
  const form = h(
    'form',
    {
      className: 'row',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (await send({ type: 'createRequester', name: name.value, defaultWeight: Number(weight.value) })) name.value = '';
      },
    },
    h('div', { className: 'grow' }, name),
    h('label', { className: 'row' }, '預設權重', weight),
    h('button', { type: 'submit' }, '新增 Requester'),
  );
  return h(
    'section',
    { className: 'card stack' },
    h('h2', {}, 'Requester(交辦工作的人)'),
    h('p', { className: 'muted small' }, '權重 1–5,數字越大代表這個人交辦的工作越重要。沒有人交辦的工作選「自己」。'),
    h('ul', { className: 'list' }, ...state.requesters.filter((r) => r.status === 'active').map(requesterRow)),
    form,
  );
}

type ProjectInputs = ReturnType<typeof projectInputs>;

function projectInputs(state: AppState, project: Project | null) {
  return {
    name: h('input', { type: 'text', value: project?.name ?? '', placeholder: '例如:會員系統重構' }),
    requester: requesterSelect(state, project?.requesterId ?? null),
    start: h('input', { type: 'date', value: project?.startDate ?? todayIn(state.settings.timezone) }),
    end: h('input', { type: 'date', value: project?.endDate ?? '' }),
    manualPriority: weightSelect(project?.manualPriority ?? 3),
    requesterWeightOverride: weightSelect(project?.requesterWeightOverride ?? null, '沿用 Requester 的權重'),
  };
}

function inputGrid(inputs: ProjectInputs): HTMLElement {
  return h(
    'div',
    { className: 'grid' },
    field('專案名稱', inputs.name),
    field('Requester', inputs.requester),
    field('開始日', inputs.start),
    field('截止日(可不填)', inputs.end),
    field('手動優先級(1–5)', inputs.manualPriority),
    field('這個專案的 Requester 權重', inputs.requesterWeightOverride),
  );
}

function readProjectInputs(inputs: ProjectInputs) {
  return {
    name: inputs.name.value,
    requesterId: inputs.requester.value,
    startDate: inputs.start.value,
    endDate: inputs.end.value || null,
    manualPriority: Number(inputs.manualPriority.value),
    requesterWeightOverride: inputs.requesterWeightOverride.value ? Number(inputs.requesterWeightOverride.value) : null,
  };
}

function createProjectForm(state: AppState): HTMLElement {
  const inputs = projectInputs(state, null);
  return h(
    'form',
    {
      className: 'stack',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        await send({ type: 'createProject', ...readProjectInputs(inputs) });
      },
    },
    inputGrid(inputs),
    h('div', { className: 'row' }, h('button', { type: 'submit', className: 'primary' }, '新增專案')),
  );
}

function editProjectForm(state: AppState, project: Project): HTMLElement {
  const inputs = projectInputs(state, project);
  return h(
    'form',
    {
      className: 'stack',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        editingProjects.delete(project.id);
        if (!(await send({ type: 'updateProject', projectId: project.id, ...readProjectInputs(inputs) }))) {
          editingProjects.add(project.id);
          await render();
        }
      },
    },
    inputGrid(inputs),
    h(
      'div',
      { className: 'row' },
      h('button', { type: 'submit', className: 'primary' }, '儲存'),
      h(
        'button',
        {
          type: 'button',
          className: 'ghost',
          onclick: () => {
            editingProjects.delete(project.id);
            void render();
          },
        },
        '取消',
      ),
    ),
  );
}

function projectSummary(state: AppState, project: Project): string {
  const requester = state.requesters.find((r) => r.id === project.requesterId);
  const parts = [
    requester ? `Requester:${requester.name}` : null,
    `開始 ${project.startDate}`,
    project.endDate ? `截止 ${project.endDate}` : '沒有截止日',
    `手動優先級 ${project.manualPriority}`,
    project.requesterWeightOverride !== null ? `這個專案的 Requester 權重 ${project.requesterWeightOverride}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function openTaskRow(task: Task): HTMLLIElement {
  const title = h('input', { type: 'text', value: task.title, 'aria-label': 'Task 標題' });
  return h(
    'li',
    { className: 'row' },
    h('div', { className: 'grow' }, title),
    h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'updateTask', taskId: task.id, title: title.value }) }, '儲存'),
    h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'completeTask', taskId: task.id }) }, '完成'),
  );
}

function planningControls(state: AppState, project: Project): HTMLElement {
  const value = h('input', { type: 'number', min: 1, value: project.effortEstimateMinutes ?? '' });
  const unit = h('select', {}, h('option', { value: 'minutes' }, '分鐘'), h('option', { value: 'hours' }, '小時'), h('option', { value: 'days' }, '工作日'));
  const lateDays = h('input', { type: 'number', min: 0, value: project.deadlineRiskOverride?.lateDays ?? '' });
  const available = h('input', { type: 'number', min: 0, value: project.deadlineRiskOverride?.availablePercent ?? '' });
  return h('details', { className: 'planning-controls' }, h('summary', {}, '預估工作量與逾期預警'),
    h('form', { className: 'stack', onsubmit: (event: Event) => { event.preventDefault(); void send({ type: 'setEffortEstimate', projectId: project.id, value: Number(value.value), unit: unit.value as 'minutes' | 'hours' | 'days' }); } },
      h('div', { className: 'row' }, field('工作量', value), field('單位', unit), h('button', { type: 'submit' }, '儲存預估'))),
    h('form', { className: 'stack', onsubmit: (event: Event) => { event.preventDefault(); void send({ type: 'setDeadlineRiskThreshold', projectId: project.id, lateDays: lateDays.value ? Number(lateDays.value) : undefined, availablePercent: available.value ? Number(available.value) : undefined }); } },
      h('div', { className: 'row' }, field('延遲天數', lateDays), field('可用時間門檻 %', available), h('button', { type: 'submit' }, '儲存預警門檻'))),
    h('p', { className: 'small muted' }, `剩餘工作量：${getProjectRemainingMinutes(state, project.id, new Date()) ?? '尚未設定'} 分鐘`));
}

function doneTaskList(tasks: Task[]): HTMLElement | null {
  if (!tasks.length) return null;
  return h(
    'details',
    {},
    h('summary', { className: 'muted small' }, `已完成的 Task(${tasks.length})`),
    h(
      'ul',
      { className: 'list' },
      ...tasks.map((t) =>
        h('li', { className: 'row' }, h('span', { className: 'grow done-text' }, t.title), h('span', { className: 'muted small' }, `完成於 ${t.doneAt?.slice(0, 10) ?? ''}`)),
      ),
    ),
  );
}

function projectCard(state: AppState, project: Project): HTMLElement {
  const tasks = state.tasks.filter((t) => t.projectId === project.id);
  const openTasks = tasks.filter((t) => t.status === 'open');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const taskTitle = h('input', { type: 'text', placeholder: '新增 Task,例如:修 code review 抓到的權限 bug' });

  const header = editingProjects.has(project.id)
    ? editProjectForm(state, project)
    : h(
        'div',
        { className: 'row' },
        h('div', { className: 'grow' }, h('strong', {}, project.name), h('div', { className: 'muted small' }, projectSummary(state, project))),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              editingProjects.add(project.id);
              void render();
            },
          },
          '編輯',
        ),
        h('button', { type: 'button', onclick: () => void send({ type: 'completeProject', projectId: project.id }) }, '標記完成'),
      );

  return h(
    'article',
    { className: 'card stack' },
    header,
    h('span', { className: 'muted small' }, `進行中的 Task(${openTasks.length})`),
    planningControls(state, project),
    openTasks.length ? h('ul', { className: 'list' }, ...openTasks.map(openTaskRow)) : h('p', { className: 'muted small' }, '沒有進行中的 Task。'),
    h(
      'form',
      {
        className: 'row',
        onsubmit: async (event: Event) => {
          event.preventDefault();
          await send({ type: 'createTask', projectId: project.id, title: taskTitle.value });
        },
      },
      h('div', { className: 'grow' }, taskTitle),
      h('button', { type: 'submit' }, '新增 Task'),
    ),
    doneTaskList(doneTasks),
  );
}

function projectSection(state: AppState): HTMLElement {
  const active = state.projects.filter((p) => p.kind === 'project' && p.status === 'active');
  return h(
    'section',
    { className: 'stack' },
    h('div', { className: 'card stack' }, h('h2', {}, '新增專案'), createProjectForm(state)),
    h('h2', {}, `進行中的專案(${active.length})`),
    active.length ? null : h('p', { className: 'empty' }, '還沒有進行中的專案,從上面新增一個吧。'),
    ...active.map((p) => projectCard(state, p)),
  );
}

function doneProjectSection(state: AppState): HTMLElement | null {
  const done = state.projects.filter((p) => p.kind === 'project' && p.status === 'done');
  if (!done.length) return null;
  return h(
    'section',
    { className: 'card stack' },
    h('h2', {}, `已完成的專案(${done.length})`),
    ...done.map((p) => {
      const tasks = state.tasks.filter((t) => t.projectId === p.id);
      return h(
        'details',
        {},
        h('summary', {}, h('span', { className: 'done-text' }, p.name), h('span', { className: 'muted small' }, ` 完成於 ${p.doneAt?.slice(0, 10) ?? ''} · ${tasks.length} 個 Task`)),
        tasks.length
          ? h(
              'ul',
              { className: 'list' },
              ...tasks.map((t) =>
                h('li', { className: 'row' }, h('span', { className: t.status === 'done' ? 'grow done-text' : 'grow' }, t.title), h('span', { className: 'muted small' }, t.status === 'done' ? '已完成' : '未完成')),
              ),
            )
          : h('p', { className: 'muted small' }, '沒有 Task。'),
      );
    }),
  );
}

async function render(): Promise<void> {
  const state = await loadState();
  app.replaceChildren(
    h(
      'div',
      { className: 'stack' },
      h('h1', {}, '設定'),
      errorMessage ? h('div', { className: 'error', role: 'alert' }, errorMessage) : null,
      workHoursSection(state, send),
      commitmentsSection(state, send),
      requesterSection(state),
      projectSection(state),
      doneProjectSection(state),
    ),
  );
}

void render();
onStateChanged(() => {
  if (!app.contains(document.activeElement) || !document.activeElement?.matches('input, textarea, select')) void render();
});
