import { useEffect, useState } from 'react';
import { Card, Button, Table, Space, Popconfirm, message } from 'antd';
import { GoogleOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import QuarkLoginModal from '../components/QuarkLoginModal';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [quarkOpen, setQuarkOpen] = useState(false);

  const load = () => api.listAccounts().then(setAccounts);

  useEffect(() => { load(); }, []);

  const addGoogle = async () => {
    try {
      const { url } = await api.googleAuthUrl();
      window.location.href = url;
    } catch (e: any) {
      message.error(e.message || 'Google OAuth 未配置');
    }
  };

  const columns = [
    { title: '类型', dataIndex: 'provider', render: (p: string) => p === 'google' ? 'Google Drive' : '夸克网盘' },
    { title: '名称', dataIndex: 'displayName' },
    {
      title: '操作',
      render: (_: any, a: any) => (
        <Popconfirm title="删除该账号？" onConfirm={async () => { await api.deleteAccount(a.id); load(); }}>
          <Button danger>删除</Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Card title="网盘账号" extra={
      <Space>
        <Button icon={<GoogleOutlined />} onClick={addGoogle}>添加 Google</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setQuarkOpen(true)}>添加夸克</Button>
      </Space>
    }>
      <Table rowKey="id" dataSource={accounts} columns={columns} pagination={false} />
      <QuarkLoginModal open={quarkOpen} onClose={() => setQuarkOpen(false)} onDone={() => { setQuarkOpen(false); load(); }} />
    </Card>
  );
}
