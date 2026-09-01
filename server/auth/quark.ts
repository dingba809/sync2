import { randomUUID } from 'node:crypto';

const CAS = 'https://uop.quark.cn/cas/ajax';
const ACCOUNT = 'https://pan.quark.cn/account/info';

export async function getQrcodeToken(): Promise<{ token: string; url: string }> {
  const params = new URLSearchParams({
    client_id: '532', v: '1.2', request_id: randomUUID()
  });
  const res = await fetch(`${CAS}/getTokenForQrcodeLogin?${params}`);
  if (!res.ok) throw new Error(`Quark qrcode token failed: ${res.status}`);
  const data = await res.json() as any;
  if (data.status !== 2000000) throw new Error(`Quark qrcode status ${data.status}`);
  const token = data.data.members.token;
  const qrParams = new URLSearchParams({
    token,
    client_id: '532',
    ssb: 'weblogin',
    uc_param_str: '',
    uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0'
  });
  return { token, url: `https://su.quark.cn/4_eMHBJ?${qrParams}` };
}

export interface QrcodeStatus {
  state: 'pending' | 'scanned' | 'expired' | 'success';
  serviceTicket?: string;
}

export async function pollQrcode(token: string): Promise<QrcodeStatus> {
  const params = new URLSearchParams({
    client_id: '532', v: '1.2', token, request_id: randomUUID()
  });
  const res = await fetch(`${CAS}/getServiceTicketByQrcodeToken?${params}`);
  if (!res.ok) throw new Error(`Quark qrcode poll failed: ${res.status}`);
  const data = await res.json() as any;
  if (data.status === 2000000 && data.data.members.service_ticket) {
    return { state: 'success', serviceTicket: data.data.members.service_ticket };
  }
  if (data.status === 50004001) return { state: 'pending' };
  if (data.status === 50004002 || data.status === 50004003 || data.status === 50004004) {
    return { state: 'expired' };
  }
  return { state: 'scanned' };
}

export async function getCookiesFromServiceTicket(serviceTicket: string): Promise<{
  cookies: Record<string, string>; nickname: string;
}> {
  const params = new URLSearchParams({ st: serviceTicket, lw: 'scan' });
  const res = await fetch(`${ACCOUNT}?${params}`, { redirect: 'manual' });
  const cookies: Record<string, string> = {};
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) cookies[m[1]] = m[2];
  }
  const body = await res.json().catch(() => ({})) as any;
  return { cookies, nickname: body?.data?.nickname ?? '' };
}
