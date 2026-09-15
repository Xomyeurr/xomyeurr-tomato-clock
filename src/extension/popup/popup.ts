import { type AppState, type Command, getNextTask, getStartableTasks, getTimerStatus } from '../../core';
import { loadState, onStateChanged, runCommand } from '../storage';
import { h } from '../ui';

const app = document.querySelector<HTMLElement>('#app')!;
let errorMessage: string | null = null;
let showOtherTasks = false;
let windowId: number | undefined;

const REASON_LABELS: Record<string, string> = { highestWeight: '排程權重最高' };

const pad = (n: number) => String(n).padStart(2, '0');
const mmss = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const clock = (timestamp: string) => timestamp.slice(11, 16);

async function send(command: Command): Promise<void> {
  const result = await runCommand(command);
  errorMessage = result.ok ? null : result.error.message;
  if (result.ok) showOtherTasks = false;
  await render();
}

function projectName(state: AppState, projectId: string): string {
  return state.projects.find((p) => p.id === projectId)?.name ?? '';
}

function runningView(state: AppState): HTMLElement {
  const { running } = getTimerStatus(state, new Date());
  if (!running) return h('div');
  const title = h(
    'div',
    { className: 'stack tight' },
    h('span', { className: 'muted small' }, running.projectName),
    h('strong', { className: 'task-title' }, running.taskTitle),
  );

  if (running.isDue) {
    const note = h('textarea', { rows: 3, placeholder: '這一段做了什麼?結果如何?(可以空白)' });
    const complete = h('input', { type: 'checkbox' });
    return h(
      'section',
      { className: 'card stack' },
      h('span', { className: 'chip' }, '時間到了!'),
      title,
      note,
      h('label', { className: 'row check' }, complete, '這個 Task 做完了'),
      h(
        'button',
        {
          type: 'button',
          className: 'primary big',
          onclick: () => void send({ type: 'finishSession', note: note.value, completeTask: complete.checked }),
        },
        '完成這個番茄鐘',
      ),
    );
  }

  const reason = h('input', { type: 'text', placeholder: '放棄的原因(可以空白)' });
  return h(
    'section',
    { className: 'card stack' },
    h('span', { className: 'muted small' }, '專注中'),
    title,
    h('div', { className: 'countdown', 'data-due': running.dueAt }, mmss(running.remainingSeconds)),
    h('div', { className: 'muted small center' }, `預計 ${clock(running.dueAt)} 結束`),
    h(
      'div',
      { className: 'row' },
      h('div', { className: 'grow' }, reason),
      h('button', { type: 'button', onclick: () => void send({ type: 'abandonSession', note: reason.value }) }, '放棄'),
    ),
  );
}

function otherTaskList(state: AppState, excludeTaskId: string | null): HTMLElement {
  const tasks = getStartableTasks(state).filter((t) => t.id !== excludeTaskId);
  if (!tasks.length) return h('p', { className: 'muted small' }, '沒有其他可以做的 Task。');
  return h(
    'div',
    { className: 'stack tight' },
    h('p', { className: 'muted small' }, '改做別的 Task 會記一筆調整紀錄。'),
    h(
      'ul',
      { className: 'list' },
      ...tasks.map((t) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', className: 'task-choice', onclick: () => void send({ type: 'startPomodoro', taskId: t.id }) },
            h('span', {}, t.title),
            h('span', { className: 'muted small' }, projectName(state, t.projectId)),
          ),
        ),
      ),
    ),
  );
}

function idleView(state: AppState): HTMLElement {
  const now = new Date();
  const { breakEndsAt } = getTimerStatus(state, now);
  const next = getNextTask(state, now);
  const breakBanner = breakEndsAt
    ? h('div', { className: 'chip ok break', 'data-break-ends': breakEndsAt }, `休息一下,休息到 ${clock(breakEndsAt)}`)
    : null;

  if (!next) {
    return h(
      'section',
      { className: 'card stack' },
      breakBanner,
      h('p', { className: 'empty' }, '目前沒有可以做的 Task。'),
      h('button', { type: 'button', className: 'primary', onclick: () => void chrome.runtime.openOptionsPage() }, '到設定頁新增專案和 Task'),
    );
  }

  return h(
    'section',
    { className: 'card stack' },
    breakBanner,
    h('span', { className: 'muted small' }, '現在該做'),
    h('div', { className: 'stack tight' }, h('span', { className: 'muted small' }, next.projectName), h('strong', { className: 'task-title' }, next.taskTitle)),
    h('div', {}, h('span', { className: 'chip' }, REASON_LABELS[next.reason] ?? next.reason)),
    h(
      'button',
      { type: 'button', className: 'primary big', onclick: () => void send({ type: 'startPomodoro', taskId: next.taskId }) },
      `開始 ${state.settings.pomodoro.focusMinutes} 分鐘`,
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'ghost',
        onclick: () => {
          showOtherTasks = !showOtherTasks;
          void render();
        },
      },
      showOtherTasks ? '收起' : '換一個',
    ),
    showOtherTasks ? otherTaskList(state, next.taskId) : null,
  );
}

function footer(): HTMLElement {
  return h(
    'footer',
    { className: 'row footer' },
    h('button', { type: 'button', className: 'ghost', onclick: () => void chrome.runtime.openOptionsPage() }, '設定'),
    h(
      'button',
      {
        type: 'button',
        className: 'ghost',
        onclick: () => {
          if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).then(() => window.close());
        },
      },
      '今日時間軸',
    ),
  );
}

async function render(): Promise<void> {
  const state = await loadState();
  const { running } = getTimerStatus(state, new Date());
  app.replaceChildren(
    h(
      'div',
      { className: 'stack' },
      h('header', {}, h('strong', {}, '番茄鐘小助理')),
      errorMessage ? h('div', { className: 'error', role: 'alert' }, errorMessage) : null,
      running ? runningView(state) : idleView(state),
      footer(),
    ),
  );
}

setInterval(() => {
  const countdown = app.querySelector<HTMLElement>('[data-due]');
  if (countdown?.dataset.due) {
    const remaining = Math.ceil((Date.parse(countdown.dataset.due) - Date.now()) / 1000);
    if (remaining <= 0) void render();
    else countdown.textContent = mmss(remaining);
  }
  const breakBanner = app.querySelector<HTMLElement>('[data-break-ends]');
  if (breakBanner?.dataset.breakEnds && Date.parse(breakBanner.dataset.breakEnds) <= Date.now()) void render();
}, 1000);

void chrome.windows.getCurrent().then((w) => {
  windowId = w.id;
});
void render();
onStateChanged(() => void render());
