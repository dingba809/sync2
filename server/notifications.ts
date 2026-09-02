export interface NotificationConfig {
  telegramEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  barkEnabled: boolean;
  barkServerUrl?: string;
  barkDeviceKey?: string;
}

export interface SyncNotification {
  taskName: string;
  status: 'success' | 'failed';
  uploadedCount: number;
  deletedCount: number;
  error?: string;
}

export async function sendSyncNotification(config: NotificationConfig, result: SyncNotification): Promise<void> {
  const title = `同步${result.status === 'success' ? '成功' : '失败'}：${result.taskName}`;
  const body = [`上传 ${result.uploadedCount} 个文件`, `删除 ${result.deletedCount} 个文件`, result.error].filter(Boolean).join('\n');
  const requests: Promise<Response>[] = [];
  if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
    requests.push(fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text: `${title}\n${body}` })
    }));
  }
  if (config.barkEnabled && config.barkServerUrl && config.barkDeviceKey) {
    requests.push(fetch(`${config.barkServerUrl.replace(/\/$/, '')}/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_key: config.barkDeviceKey, title, body, level: result.status === 'success' ? 'active' : 'timeSensitive' })
    }));
  }
  const responses = await Promise.all(requests);
  if (responses.some(response => !response.ok)) throw new Error('通知服务返回失败状态');
}
