import { useEffect } from 'react';
import { Button, Card, Form, Input, InputNumber, Switch, message } from 'antd';
import { api } from '../api';

export default function SettingsPage() {
  const [form] = Form.useForm();
  useEffect(() => {
    Promise.all([api.getNotificationSettings(), api.getSyncSettings()])
      .then(([notifications, sync]) => form.setFieldsValue({ ...notifications, ...sync }));
  }, [form]);
  return <Card title="设置" style={{ maxWidth: 680 }}>
    <Form form={form} layout="vertical" onFinish={async values => {
      await Promise.all([
        api.saveNotificationSettings(values),
        api.saveSyncSettings({ quarkUploadConcurrency: values.quarkUploadConcurrency })
      ]);
      message.success('设置已保存');
    }}>
      <h3>同步性能</h3>
      <Form.Item name="quarkUploadConcurrency" label="夸克上传并发数" extra="每个同步任务独立生效；小文件较多时可提高速度，过高可能触发网盘限流。">
        <InputNumber min={1} max={6} precision={0} style={{ width: 160 }} />
      </Form.Item>
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
