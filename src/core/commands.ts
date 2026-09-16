import { applyCommitmentCommand, type CommitmentCommand } from './commitments';
import { applyWorkHoursCommand, type WorkHoursCommand } from './work-hours';
import { applyRequesterCommand, type RequesterCommand } from './requesters';
import { type CommandResult, fail, succeed } from './result';
import { applySessionCommand, reconcileTimers, type SessionCommand } from './sessions';
import { formatTimestamp } from './time';
import type { AppState, Context, DateString, Project, Settings, Task } from './types';
import { isValidDate, isWeight } from './validation';
import { applyTimeBlockCommand, type TimeBlockCommand } from './time-blocks';
import { averageWorkdayMinutes } from './planning';
import { INTERRUPT_BUCKET_ID } from './state';

export type { CommandError, CommandResult } from './result';

type ProjectCommand =
  | {
      type: 'createProject';
      name: string;
      startDate: DateString;
      endDate?: DateString | null;
      requesterId: string;
      requesterWeightOverride?: number | null;
      manualPriority?: number;
      effortEstimateMinutes?: number | null;
      deadlineRiskOverride?: Project['deadlineRiskOverride'];
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
      effortEstimateMinutes?: number | null;
      deadlineRiskOverride?: Project['deadlineRiskOverride'];
    }
  | { type: 'completeProject'; projectId: string };

type SettingsPatch = {
  pomodoro?: Partial<Settings['pomodoro']>;
  freeTimer?: Partial<Settings['freeTimer']>;
  scheduleWeightFactors?: Partial<Settings['scheduleWeightFactors']>;
  mustStartBy?: Partial<Settings['mustStartBy']>;
  deadlineRisk?: Partial<Settings['deadlineRisk']>;
};

type SettingsCommand = { type: 'updateSettings'; patch: SettingsPatch };

type PlanningCommand =
  | { type: 'setEffortEstimate'; projectId: string; value: number; unit: 'minutes' | 'hours' | 'days' }
  | { type: 'setDeadlineRiskThreshold'; projectId: string; lateDays?: number; availablePercent?: number };

type TaskCommand =
  | { type: 'createTask'; projectId: string; title: string }
  | { type: 'updateTask'; taskId: string; title: string }
  | { type: 'completeTask'; taskId: string }
  | { type: 'archiveProject'; projectId: string }
  | { type: 'deleteProject'; projectId: string }
  | { type: 'archiveTask'; taskId: string }
  | { type: 'deleteTask'; taskId: string }
  | {
      type: 'promoteAdHocTaskToProject';
      taskId: string;
      name: string;
      startDate: DateString;
      endDate?: DateString | null;
      requesterId: string;
      requesterWeightOverride?: number | null;
      manualPriority?: number;
      effortEstimateMinutes?: number | null;
      deadlineRiskOverride?: Project['deadlineRiskOverride'];
    };

export type Command = SettingsCommand | ProjectCommand | TaskCommand | PlanningCommand | TimeBlockCommand | RequesterCommand | SessionCommand | WorkHoursCommand | CommitmentCommand;

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
  if (!fields.requesterId) {
    return fail('requester_required', '請選擇 Requester;沒有人交辦的工作請選「自己」');
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

const positiveInteger = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value > 0);
const nonNegativeInteger = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value >= 0);
const nonNegativeNumber = (value: number | undefined) => value === undefined || (Number.isFinite(value) && value >= 0);

function validateSettings(settings: Settings): CommandResult | null {
  if (!positiveInteger(settings.pomodoro.focusMinutes) || !positiveInteger(settings.pomodoro.breakMinutes)) {
    return fail('invalid_pomodoro_settings', '番茄鐘長度必須是大於 0 的整數');
  }
  if (!positiveInteger(settings.freeTimer.maxMinutes)) {
    return fail('invalid_free_timer_settings', '碼錶上限必須是大於 0 的整數');
  }
  const factors = settings.scheduleWeightFactors;
  if (!nonNegativeNumber(factors.deadlineUrgency) || !nonNegativeNumber(factors.requester) || !nonNegativeNumber(factors.manualPriority)) {
    return fail('invalid_schedule_weight_factors', '排程權重比例不能是負數');
  }
  const total = factors.deadlineUrgency + factors.requester + factors.manualPriority;
  if (Math.abs(total - 1) > 0.000_001) {
    return fail('invalid_schedule_weight_factors', '排程權重比例加總必須等於 1');
  }
  if (!nonNegativeInteger(settings.mustStartBy.safetyBufferWorkdays) || !positiveInteger(settings.mustStartBy.guaranteedMinutesPerDay)) {
    return fail('invalid_must_start_by_settings', '保底與安全緩衝設定不正確');
  }
  if (!nonNegativeInteger(settings.deadlineRisk.lateDays) || !nonNegativeNumber(settings.deadlineRisk.availablePercent)) {
    return fail('invalid_deadline_risk_settings', '逾期預警設定不正確');
  }
  return null;
}

