export class TaskStatusPolling {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reload: () => Promise<void>,
    private readonly intervalMs = 1000
  ) {}

  observe(tasks: Array<{ lastStatus: string | null }>): void {
    const hasRunningTask = tasks.some(task => task.lastStatus === 'running');
    if (hasRunningTask && !this.timer) {
      this.timer = setInterval(() => { void this.reload(); }, this.intervalMs);
    }
    if (!hasRunningTask && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshNow(): Promise<void> {
    await this.reload();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
