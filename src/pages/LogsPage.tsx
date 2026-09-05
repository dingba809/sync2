import { useEffect, useState, useRef } from 'react';
import { Button, Card, DatePicker, message, Select, Space, Table } from 'antd';
import { api } from '../api';
import type { AuditRecord, LogRecord, RunRecord } from '../../shared/types.js';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[number, number] | undefined>();
  const [tasks, setTasks] = useState<any[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runId, setRunId] = useState<string>();
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [hasMoreAudit, setHasMoreAudit] = useState(false);
  const lastId = useRef(0);

  useEffect(() => { api.listTasks().then(setTasks); }, []);

  useEffect(() => {
    lastId.current = 0;
    api.listLogs(0, taskId, dateRange?.[0], dateRange?.[1]).then(rows => {
      setLogs(rows);
      lastId.current = rows.length ? rows[0].id : 0;
    });
    const timer = setInterval(async () => {
      const rows = await api.listLogs(lastId.current, taskId, dateRange?.[0], dateRange?.[1]);
      if (rows.length) {
        setLogs(prev => [...rows, ...prev]);
        lastId.current = rows[0].id;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [taskId, dateRange]);

  useEffect(() => {
    setRuns([]); setRunId(undefined); setAudit([]); setHasMoreAudit(false);
    if (!taskId) return;
    api.listRuns(taskId).then(rows => {
      setRuns(rows);
      if (rows[0]) setRunId(rows[0].id);
    });
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !runId) { setAudit([]); return; }
    api.listAudit(taskId, runId).then(rows => {
      setAudit(rows);
      setHasMoreAudit(rows.length === 200);
    });
  }, [taskId, runId]);

  const loadMoreAudit = async () => {
    if (!taskId || !runId || audit.length === 0) return;
    const rows = await api.listAudit(taskId, runId, audit[audit.length - 1].id);
    setAudit(prev => [...prev, ...rows]);
    setHasMoreAudit(rows.length === 200);
  };

  const retryFailed = async () => {
    if (!taskId || !runId) return;
    const result = await api.retryFailedRun(taskId, runId);
    message.success(`已发起失败文件重试：上传 ${result.uploadCount} 个，删除 ${result.deleteCount} 个`);
  };

  const actionLabel: Record<string, string> = {
    metadata_skipped: '元数据跳过', hash_skipped: '哈希跳过', claimed: '认领远端', uploaded: '上传成功', replaced: '上传替换',
    deleted: '删除成功', upload_failed: '上传失败', delete_failed: '删除失败', conflict: '冲突跳过', cleanup_deleted: '旧文件已清理', cleanup_failed: '旧文件清理失败'
  };
  const canRetry = audit.some(row => row.action === 'upload_failed' || row.action === 'delete_failed');

  return (
    <>
    <Card title="日志" extra={
      <Space>
        <Select allowClear placeholder="按任务过滤" style={{ width: 200 }}
          options={tasks.map(t => ({ value: t.id, label: t.name }))}
          onChange={(v) => setTaskId(v)} />
        <DatePicker.RangePicker
          placeholder={['开始日期', '结束日期']}
          onChange={(dates) => setDateRange(
            dates?.[0] && dates[1]
              ? [dates[0].startOf('day').valueOf(), dates[1].add(1, 'day').startOf('day').valueOf()]
              : undefined
          )}
        />
      </Space>
    }>
      <div style={{ fontFamily: 'monospace', fontSize: 13, maxHeight: '70vh', overflow: 'auto' }}>
        {logs.map(l => (
          <div key={l.id} style={{ color: l.level === 'error' ? '#cf1322' : '#000' }}>
            [{new Date(l.createdAt).toLocaleString()}] {l.message}
          </div>
        ))}
      </div>
    </Card>
    <Card title="文件审计明细" style={{ marginTop: 16 }} extra={<Space>
      <Select allowClear placeholder="选择一次运行" value={runId} style={{ width: 280 }}
        options={runs.map(run => ({ value: run.id, label: `${new Date(run.startedAt).toLocaleString()} · ${run.status}` }))}
        onChange={setRunId} />
      <Button disabled={!canRetry} type="primary" onClick={() => void retryFailed()}>重试失败文件</Button>
    </Space>
    }>
      {!taskId ? <span>请先选择任务</span> : <Table<AuditRecord>
        size="small" rowKey="id" dataSource={audit} pagination={false}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => new Date(value).toLocaleString() },
          { title: '文件', dataIndex: 'relPath' },
          { title: '结果', dataIndex: 'action', width: 150, render: (value) => actionLabel[value] || value },
          { title: '详情', dataIndex: 'detail', render: (value) => value || '-' }
        ]}
        footer={() => hasMoreAudit ? <Button size="small" onClick={loadMoreAudit}>加载更多</Button> : null}
      />}
    </Card>
    </>
  );
}
