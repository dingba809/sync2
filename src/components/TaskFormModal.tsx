import { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Switch, Button, Space, Divider, TimePicker } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, TaskInput } from '../api';
import type { TaskWithTargets } from '../../shared/types.js';
import DirectoryPicker from './DirectoryPicker';

export default function TaskFormModal({ open, accounts, task, onClose, onDone }: {
  open: boolean;
  accounts: any[];
  task: TaskWithTargets | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const localPath = Form.useWatch('localPath', form);
  const scheduleMode = Form.useWatch('scheduleMode', form);

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.setFieldsValue({
        name: task.name,
        localPath: task.localPath,
        scheduleMode: scheduleModeFrom(task.schedule),
        dailyTime: dailyTimeFrom(task.schedule),
        enabled: task.enabled,
        targets: task.targets.map(t => ({ accountId: t.accountId, remotePath: t.remotePath }))
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: true, targets: [], scheduleMode: 'manual', dailyTime: dayjs().hour(2).minute(0).second(0) });
    }
  }, [open, task, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const input: TaskInput = {
      name: v.name,
      localPath: v.localPath,
      schedule: scheduleFrom(v.scheduleMode, v.dailyTime),
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
        <Form.Item label="本地目录（绝对路径 / 容器内路径）" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="localPath" noStyle rules={[{ required: true }]}><Input readOnly placeholder="请选择目录" /></Form.Item>
            <Button onClick={() => setPickerOpen(true)}>选择目录</Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="scheduleMode" label="同步频率" initialValue="manual">
          <Select options={[
            { value: 'manual', label: '手动同步' },
            { value: '15', label: '每 15 分钟' },
            { value: '30', label: '每 30 分钟' },
            { value: '60', label: '每小时' },
            { value: 'daily', label: '每天' }
          ]} />
        </Form.Item>
        {scheduleMode === 'daily' && <Form.Item name="dailyTime" label="每天执行时间"><TimePicker format="HH:mm" minuteStep={5} /></Form.Item>}
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
      <DirectoryPicker open={pickerOpen} initialPath={localPath} onClose={() => setPickerOpen(false)} onSelect={path => form.setFieldValue('localPath', path)} />
    </Modal>
  );
}

function scheduleModeFrom(schedule: string | null): string {
  if (!schedule) return 'manual';
  if (/^\d+$/.test(schedule) && ['15', '30', '60'].includes(schedule)) return schedule;
  if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 'daily';
  return 'manual';
}

function dailyTimeFrom(schedule: string | null) {
  const match = schedule?.match(/^(\d+) (\d+) \* \* \*$/);
  return dayjs().hour(Number(match?.[2] ?? 2)).minute(Number(match?.[1] ?? 0)).second(0);
}

function scheduleFrom(mode: string, time?: ReturnType<typeof dayjs>): string | null {
  if (mode === 'daily') return `${time?.minute() ?? 0} ${time?.hour() ?? 2} * * *`;
  return mode === 'manual' ? null : mode;
}
