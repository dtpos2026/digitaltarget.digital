import { useEffect, useMemo, useRef, useState, createElement } from 'react';
import { useLocation } from '@/lib/hash-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, RotateCw, Trash2, Send, Copy, Wifi, WifiOff, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { isElectron } from '@/lib/electron';
import {
  getPendingQueue, removeFromPendingQueue, addToPendingQueue,
  type PendingWhatsApp, normalizePhone,
} from '@/lib/whatsapp';
import { cn } from '@/lib/utils';

/**
 * Persistent WhatsApp module. Mounted once in AppLayout — never unmounts.
 * Shown only when pathname === '/whatsapp'. Webview keeps its session alive
 * across navigation, so switching modules or sending from POS/Delivery/Marketing
 * does NOT reload WhatsApp Web.
 */
export default function PersistentWhatsApp() {
  const { pathname, search, hash } = useLocation();
  const visible = pathname === '/whatsapp';

  const params = useMemo(
    () => new URLSearchParams(search || hash.split('?')[1] || ''),
    [search, hash]
  );
  const urlPhone = params.get('phone') || '';
  const urlMessage = params.get('message') || '';

  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queue, setQueue] = useState<PendingWhatsApp[]>(() => getPendingQueue());
  const [webviewAlive, setWebviewAlive] = useState(true);
  const webviewRef = useRef<any>(null);
  const loadedOnceRef = useRef(false);
  const currentPhoneRef = useRef<string>(''); // phone currently loaded inside webview
  const lastMessageRef = useRef('');
  const navInFlightRef = useRef<string | null>(null);

  const normalize = (p: string) => normalizePhone(p) || p.replace(/[^\d]/g, '');

  const buildUrl = (p: string, m: string) => {
    const norm = normalize(p);
    if (!norm) return 'https://web.whatsapp.com/';
    const text = encodeURIComponent(m || '');
    return `https://web.whatsapp.com/send?phone=${norm}&text=${text}&type=phone_number&app_absent=0`;
  };

  const copyToClipboard = async (txt: string) => {
    try { await navigator.clipboard.writeText(txt); } catch {}
  };

  const injectMessageIntoChat = async (txt: string) => {
    const wv: any = webviewRef.current;
    if (!wv || typeof wv.executeJavaScript !== 'function') return false;

    const payload = JSON.stringify(txt);
    try {
      return await wv.executeJavaScript(`
        (() => {
          const text = ${payload};
          const selectors = [
            'div[contenteditable="true"][data-tab="10"]',
            'div[contenteditable="true"][role="textbox"]',
            'footer div[contenteditable="true"]'
          ];
          const input = selectors.map(s => document.querySelector(s)).find(Boolean);
          if (!input) return false;
          input.focus();
          const insert = (value) => {
            const event = new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value });
            input.textContent = value;
            input.dispatchEvent(event);
          };
          insert(text);
          return true;
        })();
      `, true);
    } catch {
      return false;
    }
  };

  // Navigate webview to a chat. If same phone is already loaded -> DO NOT reload,
  // just copy the message to clipboard so user can paste (Ctrl+V) in the open chat.
  const goToChat = async (p: string, m: string) => {
    const norm = normalize(p);
    if (!norm) return;
    const wv: any = webviewRef.current;
    if (!wv) return;

    if (currentPhoneRef.current === norm && loadedOnceRef.current) {
      const injected = m !== lastMessageRef.current ? await injectMessageIntoChat(m) : false;
      lastMessageRef.current = m;
      if (!injected) await copyToClipboard(m);
      toast.success(injected ? 'Message ready in chat.' : 'Message copied — paste (Ctrl+V) in chat & press Enter');
      return;
    }

    if (navInFlightRef.current === norm) {
      lastMessageRef.current = m;
      await copyToClipboard(m);
      toast.success('Chat is loading — the message has been copied to your clipboard.');
      return;
    }

    // Different customer (or first load) — keep session, navigate once without forcing full remount.
    await copyToClipboard(m);
    currentPhoneRef.current = norm;
    lastMessageRef.current = m;
    navInFlightRef.current = norm;
    const target = buildUrl(p, m);
    if (typeof wv.loadURL === 'function') {
      try { wv.loadURL(target); } catch {}
    } else {
      wv.src = target;
    }
    toast.success('Opening chat… the message has also been copied to your clipboard.');
  };

  // When URL params change AND we're on /whatsapp -> open chat without unnecessary reload.
  useEffect(() => {
    if (!visible) return;
    if (!urlPhone && !urlMessage) return;
    setPhone(urlPhone);
    setMessage(urlMessage);
    goToChat(urlPhone, urlMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, urlPhone, urlMessage]);

  // Online / queue listeners
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const qu = () => setQueue(getPendingQueue());
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('whatsapp-queue-updated', qu);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('whatsapp-queue-updated', qu);
    };
  }, []);

  // Webview dom-ready -> mark loaded
  useEffect(() => {
    const wv: any = webviewRef.current;
    if (!wv) return;
    const onReady = () => {
      loadedOnceRef.current = true;
      setWebviewAlive(true);
      navInFlightRef.current = null;
    };
    const onGone = () => {
      setWebviewAlive(false);
      loadedOnceRef.current = false;
      toast.error('WhatsApp webview بند ہو گیا تھا — دوبارہ load کیا جا رہا ہے');
      setTimeout(() => {
        try {
          if (typeof wv.loadURL === 'function') wv.loadURL(currentPhoneRef.current ? buildUrl(currentPhoneRef.current, message) : 'https://web.whatsapp.com/');
          else wv.src = currentPhoneRef.current ? buildUrl(currentPhoneRef.current, message) : 'https://web.whatsapp.com/';
        } catch {}
      }, 250);
    };
    wv.addEventListener?.('dom-ready', onReady);
    wv.addEventListener?.('render-process-gone', onGone);
    wv.addEventListener?.('destroyed', onGone);
    return () => {
      wv.removeEventListener?.('dom-ready', onReady);
      wv.removeEventListener?.('render-process-gone', onGone);
      wv.removeEventListener?.('destroyed', onGone);
    };
  }, [message]);

  const handleSend = () => {
    if (!phone.trim()) { toast.error('Customer number not available'); return; }
    if (!online) {
      addToPendingQueue(phone, message);
      toast.info('Offline — message saved to queue.');
      return;
    }
    goToChat(phone, message);
  };

  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(message); toast.success('Message copied'); }
    catch { toast.error('Copy failed'); }
  };

  const retryQueued = (item: PendingWhatsApp) => {
    setPhone(item.phone);
    setMessage(item.message);
    if (online) goToChat(item.phone, item.message);
  };

  const clearAll = () => {
    localStorage.setItem('pos-whatsapp-queue', '[]');
    window.dispatchEvent(new CustomEvent('whatsapp-queue-updated'));
  };

  const reload = () => {
    const wv: any = webviewRef.current;
    if (wv?.reload) { try { wv.reload(); } catch {} }
  };

  // Only render persistent webview in Electron. In browser, WhatsAppPage handles fallback.
  if (!isElectron()) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-30 flex flex-col lg:flex-row bg-background',
        visible ? '' : 'hidden'
      )}
    >
      {/* Left controls */}
      <div className="lg:w-[340px] border-r border-border bg-card/40 p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-[#25D366]" />
          <h2 className="text-base font-bold">WhatsApp</h2>
          <Badge variant={online ? 'default' : 'destructive'} className="ml-auto gap-1">
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? 'Online' : 'Offline'}
          </Badge>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Customer Number</label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Message (auto-filled)</label>
          <Textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSend} className="flex-1 bg-[#25D366] hover:bg-[#1ebe57] text-white">
            <Send className="h-4 w-4 mr-1" /> Send
          </Button>
          <Button variant="outline" onClick={copyMessage} title="Copy"><Copy className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={reload} title="Reload"><RotateCw className="h-4 w-4" /></Button>
        </div>

        <div className="text-[11px] text-muted-foreground leading-snug border-t pt-3">
          <p className="flex items-center gap-1"><QrCode className="h-3 w-3" /> Scan the QR the first time. The session is then saved.</p>
          <p className="mt-1">Switching modules does not reload WhatsApp — the session stays live.</p>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wide">Pending ({queue.length})</h3>
            {queue.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearAll} className="h-6 text-[10px]">Clear all</Button>
            )}
          </div>
          {queue.length === 0 && <p className="text-[11px] text-muted-foreground">No pending messages.</p>}
          <div className="space-y-2">
            {queue.map(item => (
              <Card key={item.id} className="p-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{item.customerName || item.phone}</span>
                  <span className="text-muted-foreground text-[10px]">{new Date(item.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="text-muted-foreground line-clamp-2 whitespace-pre-line">{item.message}</p>
                <div className="flex gap-1 pt-1">
                  <Button size="sm" className="h-6 text-[10px] flex-1 bg-[#25D366] hover:bg-[#1ebe57] text-white"
                    onClick={() => { retryQueued(item); removeFromPendingQueue(item.id); }}>
                    <Send className="h-3 w-3 mr-1" /> Send now
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]"
                    onClick={() => removeFromPendingQueue(item.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Persistent webview — mounted once, never unmounts */}
      <div className="flex-1 bg-background relative">
        {!online && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur">
            <div className="text-center space-y-2 max-w-sm p-6">
              <WifiOff className="h-10 w-10 mx-auto text-destructive" />
              <h3 className="font-bold">Internet not available</h3>
              <p className="text-sm text-muted-foreground">
                Messages are queueing. When you are back online, press "Send now" .
              </p>
            </div>
          </div>
        )}
        {!webviewAlive && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/90 backdrop-blur-sm">
            <div className="text-center space-y-2">
              <RotateCw className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">WhatsApp reconnect ho رہا ہے…</p>
            </div>
          </div>
        )}
        {createElement('webview', {
          ref: webviewRef,
          src: 'https://web.whatsapp.com/',
          partition: 'persist:whatsapp',
          allowpopups: 'true',
          useragent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          style: { width: '100%', height: '100%', display: 'inline-flex' },
        })}
      </div>
    </div>
  );
}
