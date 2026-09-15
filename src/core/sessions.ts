import { getNextTask, getStartableTasks } from './recommend';
import { type CommandResult, fail, succeed } from './result';
import { formatTimestamp } from './time';
import type { AppState, Context, Timestamp, WorkSession } from './types';

export type SessionCommand =
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
  dueAt: Timestamp;
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
  const session = findRunningSession(state);
  if (!session) return { running: null, breakEndsAt: currentBreakEnd(state, now) };
  const task = state.tasks.find((t) => t.id === session.taskId);
  const project = state.projects.find((p) => p.id === task?.projectId);
  const due = sessionDue(state, session);
  return {
    running: {
      sessionId: session.id,
      taskId: session.taskId,
      taskTitle: task?.title ?? '',
      projectName: project?.name ?? '',
      mode: session.mode,
      startedAt: session.startedAt,
      dueAt: formatTimestamp(due, state.settings.timezone),
      remainingSeconds: Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 1000)),
      isDue: now.getTime() >= due.getTime(),
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
    case 'startPomodoro': {
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
            mode: 'pomodoro',
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
      if (ctx.now.getTime() < due.getTime()) {
        return fail('not_due', '番茄鐘還沒結束;要提早停止請使用「放棄」');
      }
      const endedAt = formatTimestamp(due, state.settings.timezone);
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
      const endedAt = ctx.now.getTime() > due.getTime() ? formatTimestamp(due, state.settings.timezone) : ts;
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
