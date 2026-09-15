import { getTimerStatus } from '../core';
import { loadState, onStateChanged } from './storage';

const DUE_ALARM = 'pomodoro-due';

async function refreshTimerIndicator(): Promise<void> {
  const state = await loadState();
  const { running } = getTimerStatus(state, new Date());

  if (running && !running.isDue) {
    await chrome.alarms.create(DUE_ALARM, { when: Date.parse(running.dueAt) });
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  await chrome.alarms.clear(DUE_ALARM);
  if (running?.isDue) {
    await chrome.action.setBadgeBackgroundColor({ color: '#e5533d' });
    await chrome.action.setBadgeText({ text: '!' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onInstalled.addListener(() => void refreshTimerIndicator());
chrome.runtime.onStartup.addListener(() => void refreshTimerIndicator());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DUE_ALARM) void refreshTimerIndicator();
});
onStateChanged(() => void refreshTimerIndicator());
