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
  const runWindowEnabled = Form.useWatch('runWindowEnabled', form);

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.setFieldsValue({
        name: task.name,
        localPath: task.localPath,
        scheduleMode: scheduleModeFrom(task.schedule),
        dailyTime: dailyTimeFrom(task.schedule),
        weekday: weeklyDayFrom(task.schedule),
        monthDay: monthDayFrom(task.schedule),
        enabled: task.enabled,
        runWindowEnabled: task.runWindowEnabled,
        runWindow: task.runWindowStart && task.runWindowEnd ? [dayjs(task.runWindowStart, 'HH:mm'), dayjs(task.runWindowEnd, 'HH:mm')] : undefined,
        targets: task.targets.map(t => ({ accountId: t.accountId, remotePath: t.remotePath }))
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: true, targets: [], scheduleMode: 'manual', dailyTime: dayjs().hour(2).minute(0).second(0), weekday: '1', monthDay: '1', runWindowEnabled: false });
    }
  }, [open, task, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const input: TaskInput = {
      name: v.name,
      localPath: v.localPath,
      schedule: scheduleFrom(v.scheduleMode, v.dailyTime, v.weekday, v.monthDay),
      enabled: v.enabled ?? true,
      runWindowEnabled: !!v.runWindowEnabled,
      runWindowStart: v.runWindowEnabled ? v.runWindow?.[0]?.format('HH:mm') ?? null : null,
      runWindowEnd: v.runWindowEnabled ? v.runWindow?.[1]?.format('HH:mm') ?? null : null,
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
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周' },
            { value: 'monthly', label: '每月' }
          ]} />
        </Form.Item>
        {scheduleMode !== 'manual' && <Form.Item name="dailyTime" label="执行时间"><TimePicker format="HH:mm" minuteStep={5} /></Form.Item>}
        {scheduleMode === 'weekly' && <Form.Item name="weekday" label="每周执行日"><Select options={['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => ({ label, value: String(index + 1) }))} /></Form.Item>}
        {scheduleMode === 'monthly' && <Form.Item name="monthDay" label="每月执行日"><Select options={Array.from({ length: 31 }, (_, index) => ({ label: `${index + 1} 日`, value: String(index + 1) }))} /></Form.Item>}
        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>
        <Form.Item name="runWindowEnabled" label="启用任务运行时间" valuePropName="checked" initialValue={false}>
          <Switch />
        </Form.Item>
        {runWindowEnabled && <Form.Item name="runWindow" label="允许运行时间" rules={[{ required: true, message: '请选择开始和结束时间' }, { validator: async (_, value) => {
          if (value?.[0]?.format('HH:mm') === value?.[1]?.format('HH:mm')) throw new Error('开始和结束时间不能相同');
        }}]}>
          <TimePicker.RangePicker format="HH:mm" minuteStep={5} />
        </Form.Item>}

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
  if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 'daily';
  if (/^\d+ \d+ \* \* \d+$/.test(schedule)) return 'weekly';
  if (/^\d+ \d+ \d+ \* \*$/.test(schedule)) return 'monthly';
  return 'manual';
}

function dailyTimeFrom(schedule: string | null) {
  const match = schedule?.match(/^(\d+) (\d+) \* \* \*$/);
  return dayjs().hour(Number(match?.[2] ?? 2)).minute(Number(match?.[1] ?? 0)).second(0);
}

function weeklyDayFrom(schedule: string | null): string {
  return schedule?.match(/^\d+ \d+ \* \* (\d+)$/)?.[1] ?? '1';
}

function monthDayFrom(schedule: string | null): string {
  return schedule?.match(/^\d+ \d+ (\d+) \* \*$/)?.[1] ?? '1';
}

function scheduleFrom(mode: string, time?: ReturnType<typeof dayjs>, weekday?: string, monthDay?: string): string | null {
  if (mode === 'daily') return `${time?.minute() ?? 0} ${time?.hour() ?? 2} * * *`;
  if (mode === 'weekly') return `${time?.minute() ?? 0} ${time?.hour() ?? 2} * * ${weekday ?? 1}`;
  if (mode === 'monthly') return `${time?.minute() ?? 0} ${time?.hour() ?? 2} ${monthDay ?? 1} * *`;
  return mode === 'manual' ? null : mode;
}
