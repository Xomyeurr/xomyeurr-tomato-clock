import { getTimerStatus } from '../core';
import { loadState, onStateChanged } from './storage';

const TIMER_ALARM = 'timer-wakeup';
async function refreshTimerIndicator(): Promise<void> {
  const state = await loadState();
  const now = new Date();
  const { running } = getTimerStatus(state, now);
  const wakeups = [running?.dueAt, running?.autoStopAt]
    .filter((time): time is string => !!time && Date.parse(time) > now.getTime()).map(Date.parse);
  if (wakeups.length) await chrome.alarms.create(TIMER_ALARM, { when: Math.min(...wakeups) });
  else await chrome.alarms.clear(TIMER_ALARM);
  const attention = running?.isDue || state.sessions.some(s => s.endTimeUnconfirmed);
  if (attention) await chrome.action.setBadgeBackgroundColor({ color: '#e5533d' });
  await chrome.action.setBadgeText({ text: attention ? '!' : '' });
}
let refreshing = Promise.resolve();
function refresh(): void {
  refreshing = refreshing.then(refreshTimerIndicator).catch(console.error);
}
chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === TIMER_ALARM || alarm.name === 'pomodoro-due') refresh(); });
onStateChanged(refresh);
refresh();
