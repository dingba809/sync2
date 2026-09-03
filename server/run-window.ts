function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour * 60 + minute;
}

export function isWithinRunWindow(
  enabled: boolean,
  start: string | null,
  end: string | null,
  now = new Date(),
  timezone = 'Asia/Shanghai'
): boolean {
  if (!enabled || !start || !end) return true;
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;
  const current = minutesInTimezone(now, timezone);
  return from < to ? current >= from && current < to : current >= from || current < to;
}

export function millisecondsUntilRunWindow(start: string, now = new Date(), timezone = 'Asia/Shanghai'): number {
  const target = minutes(start);
  const fromNextMinute = new Date(now);
  fromNextMinute.setSeconds(0, 0);

  for (let offset = 1; offset <= 24 * 60 + 1; offset += 1) {
    const candidate = new Date(fromNextMinute.getTime() + offset * 60 * 1000);
    if (minutesInTimezone(candidate, timezone) === target) return candidate.getTime() - now.getTime();
  }

  return 60 * 1000;
}
