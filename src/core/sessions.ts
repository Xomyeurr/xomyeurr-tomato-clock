import { INTERRUPT_BUCKET_ID } from './state';
import { getNextTask, getStartableTasks } from './recommend';
import { type CommandResult, fail, succeed } from './result';
import { getWorkRanges } from './day';
import { formatTimestamp, localDateTime } from './time';
import type { AppState, Context, Timestamp, WorkSession } from './types';

export type SessionCommand =
  | { type: 'addRetroactiveEntry'; taskId?: string; adHocTitle?: string; startedAt: string; endedAt: string; note: string }
  | { type: 'reconcileTimers' }
  | { type: 'confirmSessionEnd'; sessionId: string; endedAt: string; note: string }
  | { type: 'insertAdHocTask'; title: string }
  | { type: 'startFreeTimer'; taskId: string; durationMinutes?: number | null }
  | { type: 'startPomodoro'; taskId: string }
  | { type: 'finishSession'; note: string; completeTask?: boolean }
  | { type: 'abandonSession'; note?: string };

export interface RunningTimer {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectName: string;
  mode: WorkSession['mode'];
  startedAt: Timestamp;
  dueAt: Timestamp | null;
  elapsedSeconds?: number;
  autoStopAt?: Timestamp | null;
  remainingSeconds: number;
  isDue: boolean;
}

export interface TimerStatus {
  running: RunningTimer | null;
  breakEndsAt: Timestamp | null;
}

function findRunningSession(state: AppState): WorkSession | undefined {
  return state.sessions.find((s) => s.endedAt === null);
}

function sessionDue(state: AppState, session: WorkSession): Date {
  return new Date(new Date(session.startedAt).getTime() + state.settings.pomodoro.focusMinutes * 60_000);
}

export function sessionAutoStop(state: AppState, session: WorkSession): Date {
  const start = Date.parse(session.startedAt);
  const date = formatTimestamp(new Date(start), state.settings.timezone).slice(0, 10);
  const last = getWorkRanges(state, date).at(-1);
  const workEnd = last ? localDateTime(date, last.end, state.settings.timezone).getTime() : Infinity;
  return new Date(Math.max(start, Math.min(start + state.settings.freeTimer.maxMinutes * 60_000, workEnd)));
}

export function reconcileTimers(state: AppState, now: Date): AppState {
  const session = findRunningSession(state);
  if (!session || session.mode !== 'freeTimer') return state;
  const stop = sessionAutoStop(state, session);
  if (now.getTime() < stop.getTime()) return state;
  return { ...state, sessions: state.sessions.map(s => s.id === session.id ? { ...s,
    endedAt: formatTimestamp(stop, state.settings.timezone), outcome: 'completed', endTimeUnconfirmed: true,
    updatedAt: formatTimestamp(now, state.settings.timezone) } : s) };
}

function currentBreakEnd(state: AppState, now: Date): Timestamp | null {
  const last = state.sessions
    .filter((s) => s.endedAt !== null)
    .reduce<WorkSession | undefined>(
      (latest, s) => (!latest || new Date(s.endedAt!).getTime() > new Date(latest.endedAt!).getTime() ? s : latest),
      undefined,
    );
  if (!last || last.mode !== 'pomodoro' || last.outcome !== 'completed') return null;
  const breakEnd = new Date(new Date(last.endedAt!).getTime() + state.settings.pomodoro.breakMinutes * 60_000);
  return now.getTime() < breakEnd.getTime() ? formatTimestamp(breakEnd, state.settings.timezone) : null;
}

