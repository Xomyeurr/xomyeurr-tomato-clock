import { type AppState, type Command, getNextTask, getStartableTasks, getTimerStatus } from '../../core';
import { loadState, onStateChanged, runCommand } from '../storage';
import { field, h, preserveDrafts } from '../ui';
import { summaryView, retroactiveForm, confirmationViews, planningView, adHocPromotionForm } from '../daily-ui';

const app = document.querySelector<HTMLElement>('#app')!;
let errorMessage: string | null = null;
let showOtherTasks = false;
let windowId: number | undefined;

const REASON_LABELS: Record<string, string> = { highestWeight: '排程權重最高', mustStartBy: '每日保底', lockedTimeBlock: '鎖定時段', lockedTimeBlockNoTask: '鎖定專案沒有未完成 Task，已依一般規則推薦', noAvailableTime: '今天沒有剩餘可用時段' };

const pad = (n: number) => String(n).padStart(2, '0');
const mmss = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const clock = (timestamp: string) => timestamp.slice(11, 16);

async function send(command: Command): Promise<void> {
  const result = await runCommand(command);
  errorMessage = result.ok ? null : result.error.message;
  if (result.ok) showOtherTasks = false;
  await render(!result.ok);
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

  const note = h('textarea', { id: `running-note-${running.sessionId}`, rows: 2, placeholder: '這一段做了什麼？（可以空白）' });
  const complete = h('input', { id: `running-complete-${running.sessionId}`, type: 'checkbox' });
  const canFinish = running.isDue || running.mode === 'freeTimer';
  return h('section', { className: 'card stack' },
    h('span', { className: 'chip' }, running.isDue ? '時間到了！' : running.mode === 'freeTimer' ? '碼錶計時中' : '專注中'), title,
    h('div', { className: 'countdown', 'data-due': running.dueAt ?? undefined, 'data-start': running.dueAt ? undefined : running.startedAt }, mmss(running.dueAt ? running.remainingSeconds : (running.elapsedSeconds ?? 0))),
    h('div', { className: 'muted small center' }, running.dueAt ? `預計 ${clock(running.dueAt)} 到期` : '未設定長度'),
    running.autoStopAt ? h('div', { className: 'muted small', 'data-auto-stop': running.autoStopAt }, `最晚 ${clock(running.autoStopAt)} 自動停止並請你確認`) : null,
    note,
    canFinish ? h('label', { className: 'row check' }, complete, '這個 Task 做完了') : null,
    canFinish ? h('button', { type: 'button', className: 'primary', onclick: () => void send({ type: 'finishSession', note: note.value, completeTask: complete.checked }) }, '完成這段工作') : null,
    h('button', { type: 'button', onclick: () => void send({ type: 'abandonSession', note: note.value }) }, '放棄'));
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

function freeTimerForm(state: AppState): HTMLElement | null {
  const tasks = getStartableTasks(state);
  if (!tasks.length) return null;
  const task = h('select', { id: 'free-task' }, ...tasks.map(t => h('option', { value: t.id }, `${projectName(state, t.projectId)} / ${t.title}`)));
  task.value = getNextTask(state, new Date())?.taskId ?? tasks[0]!.id;
  const duration = h('input', { id: 'free-duration', type: 'number', min: 1, max: state.settings.freeTimer.maxMinutes, placeholder: '留白當碼錶' });
  return h('details', { className: 'card', id: 'free-details' }, h('summary', {}, '使用碼錶 / 自訂長度'),
    h('form', { className: 'stack', onsubmit: (event: Event) => {
      event.preventDefault(); void send({ type: 'startFreeTimer', taskId: task.value, durationMinutes: duration.value ? Number(duration.value) : null });
    } }, field('Task', task), field('長度（分鐘）', duration), h('button', { type: 'submit' }, '開始碼錶')));
}
function adHocForm(): HTMLElement {
  const title = h('input', { id: 'adhoc-title', type: 'text', required: true, placeholder: '臨時工作名稱' });
  return h('form', { className: 'card stack', onsubmit: (event: Event) => {
    event.preventDefault(); void send({ type: 'insertAdHocTask', title: title.value });
  } }, field('插入臨時工作', title), h('button', { type: 'submit' }, '立即插入並計時'));
}
let currentState: AppState | null = null;
async function render(preserve = true): Promise<void> {
  const state = await loadState();
  const restore = preserve ? preserveDrafts(app) : () => {};
  currentState = state;
  const { running } = getTimerStatus(state, new Date());
  app.replaceChildren(h('div', { className: 'stack' },
    h('header', {}, h('strong', {}, '番茄鐘小助理')),
    errorMessage ? h('div', { className: 'error', role: 'alert' }, errorMessage) : null,
    summaryView(state, send), ...confirmationViews(state, send), running ? runningView(state) : idleView(state),
    planningView(state, send),
    running ? null : freeTimerForm(state), adHocForm(), adHocPromotionForm(state, send), retroactiveForm(state, send), footer()));
  restore();
}
setInterval(() => {
  const countdown = app.querySelector<HTMLElement>('[data-due], [data-start]');
  if (countdown?.dataset.due) {
    const remaining = Math.ceil((Date.parse(countdown.dataset.due) - Date.now()) / 1000);
    if (remaining <= 0 && countdown.textContent !== '00:00') void render();
    else countdown.textContent = mmss(Math.max(0, remaining));
  } else if (countdown?.dataset.start) countdown.textContent = mmss(Math.max(0, Math.floor((Date.now() - Date.parse(countdown.dataset.start)) / 1000)));
  const stop = app.querySelector<HTMLElement>('[data-auto-stop]')?.dataset.autoStop;
  if (stop && Date.parse(stop) <= Date.now()) void render();
  const breakEnd = app.querySelector<HTMLElement>('[data-break-ends]')?.dataset.breakEnds;
  if (breakEnd && Date.parse(breakEnd) <= Date.now()) void render();
  if (currentState) app.querySelector('[data-summary]')?.replaceWith(summaryView(currentState, send));
}, 1000);
void chrome.windows.getCurrent().then(w => { windowId = w.id; });
void render();
onStateChanged(() => void render());
