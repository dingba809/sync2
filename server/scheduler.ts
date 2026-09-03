import cron from 'node-cron';

export interface Scheduler {
  register(taskId: string, schedule: string | null, enabled: boolean, fn: () => void): void;
  unregister(taskId: string): void;
}

export function createScheduler(timezone = 'Asia/Shanghai'): Scheduler {
  const jobs = new Map<string, cron.ScheduledTask>();

  return {
    register(taskId, schedule, enabled, fn) {
      this.unregister(taskId);
      if (!schedule || !enabled) return;
      let cronExpr: string;
      if (schedule.startsWith('@')) {
        cronExpr = schedule;
      } else if (/^\d+$/.test(schedule)) {
        cronExpr = `*/${schedule} * * * *`;
      } else {
        cronExpr = schedule;
      }
      if (!cron.validate(cronExpr)) return;
      jobs.set(taskId, cron.schedule(cronExpr, fn, { timezone }));
    },
    unregister(taskId) {
      const j = jobs.get(taskId);
      if (j) { j.stop(); jobs.delete(taskId); }
    }
  };
}
