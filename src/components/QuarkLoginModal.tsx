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
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const r = await api.quarkStart();
      if (cancelled) return;
      setUrl(r.url);
      setTip('请使用夸克 App 扫码');
      timer = setInterval(async () => {
        const s = await api.quarkPoll(r.token);
        if (s.state === 'success') {
          if (timer) clearInterval(timer);
          onDone();
        } else if (s.state === 'scanned') {
          setTip('已扫码，请在手机上确认');
        } else if (s.state === 'expired') {
          if (timer) clearInterval(timer);
          setTip('二维码已过期，请关闭后重试');
        }
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
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
