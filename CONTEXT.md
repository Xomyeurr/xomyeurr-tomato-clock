# Tomato Clock Time Manager

A Chrome-extension-based personal time-management tool that connects mid/long-term project planning to daily Pomodoro-style execution, with local file-based data so a local AI agent can read and reason about it.

## Language

**Project**:
A mid/long-term unit of work corresponding to one concrete change request the user has taken on. Has a name, a start date, an optional end date, and a Schedule Weight that governs how its time gets allocated day to day.
_Avoid_: Goal, initiative, ticket

**Task**:
A cohesive body of work within a Project, scoped to one direction or problem rather than a fixed time size — related issues that share a root cause (e.g. bugs found in the same code review) stay merged into one Task rather than being split apart. A Task can span multiple Pomodoro Sessions across multiple days; it is marked done manually by the user, never inferred from elapsed time.
_Avoid_: Subtask, ticket, issue

**Pomodoro Session**:
A single focused work block that always belongs to exactly one Task. Ends with a short freeform note on what was focused on and the outcome — this note is the user's only work log; there is no separate journal or todo-list feature.
_Avoid_: Timer, focus block

**Requester**:
The person who assigned or requested a Project. Stored as a reusable entry with a default priority weight, reusable across Projects and overridable per Project. One of the inputs to a Project's Schedule Weight.
_Avoid_: Owner, assignee, client, committer

**Schedule Weight**:
A Project's daily time allocation, computed by combining multiple weighted factors — deadline urgency, Requester weight, and user-set manual priority — rather than picking a single rule type. Factor weights have defaults and are adjustable.
_Avoid_: Priority (alone, without saying which factor)

**Override**:
A record capturing the gap between what the rule engine proposed for a day and what the user actually did, logged from day one even before anything analyzes it. Feeds the future adaptive adjustment of Schedule Weight factors.
_Avoid_: Log, journal entry

**Trigger**:
An entry point that requests an AI review of the current scheduling rules. In v1 the only Trigger is a manual button in the extension; future Triggers (chat tools, PM software, a cron schedule) are handled by the Companion Process, not the extension itself.

**Companion Process**:
A local, independently-running program outside the Chrome extension that owns Trigger sources the extension itself cannot support (background, scheduled, or external triggers), reading and writing the same `./data` files as the extension. Introduced starting Phase 2.
_Avoid_: Backend, server

**Weekly Work-Hours Template**:
A recurring base schedule of available work time per weekday (weekends default off), used to compute daily Pomodoro capacity. Any single day's capacity can be manually adjusted from the template (e.g. leaving early, opting into weekend project work).

**Ad-hoc Task**:
A Task created for unplanned, urgently-assigned work that doesn't belong to any tracked Project. Lives under the Interrupt Bucket rather than a real Project, skips Schedule Weight entirely, and can later be manually promoted into a real Project if it turns out to be ongoing work.
_Avoid_: Quick task, interrupt

**Interrupt Bucket**:
The single system-provided pseudo-Project that houses all Ad-hoc Tasks, so every Pomodoro Session — planned or unplanned — still belongs to exactly one Task under some Project-like container. Time logged here still consumes the day's Weekly Work-Hours Template capacity, but is reported separately from planned Project work.
_Avoid_: Miscellaneous, backlog

**Effort Estimate**:
A Project's stated minimum time to complete (in workdays or Pomodoro Sessions), set at creation. Combined with the end date and a safety buffer, it determines the Project's Must-Start-By date.

**Must-Start-By**:
The latest date a Project can start receiving daily time before it risks missing its deadline, derived from the end date minus the Effort Estimate minus a safety buffer. Once reached, the Project is guaranteed a minimum daily quota regardless of how it scores on Schedule Weight; only the remaining capacity is contested by weight.

**Deadline Risk Warning**:
A self-facing alert (never sent to anyone else automatically) that a Project's deadline is at risk. Fires when either: the projected completion date exceeds the deadline by more than a configured buffer (default 0 days, overridable per Project), or remaining available capacity before the deadline falls below a configured percentage of the remaining Effort Estimate. Either condition alone is sufficient — it is not an AI judgment, just a rule-engine computation.
_Avoid_: Notification (implies sent to someone else)
