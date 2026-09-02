import { useEffect } from 'react';
import { Button, Card, Form, Input, Switch, message } from 'antd';
import { api } from '../api';

export default function SettingsPage() {
  const [form] = Form.useForm();
  useEffect(() => { api.getNotificationSettings().then(values => form.setFieldsValue(values)); }, [form]);
  return <Card title="通知设置" style={{ maxWidth: 680 }}>
    <Form form={form} layout="vertical" onFinish={async values => { await api.saveNotificationSettings(values); message.success('通知设置已保存'); }}>
      <h3>Telegram</h3>
      <Form.Item name="telegramEnabled" label="启用 Telegram 通知" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="telegramBotToken" label="Bot Token"><Input.Password placeholder="留空以保留已保存的 Token" /></Form.Item>
      <Form.Item name="telegramChatId" label="Chat ID"><Input.Password placeholder="留空以保留已保存的 Chat ID" /></Form.Item>
      <h3>Bark</h3>
      <Form.Item name="barkEnabled" label="启用 Bark 通知" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="barkServerUrl" label="Bark 服务器地址"><Input placeholder="https://api.day.app" /></Form.Item>
      <Form.Item name="barkDeviceKey" label="Device Key"><Input.Password placeholder="留空以保留已保存的 Key" /></Form.Item>
      <Button type="primary" htmlType="submit">保存</Button>
    </Form>
  </Card>;
}
