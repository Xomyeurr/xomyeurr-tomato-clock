import { workHoursSection, dayOverrideSection, commitmentsSection } from './day-settings';
import { exportDataFiles, getProjectRemainingMinutes, INTERRUPT_BUCKET_ID, type AppState, type Command, type Commitment, type Project, type Requester, SELF_REQUESTER_ID, type Task } from '../../core';
import { loadState, onStateChanged, runCommand } from '../storage';
import { field, h, todayIn, weightSelect } from '../ui';

const app = document.querySelector<HTMLElement>('#app')!;
let errorMessage: string | null = null;
const editingProjects = new Set<string>();
const editingTasks = new Set<string>();
let exportDirectory: FileSystemDirectoryHandle | null = null;
let exportMessage = '尚未連接資料夾；重開瀏覽器後需要重新授權。';
let exportTimer: number | undefined;

async function send(command: Command): Promise<boolean> {
  const result = await runCommand(command);
  errorMessage = result.ok ? null : result.error.message;
  if (result.ok) scheduleExport();
  await render();
  return result.ok;
}

async function writeExportFile(directory: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const parts = path.split('/');
  let current = directory;
  for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part, { create: true });
  const file = await current.getFileHandle(parts.at(-1)!, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function exportNow(): Promise<void> {
  if (!exportDirectory) {
    exportMessage = '尚未連接資料夾；請按「連接資料夾」授權後再匯出。';
    return;
  }
  const state = await loadState();
  const files = exportDataFiles(state, new Date());
  for (const [path, content] of Object.entries(files)) await writeExportFile(exportDirectory, `data/${path}`, content);
  exportMessage = `已匯出 ${Object.keys(files).length} 個檔案到 ./data。`;
}

function scheduleExport(): void {
  if (!exportDirectory) return;
  if (exportTimer !== undefined) window.clearTimeout(exportTimer);
  exportTimer = window.setTimeout(() => {
    void exportNow().then(render).catch(error => {
      exportMessage = `匯出失敗：${error instanceof Error ? error.message : String(error)}`;
      void render();
    });
  }, 30_000);
}

async function connectExportFolder(): Promise<void> {
  const picker = (window as typeof window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) {
    exportMessage = '這個瀏覽器不支援 File System Access API。';
    await render();
    return;
  }
  exportDirectory = await picker();
  await exportNow();
  await render();
}

function exportSection(): HTMLElement {
  return h('section', { className: 'card stack' }, h('h2', {}, '資料匯出'),
    h('p', { className: 'small muted' }, exportMessage),
    h('div', { className: 'row' },
      h('button', { type: 'button', onclick: () => void connectExportFolder().catch(error => { exportMessage = `連接失敗：${error instanceof Error ? error.message : String(error)}`; void render(); }) }, '連接資料夾'),
      h('button', { type: 'button', onclick: () => void exportNow().then(render).catch(error => { exportMessage = `匯出失敗：${error instanceof Error ? error.message : String(error)}`; void render(); }) }, '立即匯出')));
}

function settingsSection(state: AppState): HTMLElement {
  const focus = h('input', { type: 'number', min: 1, value: state.settings.pomodoro.focusMinutes });
  const rest = h('input', { type: 'number', min: 1, value: state.settings.pomodoro.breakMinutes });
  const max = h('input', { type: 'number', min: 1, value: state.settings.freeTimer.maxMinutes });
  const deadline = h('input', { type: 'number', min: 0, step: 0.01, value: state.settings.scheduleWeightFactors.deadlineUrgency });
  const requester = h('input', { type: 'number', min: 0, step: 0.01, value: state.settings.scheduleWeightFactors.requester });
  const manual = h('input', { type: 'number', min: 0, step: 0.01, value: state.settings.scheduleWeightFactors.manualPriority });
  const buffer = h('input', { type: 'number', min: 0, value: state.settings.mustStartBy.safetyBufferWorkdays });
  const guarantee = h('input', { type: 'number', min: 1, value: state.settings.mustStartBy.guaranteedMinutesPerDay });
  const late = h('input', { type: 'number', min: 0, value: state.settings.deadlineRisk.lateDays });
  const available = h('input', { type: 'number', min: 0, value: state.settings.deadlineRisk.availablePercent });
  return h('section', { className: 'card stack' }, h('h2', {}, '全域設定'),
    h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault();
      void send({
        type: 'updateSettings',
        patch: {
          pomodoro: { focusMinutes: Number(focus.value), breakMinutes: Number(rest.value) },
          freeTimer: { maxMinutes: Number(max.value) },
          scheduleWeightFactors: { deadlineUrgency: Number(deadline.value), requester: Number(requester.value), manualPriority: Number(manual.value) },
          mustStartBy: { safetyBufferWorkdays: Number(buffer.value), guaranteedMinutesPerDay: Number(guarantee.value) },
          deadlineRisk: { lateDays: Number(late.value), availablePercent: Number(available.value) },
        },
      });
    } }, h('div', { className: 'grid' },
      field('Pomodoro 專注分鐘', focus), field('休息分鐘', rest), field('碼錶上限分鐘', max),
      field('截止日權重', deadline), field('Requester 權重', requester), field('手動優先級權重', manual),
      field('安全緩衝工作日', buffer), field('每日保底分鐘', guarantee), field('延遲天數門檻', late), field('可用時間門檻 %', available)),
      h('button', { type: 'submit' }, '儲存全域設定')));
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
    requester.id === SELF_REQUESTER_ID ? null : h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'archiveRequester', requesterId: requester.id }) }, '封存'),
    requester.id === SELF_REQUESTER_ID ? null : h('button', { type: 'button', className: 'small ghost', onclick: () => void send({ type: 'deleteRequester', requesterId: requester.id }) }, '刪除'),
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
  if (editingTasks.has(task.id)) {
    return h(
      'li',
      { className: 'task-row' },
      h('div', { className: 'grow' }, title),
      h('button', { type: 'button', className: 'small', onclick: async () => {
        editingTasks.delete(task.id);
        if (!(await send({ type: 'updateTask', taskId: task.id, title: title.value }))) {
          editingTasks.add(task.id);
          await render();
        }
      } }, '儲存名稱'),
      h('button', { type: 'button', className: 'small ghost', onclick: () => {
        editingTasks.delete(task.id);
        void render();
      } }, '取消'),
    );
  }
  const action = h('select', { 'aria-label': 'Task 操作' },
    h('option', { value: '' }, '操作'),
    h('option', { value: 'rename' }, '重新命名'),
    h('option', { value: 'archive' }, '封存'),
    h('option', { value: 'delete' }, '刪除'));
  const runAction = () => {
    if (action.value === 'rename') {
      editingTasks.add(task.id);
      void render();
    } else if (action.value === 'archive') {
      void send({ type: 'archiveTask', taskId: task.id });
    } else if (action.value === 'delete') {
      void send({ type: 'deleteTask', taskId: task.id });
    }
  };
  return h(
    'li',
    { className: 'task-row' },
    h('span', { className: 'grow task-title' }, task.title),
    h('button', { type: 'button', className: 'small', onclick: () => void send({ type: 'completeTask', taskId: task.id }) }, '完成'),
    h('div', { className: 'task-actions' }, action, h('button', { type: 'button', className: 'small', onclick: runAction }, '執行')),
  );
}

