import { useEffect, useState, useRef } from 'react';
import { Card, DatePicker, Select, Space } from 'antd';
import { api } from '../api';
import type { LogRecord } from '../../shared/types.js';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[number, number] | undefined>();
  const [tasks, setTasks] = useState<any[]>([]);
  const lastId = useRef(0);

  useEffect(() => { api.listTasks().then(setTasks); }, []);

  useEffect(() => {
    lastId.current = 0;
    api.listLogs(0, taskId, dateRange?.[0], dateRange?.[1]).then(rows => {
      setLogs(rows);
      lastId.current = rows.length ? rows[rows.length - 1].id : 0;
    });
    const timer = setInterval(async () => {
      const rows = await api.listLogs(lastId.current, taskId, dateRange?.[0], dateRange?.[1]);
      if (rows.length) {
        setLogs(prev => [...prev, ...rows]);
        lastId.current = rows[rows.length - 1].id;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [taskId, dateRange]);

  return (
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
  );
}
