import { Modal, Form, Input, Select, Switch } from 'antd';
import { api } from '../api';

export default function TaskFormModal({ open, accounts, onClose, onDone }: {
  open: boolean; accounts: any[]; onClose: () => void; onDone: () => void;
}) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    await api.createTask({ ...v, enabled: v.enabled ?? true });
    form.resetFields();
    onDone();
  };

  return (
    <Modal open={open} title="新建同步任务" onOk={submit} onCancel={onClose} okText="创建">
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
          <Input placeholder="例如：文档备份" />
        </Form.Item>
        <Form.Item name="accountId" label="网盘账号" rules={[{ required: true }]}>
          <Select options={accounts.map(a => ({ value: a.id, label: `${a.provider} - ${a.displayName}` }))} />
        </Form.Item>
        <Form.Item name="localPath" label="本地目录（绝对路径 / 容器内路径）" rules={[{ required: true }]}>
          <Input placeholder="/path/to/local" />
        </Form.Item>
        <Form.Item name="remotePath" label="远程目录" rules={[{ required: true }]}>
          <Input placeholder="/backup/docs" />
        </Form.Item>
        <Form.Item name="schedule" label="调度（cron 表达式，留空为手动）">
          <Input placeholder="0 2 * * *" />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