function planningControls(state: AppState, project: Project): HTMLElement {
  const value = h('input', { type: 'number', min: 1, value: project.effortEstimateMinutes ?? '' });
  const unit = h('select', {}, h('option', { value: 'minutes' }, '分鐘'), h('option', { value: 'hours' }, '小時'), h('option', { value: 'days' }, '工作日'));
  const lateDays = h('input', { type: 'number', min: 0, value: project.deadlineRiskOverride?.lateDays ?? '' });
  const available = h('input', { type: 'number', min: 0, value: project.deadlineRiskOverride?.availablePercent ?? '' });
  return h('details', { className: 'planning-controls' }, h('summary', {}, '規劃設定'),
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
  const projectAction = h('select', { 'aria-label': 'Project 操作' },
    h('option', { value: '' }, '操作'),
    h('option', { value: 'edit' }, '編輯'),
    h('option', { value: 'complete' }, '標記完成'),
    h('option', { value: 'archive' }, '封存'),
    h('option', { value: 'delete' }, '刪除'));
  const runProjectAction = () => {
    if (projectAction.value === 'edit') {
      editingProjects.add(project.id);
      void render();
    } else if (projectAction.value === 'complete') {
      void send({ type: 'completeProject', projectId: project.id });
    } else if (projectAction.value === 'archive') {
      void send({ type: 'archiveProject', projectId: project.id });
    } else if (projectAction.value === 'delete') {
      void send({ type: 'deleteProject', projectId: project.id });
    }
  };

  const header = editingProjects.has(project.id)
    ? editProjectForm(state, project)
    : h(
        'div',
        { className: 'row' },
        h('div', { className: 'grow' }, h('strong', {}, project.name), h('div', { className: 'muted small' }, projectSummary(state, project))),
        h('div', { className: 'task-actions' }, projectAction, h('button', { type: 'button', className: 'small', onclick: runProjectAction }, '執行')),
      );

  return h(
    'article',
    { className: 'card stack' },
    header,
    h('span', { className: 'muted small' }, `進行中的 Task(${openTasks.length})`),
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
    planningControls(state, project),
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

function archivedSection(state: AppState): HTMLElement | null {
  const requesters = state.requesters.filter(item => item.status === 'archived');
  const projects = state.projects.filter(item => item.kind === 'project' && item.status === 'archived');
  const tasks = state.tasks.filter(item => item.status === 'archived');
  const commitments = state.commitments.filter(item => item.status === 'archived');
  if (!requesters.length && !projects.length && !tasks.length && !commitments.length) return null;
  const item = (title: string, description: string) => h('li', {}, h('span', {}, title), h('span', { className: 'muted small' }, ` · ${description}`));
  return h('section', { className: 'card stack' }, h('h2', {}, '已封存'),
    requesters.length ? h('details', {}, h('summary', {}, `Requester(${requesters.length})`), h('ul', { className: 'list' }, ...requesters.map(row => item(row.name, `權重 ${row.defaultWeight}`)))) : null,
    projects.length ? h('details', {}, h('summary', {}, `Project(${projects.length})`), h('ul', { className: 'list' }, ...projects.map(row => item(row.name, row.endDate ? `截止 ${row.endDate}` : '沒有截止日')))) : null,
    tasks.length ? h('details', {}, h('summary', {}, `Task(${tasks.length})`), h('ul', { className: 'list' }, ...tasks.map(row => item(row.title, state.projects.find(project => project.id === row.projectId)?.name ?? (row.projectId === INTERRUPT_BUCKET_ID ? '臨時工作區' : row.projectId))))) : null,
    commitments.length ? h('details', {}, h('summary', {}, `Commitment(${commitments.length})`), h('ul', { className: 'list' }, ...commitments.map((row: Commitment) => item(row.title, `${row.schedule.start}–${row.schedule.end}`)))) : null);
}

async function render(): Promise<void> {
  const state = await loadState();
  app.replaceChildren(
    h(
      'div',
      { className: 'stack' },
      h('h1', {}, '設定'),
      errorMessage ? h('div', { className: 'error', role: 'alert' }, errorMessage) : null,
      settingsSection(state),
      exportSection(),
      workHoursSection(state, send),
      dayOverrideSection(state, send),
      commitmentsSection(state, send),
      requesterSection(state),
      projectSection(state),
      doneProjectSection(state),
      archivedSection(state),
    ),
  );
}

void render();
onStateChanged(() => {
  scheduleExport();
  if (!app.contains(document.activeElement) || !document.activeElement?.matches('input, textarea, select')) void render();
});
