import type { Timestamp } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTimestamp(date: Date, timeZone: string): Timestamp {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((localAsUtc - wholeSeconds) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);

  return (
    `${get('year')}-${pad(get('month'))}-${pad(get('day'))}` +
    `T${pad(get('hour'))}:${pad(get('minute'))}:${pad(get('second'))}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
