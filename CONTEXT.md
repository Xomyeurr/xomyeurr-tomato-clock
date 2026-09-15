# Tomato Clock Time Manager

A personal Chrome-extension time-management tool that connects mid/long-term project planning to lightweight daily time management — Pomodoros, free timers, after-the-fact logging, fixed commitments, and time blocks — with local file-based data a local AI agent can read.

## Language

### Planning

**Project**:
A mid/long-term unit of work corresponding to one concrete change request the user has taken on. Has a name, a start date, an optional end date, and a Schedule Weight that governs how its time gets allocated day to day. Marked done manually by the user; a done Project stops receiving time but keeps its history.
_Avoid_: Goal, initiative, ticket

**Task**:
A cohesive body of work within a Project, scoped to one direction or problem rather than a fixed time size — related issues that share a root cause (e.g. bugs found in the same code review) stay merged into one Task rather than being split apart. A Task can span multiple Work Sessions across multiple days; it is marked done manually by the user, never inferred from elapsed time.
_Avoid_: Subtask, ticket, issue

**Requester**:
The person who assigned or requested a Project. Stored as a reusable entry with a default priority weight, reusable across Projects and overridable per Project. Every Project has one; work nobody assigned uses the built-in "Self" Requester. One of the inputs to a Project's Schedule Weight.
_Avoid_: Owner, assignee, client, committer

**Effort Estimate**:
A Project's stated total hands-on time to complete, kept in minutes (the user may enter hours or days, converted via the Weekly Work-Hours Template). Remaining effort is the estimate minus the time logged in Work Sessions on the Project's Tasks — Commitment time never counts. When remaining effort reaches zero on a Project that isn't done, the user is prompted to re-estimate. Combined with the end date and a safety buffer, it determines the Project's Must-Start-By date.

**Must-Start-By**:
The latest date a Project can start receiving daily time before it risks missing its deadline, derived from the end date minus the Effort Estimate minus a safety buffer. Once reached, the Project is guaranteed a minimum daily quota regardless of how it scores on Schedule Weight; only the remaining available time is contested by weight.

**Schedule Weight**:
A Project's daily time allocation, computed by combining multiple weighted factors — deadline urgency, Requester weight, and user-set manual priority — rather than picking a single rule type. Factor weights have defaults and are adjustable.
_Avoid_: Priority (alone, without saying which factor)

### The day

**Weekly Work-Hours Template**:
A recurring set of working time ranges per weekday (e.g. 09:00–12:00 and 13:00–18:00; weekends empty by default) that defines each day's available work time. Any single date can override its ranges (e.g. leaving at 15:00, adding a Saturday afternoon).

**Commitment**:
A fixed item the user doesn't schedule freely — a meeting or a routine — entered manually as one-off or weekly recurring. Its time is removed from the day's available work time. It may be linked to a Project: the time then counts toward that Project in reports, but never reduces the Project's remaining Effort Estimate.
_Avoid_: Meeting, event, appointment

**Time Block**:
A span of the day's timeline assigned to a Project. Suggested Time Blocks are computed by the rule engine and recomputed whenever the day changes (work finished, an interruption, a new Commitment). The user can lock a Time Block — moving a suggested one also locks it — which reserves that span for its Project: inside it, the next Task is chosen only from that Project.
_Avoid_: Slot, calendar block, schedule

**Work Session**:
A span of time spent on exactly one Task, recorded as a Pomodoro (fixed focus length), a Free Timer (custom length or stopwatch), or a Retroactive Entry logged afterwards. Ends with a short freeform note — the user's only work log; there is no separate journal or todo-list feature. A session stopped early or cut off by an Ad-hoc Task is still recorded with its actual time, marked abandoned or interrupted.
_Avoid_: Pomodoro Session, time entry, focus block

**Ad-hoc Task**:
A Task created for unplanned, urgently-assigned work that doesn't belong to any tracked Project. Lives under the Interrupt Bucket rather than a real Project, skips Schedule Weight entirely, and can later be manually promoted into a real Project if it turns out to be ongoing work.
_Avoid_: Quick task, interrupt

**Interrupt Bucket**:
The single system-provided pseudo-Project that houses all Ad-hoc Tasks, so every Work Session — planned or unplanned — still belongs to exactly one Task under some Project-like container. Time logged here still consumes the day's available work time, but is reported separately from planned Project work.
_Avoid_: Miscellaneous, backlog

**Deadline Risk Warning**:
A self-facing alert (never sent to anyone else automatically) that a Project's deadline is at risk. Fires when either: the projected completion date exceeds the deadline by more than a configured buffer (default 0 days, overridable per Project), or remaining available time before the deadline falls below a configured percentage of the remaining Effort Estimate. Either condition alone is sufficient — it is not an AI judgment, just a rule-engine computation.
_Avoid_: Notification (implies sent to someone else)

**Override**:
A record of the user departing from the rule engine's suggestion — starting a different Task than suggested, or locking a Time Block. Logged from day one even before anything analyzes it; feeds the future adaptive adjustment of Schedule Weight factors.
_Avoid_: Log, journal entry

### AI integration

**Trigger**:
An entry point that requests an AI review of the current scheduling rules. In v1 the only Trigger is a manual button in the extension; future Triggers (chat tools, PM software, a cron schedule) are handled by the Companion Process, not the extension itself.

**Companion Process**:
A local, independently-running program outside the Chrome extension that owns Trigger sources the extension itself cannot support (background, scheduled, or external triggers). It reads the same `./data` files as the extension and sends any changes as Proposals rather than editing data. Introduced starting Phase 2.
_Avoid_: Backend, server

**Proposal**:
A change an AI agent wants made, written to the proposal inbox instead of to the data, and applied only after the user approves. Introduced starting Phase 2.
_Avoid_: Suggestion (reserved for the rule engine's output), patch
