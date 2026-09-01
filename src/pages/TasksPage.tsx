import { useEffect, useState } from 'react';
import { Card, Button, Switch, Space, Table, Tag, message, Popconfirm } from 'antd';
import { PlusOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { api } from '../api';
import TaskFormModal from '../components/TaskFormModal';
import type { TaskRecord } from '../../shared/types.js';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setTasks(await api.listTasks());
    setAccounts(await api.listAccounts());
  };

  useEffect(() => { load(); }, []);

  const toggle = async (t: TaskRecord, enabled: boolean) => {
    await api.updateTask(t.id, { enabled });
    load();
  };

  const run = async (id: string) => {
    await api.runTask(id);
    message.success('已触发同步');
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '本地目录', dataIndex: 'localPath' },
    { title: '远程目录', dataIndex: 'remotePath' },
    { title: '调度', dataIndex: 'schedule', render: (s: string | null) => s ?? '手动' },
    {
      title: '状态', dataIndex: 'lastStatus',
      render: (s: string | null) => s ? <Tag color={s === 'success' ? 'green' : 'red'}>{s}</Tag> : <Tag>未运行</Tag>
    },
    {
      title: '操作',
      render: (_: any, t: TaskRecord) => (
        <Space>
          <Switch checked={t.enabled} onChange={(v) => toggle(t, v)} />
          <Button icon={<PlayCircleOutlined />} onClick={() => run(t.id)}>同步</Button>
          <Popconfirm title="删除该任务？" onConfirm={async () => { await api.deleteTask(t.id); load(); }}>
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card title="同步任务" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>}>
      <Table rowKey="id" dataSource={tasks} columns={columns} pagination={false} />
      <TaskFormModal open={open} accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />
    </Card>
  );
}
