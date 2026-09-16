import { getMustStartBy, getScheduleWeight, getSuggestedTimeBlocks } from './planning';
import { getLockedTimeBlocks } from './time-blocks';
import type { AppState, Project, Task } from './types';

export interface Recommendation {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  reason: 'highestWeight' | 'mustStartBy' | 'lockedTimeBlock' | 'lockedTimeBlockNoTask' | 'noAvailableTime';
  score: number;
}

export function getStartableTasks(state: AppState): Task[] {
  const activeProjectIds = new Set(
    state.projects.filter((p) => p.kind === 'project' && p.status === 'active').map((p) => p.id),
  );
  return state.tasks
    .filter((t) => t.status === 'open' && activeProjectIds.has(t.projectId))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function pickTask(state: AppState, candidates: Task[]): Task | undefined {
  let lastWorked: { taskId: string; time: number } | undefined;
  for (const session of state.sessions) {
    if (!candidates.some((t) => t.id === session.taskId)) continue;
    const time = new Date(session.startedAt).getTime();
    if (!lastWorked || time > lastWorked.time) lastWorked = { taskId: session.taskId, time };
  }
  return lastWorked ? candidates.find((t) => t.id === lastWorked.taskId) : candidates[0];
}

export function getNextTask(state: AppState, now: Date): Recommendation | null {
  const startable = getStartableTasks(state);
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone }).format(now);
  const current = now.toLocaleTimeString('en-GB', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const locked = getLockedTimeBlocks(state, localDate).find(b => b.start <= current && current < b.end);
  let lockedWithoutTask = false;
  if (locked) {
    const lockedTasks = startable.filter(t => t.projectId === locked.projectId);
    const task = pickTask(state, lockedTasks);
    if (task) return { taskId: task.id, taskTitle: task.title, projectId: locked.projectId, projectName: state.projects.find(p => p.id === locked.projectId)?.name ?? '', reason: 'lockedTimeBlock', score: getScheduleWeight(state, state.projects.find(p => p.id === locked.projectId)!, now).total };
    lockedWithoutTask = true;
  }
  const suggested = getSuggestedTimeBlocks(state, now)[0];
  if (suggested) {
    const suggestedTasks = startable.filter(t => t.projectId === suggested.projectId);
    const task = pickTask(state, suggestedTasks);
    const project = state.projects.find(p => p.id === suggested.projectId);
    if (task && project) {
      const must = getMustStartBy(state, project.id, now);
      return { taskId: task.id, taskTitle: task.title, projectId: project.id, projectName: project.name,
        reason: lockedWithoutTask ? 'lockedTimeBlockNoTask' : must !== null && must <= localDate ? 'mustStartBy' : 'highestWeight', score: getScheduleWeight(state, project, now).total };
    }
  }
  let best: { project: Project; score: number; must: boolean } | undefined;
  for (const project of state.projects) {
    if (!startable.some((t) => t.projectId === project.id)) continue;
    const score = getScheduleWeight(state, project, now).total;
    const must = !!getMustStartBy(state, project.id, now) && getMustStartBy(state, project.id, now)! <= localDate;
    const createdEarlier =
      best !== undefined && new Date(project.createdAt).getTime() < new Date(best.project.createdAt).getTime();
    if (!best || Number(must) > Number(best.must) || (must === best.must && (score > best.score || (score === best.score && createdEarlier)))) best = { project, score, must };
  }
  if (!best) return null;
  const chosen = best;
  const task = pickTask(state, startable.filter((t) => t.projectId === chosen.project.id));
  if (!task) return null;
  return {
    taskId: task.id,
    taskTitle: task.title,
    projectId: chosen.project.id,
    projectName: chosen.project.name,
    reason: lockedWithoutTask ? 'lockedTimeBlockNoTask' : suggested ? (chosen.must ? 'mustStartBy' : 'highestWeight') : 'noAvailableTime',
    score: chosen.score,
  };
}
