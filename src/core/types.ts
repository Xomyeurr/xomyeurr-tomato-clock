export type Timestamp = string;
export type DateString = string;

export interface Context {
  now: Date;
  newId: (prefix: string) => string;
}

export interface Settings {
  timezone: string;
  pomodoro: { focusMinutes: number; breakMinutes: number };
  freeTimer: { maxMinutes: number };
  scheduleWeightFactors: { deadlineUrgency: number; requester: number; manualPriority: number };
  mustStartBy: { safetyBufferWorkdays: number; guaranteedMinutesPerDay: number };
  deadlineRisk: { lateDays: number; availablePercent: number };
  updatedAt: Timestamp;
}

export interface Requester {
  id: string;
  name: string;
  defaultWeight: number;
  status: 'active' | 'archived';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DeadlineRiskOverride {
  lateDays?: number;
  availablePercent?: number;
}

export interface Project {
  id: string;
  kind: 'project' | 'interruptBucket';
  name: string;
  requesterId: string | null;
  requesterWeightOverride: number | null;
  manualPriority: number | null;
  startDate: DateString | null;
  endDate: DateString | null;
  effortEstimateMinutes: number | null;
  deadlineRiskOverride: DeadlineRiskOverride | null;
  status: 'active' | 'done' | 'archived';
  doneAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'done' | 'archived';
  doneAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WorkSession {
  id: string;
  taskId: string;
  mode: 'pomodoro' | 'freeTimer' | 'retroactive';
  durationMinutes?: number | null;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  outcome: 'completed' | 'abandoned' | 'interrupted' | null;
  adHoc: boolean;
  interruptedBySessionId: string | null;
  endTimeUnconfirmed: boolean;
  note: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Override {
  id: string;
  at: Timestamp;
  type: 'differentTask';
  suggested: { taskId: string } | null;
  actual: { taskId: string };
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface TimeRange { start: string; end: string }
export interface WorkHours {
  weekly: Record<Weekday, TimeRange[]>;
  dayOverrides: Record<DateString, TimeRange[]>;
  updatedAt: Timestamp;
}

export type CommitmentSchedule =
  | { type: 'once'; date: DateString; start: string; end: string }
  | { type: 'weekly'; weekdays: Weekday[]; start: string; end: string; fromDate: DateString; untilDate: DateString | null };
export interface Commitment {
  id: string;
  title: string;
  projectId: string | null;
  schedule: CommitmentSchedule;
  skippedDates: DateString[];
  status: 'active' | 'archived';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AppState {
  commitments: Commitment[];
  workHours: WorkHours;
  settings: Settings;
  requesters: Requester[];
  projects: Project[];
  tasks: Task[];
  sessions: WorkSession[];
  overrides: Override[];
}