export function getTimerStatus(state: AppState, now: Date): TimerStatus {
  state = reconcileTimers(state, now);
  const session = findRunningSession(state);
  if (!session) return { running: null, breakEndsAt: currentBreakEnd(state, now) };
  const task = state.tasks.find((t) => t.id === session.taskId);
  const project = state.projects.find((p) => p.id === task?.projectId);
  const due = session.mode === 'pomodoro' ? sessionDue(state, session) : session.durationMinutes ? new Date(Date.parse(session.startedAt) + session.durationMinutes * 60_000) : null;
  return {
    running: {
      sessionId: session.id,
      taskId: session.taskId,
      taskTitle: task?.title ?? '',
      projectName: project?.name ?? '',
      mode: session.mode,
      startedAt: session.startedAt,
      dueAt: due ? formatTimestamp(due, state.settings.timezone) : null,
      ...(session.mode === 'freeTimer' ? {
        autoStopAt: formatTimestamp(sessionAutoStop(state, session), state.settings.timezone),
        elapsedSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(session.startedAt)) / 1000)),
      } : {}),
      remainingSeconds: due ? Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 1000)) : 0,
      isDue: due !== null && now.getTime() >= due.getTime(),
    },
    breakEndsAt: null,
  };
}

function explainNotStartable(state: AppState, taskId: string): CommandResult {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return fail('task_not_found', '找不到這個 Task');
  if (task.status === 'done') return fail('task_done', '這個 Task 已經完成了');
  const project = state.projects.find((p) => p.id === task.projectId);
  if (project?.status === 'done') return fail('project_done', '這個 Task 所屬的專案已經完成了');
  return fail('task_not_startable', '這個 Task 目前不能開始計時');
}

