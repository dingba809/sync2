import { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tag, Progress, Empty } from 'antd';
import { api } from '../api';
import type { TaskWithTargets, TaskProgress } from '../../shared/types.js';

function statusTag(status: string) {
  if (status === 'running') return <Tag color="processing">同步中</Tag>;
  if (status === 'paused') return <Tag color="gold">已暂停</Tag>;
  if (status === 'stopped') return <Tag color="orange">已停止</Tag>;
  if (status === 'success') return <Tag color="green">成功</Tag>;
  if (status === 'failed') return <Tag color="red">失败</Tag>;
  return <Tag>等待</Tag>;
}

export default function TaskDetailDrawer({ task, onClose }: {
  task: TaskWithTargets | null;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);

  useEffect(() => {
    if (!task) return;
    setProgress(null);
    api.getProgress(task.id).then(setProgress).catch(() => {});
    const es = new EventSource(api.progressStreamUrl(task.id));
    es.onmessage = (ev) => {
      try { setProgress(JSON.parse(ev.data)); } catch {}
    };
    return () => es.close();
  }, [task?.id]);

  return (
    <Drawer open={!!task} onClose={onClose} title={task ? `任务详情：${task.name}` : ''} width={560}>
      {task && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="本地目录">{task.localPath}</Descriptions.Item>
            <Descriptions.Item label="调度">{task.schedule ?? '手动'}</Descriptions.Item>
            <Descriptions.Item label="运行时间">{task.runWindowEnabled ? `${task.runWindowStart} - ${task.runWindowEnd}` : '不限'}</Descriptions.Item>
            <Descriptions.Item label="状态">{statusTag(task.lastStatus ?? '')}</Descriptions.Item>
          </Descriptions>

          <h4>备份目标</h4>
          {progress ? (
            progress.targets.map(tp => {
              const total = tp.totalUpload + tp.totalDelete;
              const done = tp.uploadedCount + tp.deletedCount;
              const percent = total > 0 ? Math.round(done / total * 100) : (tp.status === 'success' ? 100 : 0);
              return (
                <div key={tp.targetId} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{tp.accountName} → {tp.remotePath}</span>
                    {statusTag(tp.status)}
                  </div>
                  <Progress percent={percent} size="small" style={{ marginTop: 8 }} />
                  {tp.currentFile && <div style={{ fontSize: 12, color: '#888' }}>当前：{tp.currentFile}</div>}
                  <div style={{ fontSize: 12, color: '#888' }}>
                    上传成功 {tp.uploadedCount}，失败 {tp.failedUploadCount}，待处理 {Math.max(0, tp.totalUpload - tp.uploadedCount - tp.failedUploadCount)} · 删除 {tp.deletedCount}/{tp.totalDelete}
                  </div>
                </div>
              );
            })
          ) : (
            task.targets.map(t => (
              <div key={t.id} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                {t.accountId} → {t.remotePath}
              </div>
            ))
          )}
          {task.targets.length === 0 && <Empty description="暂无备份目标" />}
        </>
      )}
    </Drawer>
  );
}
