import { Routes, Route, Link } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { CloudUploadOutlined, UserOutlined, FileTextOutlined } from '@ant-design/icons';
import TasksPage from './pages/TasksPage';
import AccountsPage from './pages/AccountsPage';
import LogsPage from './pages/LogsPage';

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider>
        <div style={{ color: '#fff', padding: 16, fontSize: 18, fontWeight: 600 }}>云盘同步备份</div>
        <Menu theme="dark" mode="inline" defaultSelectedKeys={['tasks']}>
          <Menu.Item key="tasks" icon={<CloudUploadOutlined />}>
            <Link to="/">同步任务</Link>
          </Menu.Item>
          <Menu.Item key="accounts" icon={<UserOutlined />}>
            <Link to="/accounts">网盘账号</Link>
          </Menu.Item>
          <Menu.Item key="logs" icon={<FileTextOutlined />}>
            <Link to="/logs">日志</Link>
          </Menu.Item>
        </Menu>
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<TasksPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </Layout.Content>
    </Layout>
  );
}