export function applySessionCommand(
  state: AppState,
  command: SessionCommand,
  ctx: Context,
  ts: Timestamp,
): CommandResult {
  switch (command.type) {
    case 'addRetroactiveEntry': {
      const start = Date.parse(command.startedAt);
      const end = Date.parse(command.endedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > ctx.now.getTime()) return fail('invalid_session_range', '補登的開始必須早於結束,且不能補登未來');
      if (state.sessions.some(s => start < (s.endedAt ? Date.parse(s.endedAt) : s.mode === 'pomodoro' ? sessionDue(state, s).getTime() : ctx.now.getTime()) && end > Date.parse(s.startedAt))) return fail('session_overlap', '補登不能與既有工作時段重疊');
      const title = command.adHocTitle?.trim();
      if (command.taskId && title) return fail('invalid_task', '請選擇 Task 或建立臨時工作,不能同時指定');
      const task = title ? { id: ctx.newId('tsk'), projectId: INTERRUPT_BUCKET_ID, title, status: 'open' as const, doneAt: null, createdAt: ts, updatedAt: ts } : state.tasks.find(t => t.id === command.taskId);
      if (!task) return fail('task_not_found', '補登必須選擇 Task 或輸入臨時工作名稱');
      return succeed({ ...state, tasks: title ? [...state.tasks, task] : state.tasks,
        sessions: [...state.sessions, { id: ctx.newId('ses'), taskId: task.id, mode: 'retroactive',
          startedAt: formatTimestamp(new Date(start), state.settings.timezone), endedAt: formatTimestamp(new Date(end), state.settings.timezone),
          outcome: 'completed', adHoc: task.projectId === INTERRUPT_BUCKET_ID, interruptedBySessionId: null, endTimeUnconfirmed: false,
          note: command.note.trim(), createdAt: ts, updatedAt: ts }],
      });
    }
    case 'reconcileTimers':
      return succeed(reconcileTimers(state, ctx.now));
    case 'confirmSessionEnd': {
      const session = state.sessions.find(s => s.id === command.sessionId && s.endTimeUnconfirmed);
      if (!session || session.endedAt === null) return fail('session_not_found', '找不到待確認的工作時段');
      const end = Date.parse(command.endedAt);
      if (!Number.isFinite(end) || end < Date.parse(session.startedAt) || end > Date.parse(session.endedAt)) return fail('invalid_end', '確認時間必須介於開始與自動停止時間之間');
      return succeed({ ...state, sessions: state.sessions.map(s => s.id === session.id ? { ...s,
        endedAt: formatTimestamp(new Date(end), state.settings.timezone), endTimeUnconfirmed: false, note: command.note.trim(), updatedAt: ts } : s) });
    }
    case 'insertAdHocTask': {
      const title = command.title.trim();
      if (!title) return fail('invalid_title', '請輸入臨時工作名稱');
      const taskId = ctx.newId('tsk');
      const sessionId = ctx.newId('ses');
      return succeed({ ...state,
        tasks: [...state.tasks, { id: taskId, projectId: INTERRUPT_BUCKET_ID, title, status: 'open', doneAt: null, createdAt: ts, updatedAt: ts }],
        sessions: [...state.sessions.map(s => s.endedAt === null ? { ...s,
          endedAt: s.mode === 'pomodoro' && sessionDue(state, s).getTime() < ctx.now.getTime() ? formatTimestamp(sessionDue(state, s), state.settings.timezone) : ts,
          outcome: 'interrupted' as const, interruptedBySessionId: sessionId, updatedAt: ts } : s),
          { id: sessionId, taskId, mode: 'freeTimer', startedAt: ts, endedAt: null, outcome: null, adHoc: true,
            interruptedBySessionId: null, endTimeUnconfirmed: false, note: '', createdAt: ts, updatedAt: ts }],
      });
    }
    case 'startFreeTimer':
    case 'startPomodoro': {
      if (command.type === 'startFreeTimer' && command.durationMinutes != null && (!Number.isFinite(command.durationMinutes) || command.durationMinutes <= 0 || command.durationMinutes > state.settings.freeTimer.maxMinutes)) return fail('invalid_duration', '碼錶長度必須大於 0 且不超過上限');
      if (findRunningSession(state)) {
        return fail('session_running', '已經有一段正在計時的工作,請先結束或放棄');
      }
      const task = getStartableTasks(state).find((t) => t.id === command.taskId);
      if (!task) return explainNotStartable(state, command.taskId);
      const recommendation = getNextTask(state, ctx.now);
      const overrides =
        recommendation && recommendation.taskId !== task.id
          ? [
              ...state.overrides,
              {
                id: ctx.newId('ovr'),
                at: ts,
                type: 'differentTask' as const,
                suggested: { taskId: recommendation.taskId },
                actual: { taskId: task.id },
              },
            ]
          : state.overrides;
      return succeed({
        ...state,
        overrides,
        sessions: [
          ...state.sessions,
          {
            id: ctx.newId('ses'),
            taskId: task.id,
            mode: command.type === 'startPomodoro' ? 'pomodoro' : 'freeTimer',
            ...(command.type === 'startFreeTimer' ? { durationMinutes: command.durationMinutes ?? null } : {}),
            startedAt: ts,
            endedAt: null,
            outcome: null,
            adHoc: false,
            interruptedBySessionId: null,
            endTimeUnconfirmed: false,
            note: '',
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      });
    }

    case 'finishSession': {
      const session = findRunningSession(state);
      if (!session) return fail('no_running_session', '目前沒有正在計時的工作');
      const due = sessionDue(state, session);
      if (session.mode === 'pomodoro' && ctx.now.getTime() < due.getTime()) {
        return fail('not_due', '番茄鐘還沒結束;要提早停止請使用「放棄」');
      }
      const endedAt = session.mode === 'pomodoro' ? formatTimestamp(due, state.settings.timezone) : ts;
      return succeed({
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? { ...s, endedAt, outcome: 'completed', note: command.note.trim(), updatedAt: ts }
            : s,
        ),
        tasks: command.completeTask
          ? state.tasks.map((t) =>
              t.id === session.taskId && t.status === 'open' ? { ...t, status: 'done', doneAt: ts, updatedAt: ts } : t,
            )
          : state.tasks,
      });
    }

    case 'abandonSession': {
      const session = findRunningSession(state);
      if (!session) return fail('no_running_session', '目前沒有正在計時的工作');
      const due = sessionDue(state, session);
      const endedAt = session.mode === 'pomodoro' && ctx.now.getTime() > due.getTime() ? formatTimestamp(due, state.settings.timezone) : ts;
      return succeed({
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? { ...s, endedAt, outcome: 'abandoned', note: (command.note ?? '').trim(), updatedAt: ts }
            : s,
        ),
      });
    }
  }
}
