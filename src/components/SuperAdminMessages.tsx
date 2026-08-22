// v1.18.1 — identity from the auth adapter: a Supabase-authenticated super
// admin has NO Firebase user, so fbAuth().currentUser was null here and the
// support panels showed an empty sender.
import { currentAuthUser } from '@/lib/authProvider';
// Super Admin → Messages tab (WhatsApp-style: left list, right chat)
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, Phone, Search, ShieldCheck, Image as ImgIcon, Loader2 } from 'lucide-react';
import {
  markRead, fetchTenantPhone, waLink,
  listenGlobalSupportInbox, uploadSupportImage,
  type SupportMessage,
} from '@/lib/support';
import {
  queueSupportMessage, subscribeOutbox, retryOutboxItem, discardOutboxItem,
  type OutboxItem,
} from '@/lib/supportOutbox';
import SupportImage from '@/components/SupportImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function msTime(v: any): number {
  if (!v) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function fmtDate(v: any): string {
  const t = msTime(v);
  return t ? new Date(t).toLocaleDateString() : '';
}

function fmtTime(v: any): string {
  const t = msTime(v);
  return t ? new Date(t).toLocaleString() : '…';
}

interface ClientLite {
  tenantId: string;
  name: string;
  email?: string;
  plan?: string;
}

interface Props {
  clients: ClientLite[];
}

interface ConvoSummary {
  tenantId: string;
  lastMsg?: SupportMessage;
  unread: number;
  all: SupportMessage[];
}

const QUICK = [
  'Hello! Please renew your subscription.',
  'Reminder: the invoice is unpaid — please settle it.',
  'Thank you, payment received.',
  'The account has expired — please renew it now.',
];

