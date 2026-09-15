import { formatTimestamp } from './time';
import type { AppState, Context } from './types';

export const SELF_REQUESTER_ID = 'req_self';
export const INTERRUPT_BUCKET_ID = 'interrupt-bucket';
const DEFAULT_TIMEZONE = 'Asia/Taipei';

export function createInitialState(ctx: Context): AppState {
  const ts = formatTimestamp(ctx.now, DEFAULT_TIMEZONE);
  return {
    settings: {
      timezone: DEFAULT_TIMEZONE,
      pomodoro: { focusMinutes: 50, breakMinutes: 10 },
      freeTimer: { maxMinutes: 150 },
      scheduleWeightFactors: { deadlineUrgency: 0.5, requester: 0.25, manualPriority: 0.25 },
      mustStartBy: { safetyBufferWorkdays: 1, guaranteedMinutesPerDay: 50 },
      deadlineRisk: { lateDays: 0, availablePercent: 120 },
      updatedAt: ts,
    },
    requesters: [
      { id: SELF_REQUESTER_ID, name: '自己', defaultWeight: 3, status: 'active', createdAt: ts, updatedAt: ts },
    ],
    projects: [
      {
        id: INTERRUPT_BUCKET_ID,
        kind: 'interruptBucket',
        name: '臨時工作區',
        requesterId: null,
        requesterWeightOverride: null,
        manualPriority: null,
        startDate: null,
        endDate: null,
        effortEstimateMinutes: null,
        deadlineRiskOverride: null,
        status: 'active',
        doneAt: null,
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    tasks: [],
    sessions: [],
    overrides: [],
  };
}
