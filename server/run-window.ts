function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function isWithinRunWindow(enabled: boolean, start: string | null, end: string | null, now = new Date()): boolean {
  if (!enabled || !start || !end) return true;
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}

export function millisecondsUntilRunWindow(start: string, now = new Date()): number {
  const [hour, minute] = start.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