export default function SuperAdminMessages({ clients }: Props) {
  const [all, setAll] = useState<Record<string, SupportMessage[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'all' | 'unread' | 'bugs'>('all');
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [pendingImage, setPendingImage] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeOutbox(list => setPending(list.filter(i => i.from === 'admin'))), []);

  // Listen to ALL tenants' support messages (Cloud-backed, realtime).
  useEffect(() => {
    return listenGlobalSupportInbox(list => {
      const map: Record<string, SupportMessage[]> = {};
      [...list]
        .sort((a, b) => msTime(a.createdAt) - msTime(b.createdAt))
        .forEach(m => {
          const tid = (m as any)._tenantId;
          if (!tid) return;
          (map[tid] ||= []).push(m);
        });
      setAll(map);
    });
  }, []);

  // Summaries by tenant
  const convos: ConvoSummary[] = useMemo(() => {
    const byTid = new Map<string, ConvoSummary>();
    clients.forEach(c => byTid.set(c.tenantId, { tenantId: c.tenantId, all: [], unread: 0 }));
    Object.entries(all).forEach(([tid, msgs]) => {
      const cur = byTid.get(tid) || { tenantId: tid, all: [], unread: 0 };
      cur.all = msgs;
      cur.lastMsg = msgs[msgs.length - 1];
      cur.unread = msgs.filter(m => m.from === 'owner' && !m.read).length;
      byTid.set(tid, cur);
    });
    // sort: unread first, then by latest message
    return Array.from(byTid.values()).sort((a, b) => {
      if (a.unread !== b.unread) return b.unread - a.unread;
      const at = msTime(a.lastMsg?.createdAt);
      const bt = msTime(b.lastMsg?.createdAt);
      return bt - at;
    });
  }, [all, clients]);

  const nameFor = (tid: string) =>
    clients.find(x => x.tenantId === tid)?.name
    || (all[tid] || []).find(m => m.meta?.restaurantName)?.meta?.restaurantName
    || tid;

  const q = filter.trim().toLowerCase();
  const visibleConvos = convos.filter(c => {
    if (tab === 'unread' && c.unread === 0) return false;
    if (tab === 'bugs' && !c.all.some(m => m.intent === 'bug' || m.category === 'bug' || m.intent === 'urgent')) return false;
    if (!q) return true;
    const cli = clients.find(x => x.tenantId === c.tenantId);
    const blob = [
      nameFor(c.tenantId), cli?.email || '', cli?.plan || '',
      ...c.all.slice(-40).map(m => m.body || ''),
    ].join(' ').toLowerCase();
    return blob.includes(q);
  });

  const totalUnread = convos.reduce((s, c) => s + c.unread, 0);

  // Alert the Super Admin whenever a restaurant raises a new issue.
  const prevUnread = useRef(0);
  useEffect(() => {
    if (totalUnread > prevUnread.current) {
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.08;
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          setTimeout(() => { osc.stop(); ctx.close(); }, 220);
        }
      } catch { /* audio blocked */ }
      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('New support message', { body: 'A restaurant needs help.' });
          } else if (Notification.permission === 'default') {
            void Notification.requestPermission();
          }
        }
      } catch { /* ignore */ }
    }
    prevUnread.current = totalUnread;
  }, [totalUnread]);

  const activeMsgs = selected ? (all[selected] || []) : [];
  const activeClient = clients.find(c => c.tenantId === selected);

  useEffect(() => {
    if (!selected) { setPhone(''); return; }
    markRead(selected, 'admin');
    fetchTenantPhone(selected).then(setPhone);
  }, [selected, activeMsgs.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [activeMsgs.length, selected]);

  const send = () => {
    if (!selected) return;
    const body = text.trim();
    if (!body && !pendingImage) return;
    setSending(true);
    const email = currentAuthUser()?.email || '';
    queueSupportMessage(selected, 'admin', body || '(image)', email,
      pendingImage ? { imageUrl: pendingImage } : undefined);
    setText('');
    setPendingImage('');
    setSending(false);
  };

  const handleUpload = async (file: File) => {
    if (!file || !selected) return;
    setUploading(true);
    try {
      setPendingImage(await uploadSupportImage(selected, file));
    } catch (e: any) {
      console.error(e);
      alert('Image upload failed: ' + (e?.message || ''));
    }
    setUploading(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3 h-[calc(100vh-280px)] min-h-[500px]">
      {/* LEFT — list */}
      <div className="border rounded-xl bg-card flex flex-col overflow-hidden">
        <div className="p-3 border-b bg-violet-600 text-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-sm flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4" /> Inbox
            </div>
            {totalUnread > 0 && (
              <span className="text-[10px] bg-red-500 px-1.5 py-0.5 rounded-full font-bold">{totalUnread} new</span>
            )}
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-white/70" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search restaurant or message text…"
              className="h-8 pl-7 text-xs bg-white/15 border-white/20 text-white placeholder:text-white/60"
            />
          </div>
          <div className="flex gap-1 mt-2">
            {(['all', 'unread', 'bugs'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${
                  tab === t ? 'bg-white text-violet-700 border-white font-bold' : 'border-white/40 text-white/80 hover:bg-white/15'
                }`}>
                {t === 'bugs' ? 'Bugs / Urgent' : t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleConvos.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No conversations</div>
          )}
          {visibleConvos.map(c => {
            const cli = clients.find(x => x.tenantId === c.tenantId);
            const name = nameFor(c.tenantId);
            const active = selected === c.tenantId;
            const last = c.lastMsg;
            const preview = last ? (last.from === 'admin' ? '✓ ' : '') + (last.body || '').slice(0, 40) : 'No messages yet';
            const time = fmtDate(last?.createdAt);
            return (
              <button
                key={c.tenantId}
                onClick={() => setSelected(c.tenantId)}
                className={`w-full text-left px-3 py-2.5 border-b hover:bg-muted/40 transition flex items-start gap-2 ${active ? 'bg-violet-500/10 border-l-4 border-l-violet-600' : ''}`}
              >
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  {(name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-bold text-sm truncate">{name}</div>
                    {time && <div className="text-[9px] text-muted-foreground shrink-0">{time}</div>}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <div className={`text-[11px] truncate ${c.unread > 0 ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                      {preview}
                    </div>
                    {c.unread > 0 && (
                      <span className="text-[9px] bg-red-600 text-white rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center font-bold shrink-0">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT — chat */}
      <div className="border rounded-xl bg-card flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <MessageCircle className="h-16 w-16 mb-3 opacity-20" />
            <div className="font-bold text-sm">Select a restaurant on the left</div>
            <div className="text-xs mt-1">Start a chat with the owner</div>
          </div>
        ) : (
          <>
            <div className="p-3 border-b flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm">
                  {(activeClient?.name || nameFor(selected) || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{activeClient?.name || nameFor(selected)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{activeClient?.email}</div>
                </div>
              </div>
              {phone && (
                <a href={waLink(phone, `Dear ${activeClient?.name || ''},`)} target="_blank" rel="noreferrer"
                  className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-600 text-white hover:bg-green-700">
                  <Phone className="h-3 w-3" /> WhatsApp
                </a>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/20">
              {activeMsgs.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-10">Send the first message</div>
              )}
              {activeMsgs.map(m => (
                <div key={m.id} className={`flex ${m.from === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-xs shadow-sm ${
                    m.from === 'admin'
                      ? 'bg-violet-600 text-white rounded-br-sm'
                      : 'bg-card border rounded-bl-sm'
                  }`}>
                    {m.from === 'admin' && (
                      <div className="text-[9px] font-bold uppercase opacity-80 mb-0.5 flex items-center gap-1">
                        <ShieldCheck className="h-2.5 w-2.5" /> Digital Target
                      </div>
                    )}
                    {m.imageUrl && (
                      <SupportImage src={m.imageUrl} className="rounded-lg max-h-40 mb-1 border" />
                    )}
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[9px] mt-0.5 ${m.from === 'admin' ? 'text-white/70' : 'text-muted-foreground'}`}>
                      {fmtTime(m.createdAt)}
                      {m.from === 'admin' && (
                        <span className="ml-1 font-bold">{m.read ? '✓✓ Seen' : '✓ Sent'}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {pending.filter(p => p.tenantId === selected).map(p => (
                <div key={p.localId} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm px-3 py-1.5 text-xs bg-violet-600/70 text-white">
                    <div className="whitespace-pre-wrap break-words">{p.body}</div>
                    <div className="text-[9px] mt-0.5 text-white/85 flex items-center gap-1">
                      {p.status === 'failed' ? (
                        <>
                          <span className="font-bold">⚠ Failed</span>
                          <button onClick={() => retryOutboxItem(p.localId)} className="underline">Retry</button>
                          <button onClick={() => discardOutboxItem(p.localId)} className="underline">Delete</button>
                        </>
                      ) : (
                        <span className="font-bold">◌ Sending{p.attempts > 0 ? ` (retry ${p.attempts})` : ''}…</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t bg-card">
              <div className="px-2 py-1.5 flex flex-wrap gap-1 border-b">
                {QUICK.map((q, i) => (
                  <button key={i} onClick={() => setText(q)}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-violet-100 border">
                    {q.slice(0, 30)}…
                  </button>
                ))}
              </div>
              {pendingImage && (
                <div className="px-2 py-1.5 border-b flex items-center gap-2">
                  <SupportImage src={pendingImage} className="h-10 w-10 rounded object-cover border" />
                  <span className="text-[10px] text-muted-foreground flex-1">Screenshot attached</span>
                  <button onClick={() => setPendingImage('')} className="text-[10px] text-red-600 hover:underline">Remove</button>
                </div>
              )}
              <div className="p-2 flex gap-1.5">
                <input type="file" accept="image/*" ref={fileRef} className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="h-9 w-9 self-end rounded-lg border hover:bg-violet-50 flex items-center justify-center shrink-0"
                  title="Attach screenshot">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImgIcon className="h-4 w-4 text-violet-600" />}
                </button>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Reply likhein…"
                  rows={2}
                  className="flex-1 px-3 py-1.5 text-xs border rounded-lg bg-background outline-none focus:border-violet-500 resize-none"
                />
                <Button size="sm" disabled={sending || (!text.trim() && !pendingImage)} onClick={send}
                  className="bg-violet-600 hover:bg-violet-700 text-white self-end">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
