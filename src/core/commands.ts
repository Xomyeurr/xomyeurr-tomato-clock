import { applyRequesterCommand, type RequesterCommand } from './requesters';
import { type CommandResult, fail, succeed } from './result';
import { applySessionCommand, type SessionCommand } from './sessions';
import { SELF_REQUESTER_ID } from './state';
import { formatTimestamp } from './time';
import type { AppState, Context, DateString, Project, Task } from './types';
import { isValidDate, isWeight } from './validation';

export type { CommandError, CommandResult } from './result';

type ProjectCommand =
  | {
      type: 'createProject';
      name: string;
      startDate: DateString;
      endDate?: DateString | null;
      requesterId?: string;
      requesterWeightOverride?: number | null;
      manualPriority?: number;
    }
  | {
      type: 'updateProject';
      projectId: string;
      name?: string;
      startDate?: DateString;
      endDate?: DateString | null;
      requesterId?: string;
      requesterWeightOverride?: number | null;
      manualPriority?: number;
    }
  | { type: 'completeProject'; projectId: string };

type TaskCommand =
  | { type: 'createTask'; projectId: string; title: string }
  | { type: 'updateTask'; taskId: string; title: string }
  | { type: 'completeTask'; taskId: string };

export type Command = ProjectCommand | TaskCommand | RequesterCommand | SessionCommand;

type ProjectFields = Pick<
  Project,
  'name' | 'startDate' | 'endDate' | 'requesterId' | 'requesterWeightOverride' | 'manualPriority'
>;

function validateProjectFields(state: AppState, fields: ProjectFields): CommandResult | null {
  if (!fields.name) return fail('invalid_name', '請輸入專案名稱');
  if (fields.startDate === null || !isValidDate(fields.startDate)) {
    return fail('invalid_date', '開始日格式不正確,請使用 YYYY-MM-DD');
  }
  if (fields.endDate !== null && !isValidDate(fields.endDate)) {
    return fail('invalid_date', '截止日格式不正確,請使用 YYYY-MM-DD');
  }
  if (fields.endDate !== null && fields.endDate < fields.startDate) {
    return fail('invalid_date_range', '截止日不能早於開始日');
  }
  if (fields.manualPriority === null || !isWeight(fields.manualPriority)) {
    return fail('invalid_manual_priority', '手動優先級必須是 1 到 5 的整數');
  }
  if (!state.requesters.some((r) => r.id === fields.requesterId && r.status === 'active')) {
    return fail('requester_not_found', '找不到這個 Requester');
  }
  if (fields.requesterWeightOverride !== null && !isWeight(fields.requesterWeightOverride)) {
    return fail('invalid_weight', '這個專案的 Requester 權重必須是 1 到 5 的整數');
  }
  return null;
}

function findUserProject(state: AppState, projectId: string): Project | undefined {
  return state.projects.find((p) => p.id === projectId && p.kind === 'project');
}

function findTask(state: AppState, taskId: string): Task | undefined {
  return state.tasks.find((t) => t.id === taskId);
}

function replaceTask(state: AppState, taskId: string, patch: Partial<Task>): AppState {
  return { ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) };
}

export function apply(state: AppState, command: Command, ctx: Context): CommandResult {
  const ts = formatTimestamp(ctx.now, state.settings.timezone);
  switch (command.type) {
    case 'createProject': {
      const fields: ProjectFields = {
        name: command.name.trim(),
        startDate: command.startDate,
        endDate: command.endDate ?? null,
        requesterId: command.requesterId ?? SELF_REQUESTER_ID,
        requesterWeightOverride: command.requesterWeightOverride ?? null,
        manualPriority: command.manualPriority ?? 3,
      };
      const invalid = validateProjectFields(state, fields);
      if (invalid) return invalid;
      return succeed({
        ...state,
        projects: [
          ...state.projects,
          {
            id: ctx.newId('prj'),
            kind: 'project',
            ...fields,
            effortEstimateMinutes: null,
            deadlineRiskOverride: null,
            status: 'active',
            doneAt: null,
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      });
    }

    case 'updateProject': {
      const project = findUserProject(state, command.projectId);
      if (!project) return fail('project_not_found', '找不到這個專案');
      const fields: ProjectFields = {
        name: command.name !== undefined ? command.name.trim() : project.name,
        startDate: command.startDate ?? project.startDate,
        endDate: command.endDate !== undefined ? command.endDate : project.endDate,
        requesterId: command.requesterId ?? project.requesterId,
        requesterWeightOverride:
          command.requesterWeightOverride !== undefined ? command.requesterWeightOverride : project.requesterWeightOverride,
        manualPriority: command.manualPriority ?? project.manualPriority,
      };
      const invalid = validateProjectFields(state, fields);
      if (invalid) return invalid;
      return succeed({
        ...state,
        projects: state.projects.map((p) => (p.id === project.id ? { ...p, ...fields, updatedAt: ts } : p)),
      });
    }

    case 'completeProject': {
      const project = findUserProject(state, command.projectId);
      if (!project) return fail('project_not_found', '找不到這個專案');
      if (project.status === 'done') return fail('project_already_done', '這個專案已經標記完成了');
      return succeed({
        ...state,
        projects: state.projects.map((p) =>
          p.id === project.id ? { ...p, status: 'done', doneAt: ts, updatedAt: ts } : p,
        ),
      });
    }

    case 'createTask': {
      const project = findUserProject(state, command.projectId);
      if (!project) return fail('project_not_found', '找不到這個專案');
      if (project.status === 'done') return fail('project_done', '這個專案已經完成,不能再新增 Task');
      const title = command.title.trim();
      if (!title) return fail('invalid_title', '請輸入 Task 標題');
      return succeed({
        ...state,
        tasks: [
          ...state.tasks,
          {
            id: ctx.newId('tsk'),
            projectId: project.id,
            title,
            status: 'open',
            doneAt: null,
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      });
    }

    case 'updateTask': {
      const task = findTask(state, command.taskId);
      if (!task) return fail('task_not_found', '找不到這個 Task');
      const title = command.title.trim();
      if (!title) return fail('invalid_title', '請輸入 Task 標題');
      return succeed(replaceTask(state, task.id, { title, updatedAt: ts }));
    }

    case 'completeTask': {
      const task = findTask(state, command.taskId);
      if (!task) return fail('task_not_found', '找不到這個 Task');
      if (task.status === 'done') return fail('task_already_done', '這個 Task 已經標記完成了');
      return succeed(replaceTask(state, task.id, { status: 'done', doneAt: ts, updatedAt: ts }));
    }

    case 'createRequester':
    case 'updateRequester':
      return applyRequesterCommand(state, command, ctx, ts);

    default:
      return applySessionCommand(state, command, ctx, ts);
  }
}
