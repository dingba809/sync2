import { useEffect, useState } from 'react';
import { Modal, Spin, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';

export default function QuarkLoginModal({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [url, setUrl] = useState<string>('');
  const [tip, setTip] = useState('请使用夸克 App 扫码');

  useEffect(() => {
    if (!open) return;
    let stop = false;
    (async () => {
      const r = await api.quarkStart();
      setUrl(r.url);
      const timer = setInterval(async () => {
        const s = await api.quarkPoll(r.token);
        if (s.state === 'success') { clearInterval(timer); onDone(); }
        else if (s.state === 'scanned') setTip('已扫码，请在手机上确认');
      }, 1500);
      if (stop) clearInterval(timer);
    })();
    return () => { stop = true; };
  }, [open]);

  return (
    <Modal open={open} title="扫码登录夸克网盘" footer={null} onCancel={onClose}>
      <div style={{ textAlign: 'center', padding: 16 }}>
        {url ? <QRCodeSVG value={url} size={220} /> : <Spin />}
        <Typography.Paragraph style={{ marginTop: 12 }}>{tip}</Typography.Paragraph>
      </div>
    </Modal>
  );
}
