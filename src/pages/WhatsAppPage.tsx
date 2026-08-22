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

function useQuery() {
  const { search, hash } = useLocation();
  // HashRouter puts query AFTER the hash route, so useLocation's search is reliable
  return useMemo(() => new URLSearchParams(search || hash.split('?')[1] || ''), [search, hash]);
}

export default function WhatsAppPage() {
  const q = useQuery();
  const initialPhone = q.get('phone') || '';
  const initialMsg = q.get('message') || '';

  const [phone, setPhone] = useState(initialPhone);
  const [message, setMessage] = useState(initialMsg);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queue, setQueue] = useState<PendingWhatsApp[]>(() => getPendingQueue());
  const [webviewKey, setWebviewKey] = useState(0);
  const webviewRef = useRef<any>(null);

  // Build embedded WhatsApp Web URL
  const waUrl = useMemo(() => {
    const norm = normalizePhone(phone) || phone.replace(/[^\d]/g, '');
    if (!norm) return 'https://web.whatsapp.com/';
    const text = encodeURIComponent(message || '');
    return `https://web.whatsapp.com/send?phone=${norm}&text=${text}&type=phone_number&app_absent=0`;
  }, [phone, message]);

  // Track online/offline + queue updates
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

  // When phone/message change via URL, reflect in form
  useEffect(() => {
    if (initialPhone) setPhone(initialPhone);
    if (initialMsg) setMessage(initialMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhone, initialMsg]);

  const handleSend = () => {
    if (!phone.trim()) { toast.error('Customer number not available'); return; }
    if (!online) {
      addToPendingQueue(phone, message);
      toast.info('Offline — message saved to queue.');
      return;
    }
    // Force reload embedded viewer with latest phone/message
    setWebviewKey(k => k + 1);
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Message copied');
    } catch { toast.error('Copy failed'); }
  };

  const retryQueued = (item: PendingWhatsApp) => {
    setPhone(item.phone);
    setMessage(item.message);
    setWebviewKey(k => k + 1);
    if (online) toast.success('Loaded — press Send');
  };

  const clearAll = () => {
    localStorage.setItem('pos-whatsapp-queue', '[]');
    window.dispatchEvent(new CustomEvent('whatsapp-queue-updated'));
  };

  // Bulk auto-send: opens WhatsApp Web popup sequentially (1.8s gap) for every
  // pending message. User just presses the send button on each popup — no manual
  // typing, no copy/paste. Works in both web (popup) and Electron (webview).
  const sendAllPending = async () => {
    const list = getPendingQueue();
    if (!list.length) { toast.info('The queue is empty'); return; }
    if (!confirm(`${list.length} messages will be sent. You only need to press Send on each popup. Continue?`)) return;
    toast.info(`Bulk send started: ${list.length} messages`);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const norm = normalizePhone(item.phone) || item.phone.replace(/[^\d]/g, '');
      const text = encodeURIComponent(item.message || '');
      const url = `https://web.whatsapp.com/send?phone=${norm}&text=${text}&type=phone_number&app_absent=0`;
      if (isElectron()) {
        // Electron: load in embedded webview
        setPhone(item.phone); setMessage(item.message); setWebviewKey(k => k + 1);
      } else {
        const w = 900, h = 700;
        const left = Math.max(0, (window.screen.width - w) / 2);
        const top = Math.max(0, (window.screen.height - h) / 2);
        window.open(url, 'whatsapp_popup', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
      }
      removeFromPendingQueue(item.id);
      // gap between opens — give WhatsApp Web time to load + user to press Send
      await new Promise(r => setTimeout(r, 1800));
    }
    toast.success('Bulk send complete');
  };

  // Electron: persistent overlay (mounted in AppLayout) handles everything.
  if (isElectron()) return null;

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col lg:flex-row">
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
          <label className="text-xs font-semibold text-muted-foreground">Quick Templates</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const name = phone ? '' : 'Customer';
              const tpl: Record<string, string> = {
                received: `Hello${name ? ' ' + name : ''}! We have received your order #{orderNo}. Thank you!`,
                accepted: `Your order #{orderNo} has been accepted. Estimated time: {eta} min.`,
                preparing: `Your order #{orderNo} is being prepared. It will be ready shortly.`,
                ready: `Your order #{orderNo} is ready for pickup. You can come and collect it. Thank you!`,
                dispatched: `Your order #{orderNo} has been dispatched. Rider ETA: {eta} min.`,
                thanks: `Thank you${name ? ' ' + name : ''} for ordering with us! We look forward to seeing you again. — DT POS`,
              };
              setMessage(tpl[v] || message);
              e.target.value = '';
            }}
            defaultValue=""
          >
            <option value="">— Choose template —</option>
            <option value="received">📥 Order Received</option>
            <option value="accepted">✅ Order Accepted</option>
            <option value="preparing">👨‍🍳 Preparing</option>
            <option value="ready">🛎️ Ready for Pickup</option>
            <option value="dispatched">🛵 Dispatched</option>
            <option value="thanks">🙏 Thank You</option>
          </select>
          <p className="text-[10px] text-muted-foreground">
            Variables: <code>{'{name}'}</code> <code>{'{orderNo}'}</code> <code>{'{eta}'}</code> — replace manually before sending.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Message (auto-filled)</label>
          <Textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSend} className="flex-1 bg-[#25D366] hover:bg-[#1ebe57] text-white">
            <Send className="h-4 w-4 mr-1" /> Send
          </Button>
          <Button variant="outline" onClick={copyMessage} title="Copy message">
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setWebviewKey(k => k + 1)} title="Reload">
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="text-[11px] text-muted-foreground leading-snug border-t pt-3">
          <p className="flex items-center gap-1"><QrCode className="h-3 w-3" /> Scan the QR the first time. The session is then saved.</p>
          <p className="mt-1">No external browser or new tab is ever opened — everything stays inside this module.</p>
        </div>

        {/* Pending queue */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wide">Pending ({queue.length})</h3>
            {queue.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearAll} className="h-6 text-[10px]">Clear all</Button>
            )}
          </div>
          {queue.length > 0 && (
            <Button onClick={sendAllPending} className="w-full mb-2 h-7 text-[11px] bg-[#25D366] hover:bg-[#1ebe57] text-white">
              <Send className="h-3 w-3 mr-1" /> Send All ({queue.length}) — Auto Open
            </Button>
          )}
          {queue.length === 0 && <p className="text-[11px] text-muted-foreground">No pending messages.</p>}
          <div className="space-y-2">
            {queue.map(item => (
              <Card key={item.id} className="p-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{item.customerName || item.phone}</span>
                  <span className="text-muted-foreground text-[10px]">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
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

      {/* Embedded WhatsApp Web */}
      <div className="flex-1 bg-background relative">
        {!online && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur">
            <div className="text-center space-y-2 max-w-sm p-6">
              <WifiOff className="h-10 w-10 mx-auto text-destructive" />
              <h3 className="font-bold">Internet not available</h3>
              <p className="text-sm text-muted-foreground">
                Messages are being saved to a queue. Once you are online, "Send now" .
              </p>
            </div>
          </div>
        )}
        {isElectron() ? (
          createElement('webview', {
            key: webviewKey,
            ref: webviewRef,
            src: waUrl,
            partition: 'persist:whatsapp',
            allowpopups: 'true',
            useragent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            style: { width: '100%', height: '100%', display: 'inline-flex' },
          })
        ) : (
          <div className="w-full h-full flex items-center justify-center p-8">
            <div className="max-w-md text-center space-y-4 border border-border rounded-lg p-6 bg-card">
              <MessageCircle className="h-12 w-12 mx-auto text-[#25D366]" />
              <h3 className="text-lg font-bold">WhatsApp Web Popup</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Browser ki security ki wajah se WhatsApp Web is page mein embed nahi ho sakta.
                Web par yeh ek <b>chhoti centered popup window</b> mein khulta hai
                (naya tab nahi). Pehli baar QR scan karein — phir session save reh jayegi.
              </p>
              <Button
                onClick={() => {
                  const w = 900, h = 700;
                  const left = Math.max(0, (window.screen.width - w) / 2);
                  const top = Math.max(0, (window.screen.height - h) / 2);
                  window.open(
                    waUrl,
                    'whatsapp_popup',
                    `popup=yes,width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`,
                  )?.focus();
                }}
                className="bg-[#25D366] hover:bg-[#1ebe57] text-white"
              >
                <Send className="h-4 w-4 mr-2" /> Open WhatsApp Popup
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Agar popup block ho — browser ke address bar mein "Allow popups for this site" enable karein.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