function hasTaskHistory(state: AppState, taskId: string): boolean {
  return state.sessions.some((session) => session.taskId === taskId);
}

function projectTaskIds(state: AppState, projectId: string): string[] {
  return state.tasks.filter((task) => task.projectId === projectId).map((task) => task.id);
}

function hasProjectHistory(state: AppState, projectId: string): boolean {
  const ids = new Set(projectTaskIds(state, projectId));
  return state.sessions.some((session) => ids.has(session.taskId));
}

export function apply(state: AppState, command: Command, ctx: Context): CommandResult {
  state = reconcileTimers(state, ctx.now);
  const ts = formatTimestamp(ctx.now, state.settings.timezone);
  switch (command.type) {
    case 'updateSettings': {
      const settings: Settings = {
        ...state.settings,
        pomodoro: { ...state.settings.pomodoro, ...(command.patch.pomodoro ?? {}) },
        freeTimer: { ...state.settings.freeTimer, ...(command.patch.freeTimer ?? {}) },
        scheduleWeightFactors: { ...state.settings.scheduleWeightFactors, ...(command.patch.scheduleWeightFactors ?? {}) },
        mustStartBy: { ...state.settings.mustStartBy, ...(command.patch.mustStartBy ?? {}) },
        deadlineRisk: { ...state.settings.deadlineRisk, ...(command.patch.deadlineRisk ?? {}) },
        updatedAt: ts,
      };
      const invalid = validateSettings(settings);
      if (invalid) return invalid;
      return succeed({ ...state, settings });
    }

    case 'createProject': {
      const fields: ProjectFields = {
        name: command.name.trim(),
        startDate: command.startDate,
        endDate: command.endDate ?? null,
        requesterId: command.requesterId,
        requesterWeightOverride: command.requesterWeightOverride ?? null,
        manualPriority: command.manualPriority ?? 3,
      };
      const invalid = validateProjectFields(state, fields);
      if (invalid) return invalid;
      if (command.effortEstimateMinutes !== undefined && command.effortEstimateMinutes !== null && (!Number.isFinite(command.effortEstimateMinutes) || command.effortEstimateMinutes <= 0)) return fail('invalid_effort_estimate', '預估工作量必須大於 0');
      return succeed({
        ...state,
        projects: [
          ...state.projects,
          {
            id: ctx.newId('prj'),
            kind: 'project',
            ...fields,
            effortEstimateMinutes: command.effortEstimateMinutes ?? null,
            deadlineRiskOverride: command.deadlineRiskOverride ?? null,
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
      if (command.effortEstimateMinutes !== undefined && command.effortEstimateMinutes !== null && (!Number.isFinite(command.effortEstimateMinutes) || command.effortEstimateMinutes <= 0)) return fail('invalid_effort_estimate', '預估工作量必須大於 0');
      return succeed({
        ...state,
        projects: state.projects.map((p) => (p.id === project.id ? {
          ...p, ...fields,
          ...(command.effortEstimateMinutes !== undefined ? { effortEstimateMinutes: command.effortEstimateMinutes } : {}),
          ...(command.deadlineRiskOverride !== undefined ? { deadlineRiskOverride: command.deadlineRiskOverride } : {}),
          updatedAt: ts,
        } : p)),
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

    case 'archiveProject': {
      const project = findUserProject(state, command.projectId);
      if (!project) return fail('project_not_found', '找不到這個專案');
      return succeed({
        ...state,
        projects: state.projects.map((p) => p.id === project.id ? { ...p, status: 'archived', updatedAt: ts } : p),
      });
    }

    case 'deleteProject': {
      const project = findUserProject(state, command.projectId);
      if (!project) return fail('project_not_found', '找不到這個專案');
      if (hasProjectHistory(state, project.id)) return fail('project_has_history', '這個專案已有工作紀錄,只能封存');
      const taskIds = new Set(projectTaskIds(state, project.id));
      return succeed({
        ...state,
        projects: state.projects.filter((p) => p.id !== project.id),
        tasks: state.tasks.filter((t) => !taskIds.has(t.id)),
        timeBlocks: state.timeBlocks.filter((block) => block.projectId !== project.id),
        commitments: state.commitments.map((commitment) => commitment.projectId === project.id ? { ...commitment, projectId: null, updatedAt: ts } : commitment),
      });
    }

    case 'setEffortEstimate': {
      const project = findUserProject(state, command.projectId);
      if (!project || !Number.isFinite(command.value) || command.value <= 0) return fail('invalid_effort_estimate', '預估工作量必須大於 0');
      const multiplier = command.unit === 'minutes' ? 1 : command.unit === 'hours' ? 60 : averageWorkdayMinutes(state);
      if (!multiplier) return fail('invalid_effort_estimate', '目前沒有可用的工作日，無法換算天數');
      return succeed({ ...state, projects: state.projects.map(p => p.id === project.id ? { ...p, effortEstimateMinutes: command.value * multiplier, updatedAt: ts } : p) });
    }

    case 'setDeadlineRiskThreshold': {
      const project = findUserProject(state, command.projectId);
      const lateDays = command.lateDays ?? project?.deadlineRiskOverride?.lateDays ?? state.settings.deadlineRisk.lateDays;
      const availablePercent = command.availablePercent ?? project?.deadlineRiskOverride?.availablePercent ?? state.settings.deadlineRisk.availablePercent;
      if (!project || !Number.isInteger(lateDays) || lateDays < 0 || !Number.isFinite(availablePercent) || availablePercent < 0) return fail('invalid_deadline_risk', '預警門檻不正確');
      return succeed({ ...state, projects: state.projects.map(p => p.id === project.id ? { ...p, deadlineRiskOverride: { lateDays, availablePercent }, updatedAt: ts } : p) });
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

    case 'archiveTask': {
      const task = findTask(state, command.taskId);
      if (!task) return fail('task_not_found', '找不到這個 Task');
      return succeed(replaceTask(state, task.id, { status: 'archived', updatedAt: ts }));
    }

    case 'deleteTask': {
      const task = findTask(state, command.taskId);
      if (!task) return fail('task_not_found', '找不到這個 Task');
      if (hasTaskHistory(state, task.id)) return fail('task_has_history', '這個 Task 已有工作紀錄,只能封存');
      return succeed({ ...state, tasks: state.tasks.filter((t) => t.id !== task.id) });
    }

    case 'promoteAdHocTaskToProject': {
      const task = findTask(state, command.taskId);
      if (!task || task.projectId !== INTERRUPT_BUCKET_ID) return fail('task_not_promotable', '只能升級臨時工作區底下的 Task');
      const fields: ProjectFields = {
        name: command.name.trim(),
        startDate: command.startDate,
        endDate: command.endDate ?? null,
        requesterId: command.requesterId,
        requesterWeightOverride: command.requesterWeightOverride ?? null,
        manualPriority: command.manualPriority ?? 3,
      };
      const invalid = validateProjectFields(state, fields);
      if (invalid) return invalid;
      if (command.effortEstimateMinutes !== undefined && command.effortEstimateMinutes !== null && (!Number.isFinite(command.effortEstimateMinutes) || command.effortEstimateMinutes <= 0)) {
        return fail('invalid_effort_estimate', '預估工作量必須大於 0');
      }
      const projectId = ctx.newId('prj');
      return succeed({
        ...state,
        projects: [
          ...state.projects,
          {
            id: projectId,
            kind: 'project',
            ...fields,
            effortEstimateMinutes: command.effortEstimateMinutes ?? null,
            deadlineRiskOverride: command.deadlineRiskOverride ?? null,
            status: 'active',
            doneAt: null,
            createdAt: ts,
            updatedAt: ts,
          },
        ],
        tasks: state.tasks.map((t) => t.id === task.id ? { ...t, projectId, updatedAt: ts } : t),
      });
    }

    case 'createCommitment':
    case 'updateCommitment':
    case 'archiveCommitment':
    case 'deleteCommitment':
    case 'skipCommitment':
      return applyCommitmentCommand(state, command, ctx);

    case 'setDayWorkHours':
    case 'setWeeklyWorkHours':
    case 'resetDayWorkHours':
    case 'shiftWorkdayEnd':
      return applyWorkHoursCommand(state, command, ctx);

    case 'lockTimeBlock':
    case 'moveTimeBlock':
    case 'unlockTimeBlock':
      return applyTimeBlockCommand(state, command, ctx);

    case 'createRequester':
    case 'updateRequester':
    case 'archiveRequester':
    case 'deleteRequester':
      return applyRequesterCommand(state, command, ctx, ts);

    default:
      return applySessionCommand(state, command, ctx, ts);
  }
}
