import { useEffect, useRef, useState } from 'react';
import { Card, Button, Switch, Space, Table, Tag, message, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, PlayCircleOutlined, PauseCircleOutlined, StopOutlined, EditOutlined, EyeOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../api';
import TaskFormModal from '../components/TaskFormModal';
import TaskDetailDrawer from '../components/TaskDetailDrawer';
import { TaskStatusPolling } from '../taskStatusPolling.js';
import type { TaskWithTargets } from '../../shared/types.js';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskWithTargets[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskWithTargets | null>(null);
  const [detail, setDetail] = useState<TaskWithTargets | null>(null);
  const poller = useRef<TaskStatusPolling | null>(null);

  const load = async () => {
    const nextTasks = await api.listTasks();
    setTasks(nextTasks);
    poller.current?.observe(nextTasks);
    setAccounts(await api.listAccounts());
  };

  useEffect(() => {
    poller.current = new TaskStatusPolling(load);
    void load();
    return () => poller.current?.dispose();
  }, []);

  const toggle = async (t: TaskWithTargets, enabled: boolean) => {
    await api.toggleTask(t.id, enabled);
    load();
  };

  const run = async (id: string) => {
    await api.runTask(id);
    await poller.current?.refreshNow();
    message.success('已触发同步');
  };

  const pause = async (id: string) => {
    await api.pauseTask(id);
    await poller.current?.refreshNow();
    message.success('同步已暂停');
  };

  const resume = async (id: string) => {
    await api.resumeTask(id);
    await poller.current?.refreshNow();
    message.success('同步已恢复');
  };

  const stop = async (id: string) => {
    await api.stopTask(id);
    await poller.current?.refreshNow();
    message.success('本次同步将停止');
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '本地目录', dataIndex: 'localPath' },
    { title: '目标数', render: (_: any, t: TaskWithTargets) => t.targets.length },
    { title: '调度', dataIndex: 'schedule', render: (s: string | null) => s ?? '手动' },
    {
      title: '上次同步完成', dataIndex: 'lastCompletedAt',
      render: (time: number | null) => time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '—'
    },
    {
      title: '状态', dataIndex: 'lastStatus',
      render: (s: string | null) => {
        if (s === 'running') return <Tag icon={<SyncOutlined spin />} color="processing">同步中</Tag>;
        if (s === 'paused') return <Tag color="gold">已暂停</Tag>;
        if (s === 'stopped') return <Tag color="orange">已停止</Tag>;
        if (s === 'success') return <Tag color="green">成功</Tag>;
        if (s === 'failed') return <Tag color="red">失败</Tag>;
        return <Tag>未运行</Tag>;
      }
    },
    {
      title: '操作',
      render: (_: any, t: TaskWithTargets) => (
        <Space>
          <Switch checked={t.enabled} onChange={(v) => toggle(t, v)} />
          {t.lastStatus === 'running' ? <>
            <Tooltip title="暂停同步"><Button icon={<PauseCircleOutlined />} onClick={() => pause(t.id)} /></Tooltip>
            <Tooltip title="停止本次同步"><Button danger icon={<StopOutlined />} onClick={() => stop(t.id)} /></Tooltip>
          </> : t.lastStatus === 'paused' ? <>
            <Tooltip title="恢复同步"><Button type="primary" icon={<PlayCircleOutlined />} onClick={() => resume(t.id)} /></Tooltip>
            <Tooltip title="停止本次同步"><Button danger icon={<StopOutlined />} onClick={() => stop(t.id)} /></Tooltip>
          </> : <Tooltip title="立即同步"><Button icon={<PlayCircleOutlined />} onClick={() => run(t.id)} /></Tooltip>}
          <Tooltip title="详情"><Button icon={<EyeOutlined />} onClick={() => setDetail(t)} /></Tooltip>
          <Tooltip title="编辑"><Button icon={<EditOutlined />} onClick={() => { setEditing(t); setOpen(true); }} /></Tooltip>
          <Popconfirm title="删除该任务？" onConfirm={async () => { await api.deleteTask(t.id); load(); }}>
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card title="同步任务" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setOpen(true); }}>新建任务</Button>}>
      <Table rowKey="id" dataSource={tasks} columns={columns} pagination={false} />
      <TaskFormModal open={open} accounts={accounts} task={editing}
        onClose={() => setOpen(false)}
        onDone={() => { setOpen(false); setEditing(null); load(); }} />
      <TaskDetailDrawer task={detail} onClose={() => setDetail(null)} />
    </Card>
  );
}
