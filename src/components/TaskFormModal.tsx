import { useEffect } from 'react';
import { Modal, Form, Input, Select, Switch, Button, Space, Divider } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { api, TaskInput } from '../api';
import type { TaskWithTargets } from '../../shared/types.js';

export default function TaskFormModal({ open, accounts, task, onClose, onDone }: {
  open: boolean;
  accounts: any[];
  task: TaskWithTargets | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.setFieldsValue({
        name: task.name,
        localPath: task.localPath,
        schedule: task.schedule,
        enabled: task.enabled,
        targets: task.targets.map(t => ({ accountId: t.accountId, remotePath: t.remotePath }))
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: true, targets: [] });
    }
  }, [open, task, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const input: TaskInput = {
      name: v.name,
      localPath: v.localPath,
      schedule: v.schedule ?? null,
      enabled: v.enabled ?? true,
      targets: (v.targets ?? []).map((t: any) => ({ accountId: t.accountId, remotePath: t.remotePath }))
    };
    if (task) await api.updateTask(task.id, input);
    else await api.createTask(input);
    onDone();
  };

  return (
    <Modal open={open} title={task ? '编辑同步任务' : '新建同步任务'} onOk={submit} onCancel={onClose} okText="保存" width={640}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
          <Input placeholder="例如：文档备份" />
        </Form.Item>
        <Form.Item name="localPath" label="本地目录（绝对路径 / 容器内路径）" rules={[{ required: true }]}>
          <Input placeholder="/path/to/local" />
        </Form.Item>
        <Form.Item name="schedule" label="调度（cron 表达式，留空为手动）">
          <Input placeholder="0 2 * * *" />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>

        <Divider>备份目标</Divider>
        <Form.List name="targets" rules={[{ validator: async (_, targets) => { if (!targets || targets.length < 1) throw new Error('至少添加一个备份目标'); } }]}>
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map(({ key, name }) => (
                <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item name={[name, 'accountId']} rules={[{ required: true, message: '选择账号' }]} style={{ marginBottom: 0 }}>
                    <Select placeholder="网盘账号" style={{ width: 220 }}
                      options={accounts.map(a => ({ value: a.id, label: `${a.provider} - ${a.displayName}` }))} />
                  </Form.Item>
                  <Form.Item name={[name, 'remotePath']} rules={[{ required: true, message: '填写远程目录' }]} style={{ marginBottom: 0 }}>
                    <Input placeholder="/backup/docs" style={{ width: 260 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} />
                </Space>
              ))}
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>添加目标</Button>
                <Form.ErrorList errors={errors} />
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
