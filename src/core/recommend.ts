import type { AppState, Project, Task } from './types';

export interface Recommendation {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  reason: 'highestWeight';
  score: number;
}

const toUnit = (weight: number) => (weight - 1) / 4;

function scheduleWeight(state: AppState, project: Project): number {
  const requester = state.requesters.find((r) => r.id === project.requesterId);
  const requesterWeight = project.requesterWeightOverride ?? requester?.defaultWeight ?? 3;
  const factors = state.settings.scheduleWeightFactors;
  // Urgency needs Effort Estimate and work hours, which aren't modelled yet; 0 keeps this factor neutral.
  const deadlineUrgency = 0;
  return (
    factors.deadlineUrgency * deadlineUrgency +
    factors.requester * toUnit(requesterWeight) +
    factors.manualPriority * toUnit(project.manualPriority ?? 3)
  );
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
  let best: { project: Project; score: number } | undefined;
  for (const project of state.projects) {
    if (!startable.some((t) => t.projectId === project.id)) continue;
    const score = scheduleWeight(state, project);
    const createdEarlier =
      best !== undefined && new Date(project.createdAt).getTime() < new Date(best.project.createdAt).getTime();
    if (!best || score > best.score || (score === best.score && createdEarlier)) best = { project, score };
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
    reason: 'highestWeight',
    score: chosen.score,
  };
}
