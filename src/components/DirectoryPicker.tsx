import { useEffect, useState } from 'react';
import { Button, List, Modal, Space, Typography } from 'antd';
import { FolderOutlined, UpOutlined } from '@ant-design/icons';
import { api } from '../api';

export default function DirectoryPicker({ open, initialPath, onClose, onSelect }: { open: boolean; initialPath?: string; onClose: () => void; onSelect: (path: string) => void }) {
  const [listing, setListing] = useState<{ path: string | null; parent: string | null; roots?: string[]; directories: { name: string; path: string }[] }>({ path: null, parent: null, directories: [] });
  const load = (path?: string) => api.listDirectories(path).then(setListing);
  useEffect(() => { if (open) load(initialPath); }, [open, initialPath]);
  return <Modal open={open} title="选择本地目录" onCancel={onClose} footer={listing.path ? <Space><Button onClick={() => listing.parent ? load(listing.parent) : load() } disabled={!listing.parent}><UpOutlined />上一级</Button><Button type="primary" onClick={() => { onSelect(listing.path!); onClose(); }}>选择当前目录</Button></Space> : null}>
    {listing.roots?.map(root => <Button key={root} block style={{ marginBottom: 8 }} icon={<FolderOutlined />} onClick={() => load(root)}>{root}</Button>)}
    {listing.path && <Typography.Text type="secondary">{listing.path}</Typography.Text>}
    <List size="small" dataSource={listing.directories} renderItem={item => <List.Item><Button type="text" icon={<FolderOutlined />} onClick={() => load(item.path)}>{item.name}</Button></List.Item>} />
  </Modal>;
}
