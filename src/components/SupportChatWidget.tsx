// v1.18.1 — identity from the auth adapter: a Supabase-authenticated super
// admin has NO Firebase user, so fbAuth().currentUser was null here and the
// support panels showed an empty sender.
import { currentAuthUser } from '@/lib/authProvider';
// Restaurant Dashboard — built-in Support / AI Assistant panel
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, ShieldCheck, Image as ImgIcon, Loader2, Sparkles } from 'lucide-react';
import { getTenantId, getTenantName } from '@/lib/tenant';
import { fbAuth } from '@/lib/firebase';
import { getInstalledVersion } from '@/lib/version';
import {
  listenSupport, sendSupportMessage, markRead, uploadSupportImage,
  type SupportMessage, type SupportCategory,
} from '@/lib/support';
import {
  queueSupportMessage, subscribeOutbox, retryOutboxItem, discardOutboxItem,
  type OutboxItem,
} from '@/lib/supportOutbox';
import SupportImage from '@/components/SupportImage';
import { SUPPORT_CATEGORIES } from '@/lib/aiKnowledgeBase';
import { getAIConfig, generateAIReply, classifyIntent } from '@/lib/aiAssistant';
import { Button } from '@/components/ui/button';

function fmtMsgTime(v: any): string {
  if (!v) return '…';
  if (typeof v?.toDate === 'function') return v.toDate().toLocaleString();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toLocaleString() : '…';
}

export default function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<SupportCategory>('general');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState<string>('');
  const [aiThinking, setAiThinking] = useState(false);
  const [version, setVersion] = useState('');
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tid = getTenantId();

  useEffect(() => subscribeOutbox(list => setPending(list.filter(i => i.tenantId === tid && i.from === 'owner'))), [tid]);

  useEffect(() => { getInstalledVersion().then(setVersion); }, []);

  useEffect(() => {
    if (!tid) return;
    return listenSupport(tid, (list) => {
      let hideBefore = 0;
      try { hideBefore = parseInt(localStorage.getItem(`pos-support-hide-before::${tid}`) || '0', 10) || 0; } catch {}
      setMsgs(hideBefore
        ? list.filter((m: any) => {
            const v = m.createdAt;
            const t = typeof v?.toDate === 'function' ? v.toDate().getTime() : new Date(v || 0).getTime();
            return !Number.isFinite(t) || t > hideBefore;
          })
        : list);
    });
  }, [tid]);

  useEffect(() => {
    if (open && tid) markRead(tid, 'owner');
  }, [open, msgs.length, tid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [msgs.length, pending.length, open]);

  if (!tid) return null;

  const unread = msgs.filter(m => m.from === 'admin' && !m.read).length;
  const restaurantName = getTenantName() || '';
  const user = currentAuthUser();
  const userEmail = user?.email || '';
  const userName = user?.displayName || userEmail.split('@')[0] || 'User';

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadSupportImage(tid, file);
      setPendingImage(url);
    } catch (e: any) {
      console.error(e);
      alert('Image upload failed: ' + (e?.message || ''));
    }
    setUploading(false);
  };

  const send = async () => {
    const body = text.trim();
    if (!body && !pendingImage) return;
    setSending(true);
    try {
      const intent = classifyIntent(body);
      const meta = {
        restaurantName,
        branchName: localStorage.getItem('pos-active-branch-name') || '',
        userName,
        deviceName: localStorage.getItem('pos-device-name') || navigator.platform,
        appVersion: version,
      };
      const finalCategory: SupportCategory =
        intent === 'bug' ? 'bug' :
        intent === 'feature' ? 'feature' :
        category;

      queueSupportMessage(tid, 'owner', body || '(image)', userEmail, {
        category: finalCategory,
        imageUrl: pendingImage || undefined,
        meta,
        intent,
        status: 'new',
      });
      setText('');
      setPendingImage('');

      // DT POS Assistant auto-reply (built-in, no external API needed)
      const cfg = await getAIConfig().catch(() => null);
      const mode = cfg?.mode || 'ai';
      if (mode === 'ai' || mode === 'ai_human') {
        setAiThinking(true);
        try {
          const reply = await generateAIReply({
            userMessage: body,
            category: SUPPORT_CATEGORIES.find(c => c.id === finalCategory)?.label,
            restaurantName,
            branchName: meta.branchName,
            userName,
            version,
            history: msgs.slice(-6).map(m => ({ from: m.from, body: m.body })),
          });
          await sendSupportMessage(tid, 'admin', reply, 'assistant@dtpos', {
            aiGenerated: true,
            status: mode === 'ai' ? 'replied' : 'in_progress',
          });
        } catch (e) {
          console.warn('Assistant reply failed', e);
        }
        setAiThinking(false);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to send');
    }
    setSending(false);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-[80] h-14 w-14 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
          title="Digital Target Support"
        >
          <MessageCircle className="h-6 w-6" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background">
              {unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 z-[80] w-[380px] max-w-[94vw] h-[560px] max-h-[85vh] bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-violet-600 text-white px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm leading-tight flex items-center gap-1">
                  DT POS Assistant
                  <Sparkles className="h-3 w-3 opacity-70" />
                </div>
                <div className="text-[10px] opacity-80">Built-in software guide · Digital Target</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={async () => {
                  if (!confirm('Clear this chat locally? (Messages stay safe on the server — they are only hidden here)')) return;
                  try {
                    const key = `pos-support-hide-before::${tid || 'anon'}`;
                    localStorage.setItem(key, String(Date.now()));
                    setMsgs([]);
                  } catch {}
                }}
                className="text-[10px] px-2 py-1 rounded bg-white/15 hover:bg-white/25"
                title="Clear my chat view (server par messages safe rahenge)"
              >
                Clear
              </button>
              <button onClick={() => setOpen(false)} className="h-7 w-7 rounded hover:bg-white/15 flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Category bar */}
          <div className="px-2 py-1.5 border-b bg-muted/30 flex gap-1 overflow-x-auto">
            {SUPPORT_CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`whitespace-nowrap text-[10px] px-2 py-1 rounded-full border ${
                  category === c.id
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-card hover:bg-violet-50'
                }`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/20">
            {msgs.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Whatever the problem, write it here.<br />
                You can send a screenshot too.
              </div>
            )}
            {msgs.map(m => (
              <div key={m.id} className={`flex ${m.from === 'owner' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-xs ${
                  m.from === 'owner'
                    ? 'bg-violet-600 text-white rounded-br-sm'
                    : 'bg-card border rounded-bl-sm'
                }`}>
                  {m.from === 'admin' && (
                    <div className="text-[9px] font-bold uppercase opacity-70 mb-0.5 text-violet-600 flex items-center gap-1">
                      {m.aiGenerated ? <><Sparkles className="h-2.5 w-2.5" /> DT POS Assistant</> : 'Digital Target'}
                    </div>
                  )}
                  {m.category && m.from === 'owner' && (
                    <div className="text-[9px] opacity-80 mb-0.5">
                      {SUPPORT_CATEGORIES.find(c => c.id === m.category)?.emoji} {m.category}
                    </div>
                  )}
                  {m.imageUrl && (
                    <SupportImage src={m.imageUrl} className="rounded-lg max-h-32 mb-1 border" />
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`text-[9px] mt-0.5 ${m.from === 'owner' ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {fmtMsgTime(m.createdAt)}
                    {m.from === 'owner' && (
                      <span className="ml-1 font-bold">{m.read ? '✓✓ Seen' : '✓ Sent'}</span>
                    )}
                  </div>

                </div>
              </div>
            ))}
            {pending.map(p => (
              <div key={p.localId} className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-br-sm px-3 py-1.5 text-xs bg-violet-600/70 text-white">
                  <div className="whitespace-pre-wrap break-words">{p.body}</div>
                  <div className="text-[9px] mt-0.5 text-white/80 flex items-center gap-1">
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
            {aiThinking && (
              <div className="flex justify-start">
                <div className="bg-card border rounded-2xl px-3 py-1.5 text-xs flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-violet-600" />
                  DT POS Assistant is thinking…
                </div>
              </div>
            )}
          </div>

          {pendingImage && (
            <div className="px-3 py-2 border-t bg-muted/40 flex items-center gap-2">
              <SupportImage src={pendingImage} className="h-12 w-12 rounded object-cover border" />
              <span className="text-[10px] text-muted-foreground flex-1">Screenshot attached</span>
              <button onClick={() => setPendingImage('')} className="text-[10px] text-red-600 hover:underline">Remove</button>
            </div>
          )}

          <div className="border-t p-2 flex gap-1.5 bg-card items-center">
            <input
              type="file" accept="image/*" ref={fileRef} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-9 w-9 rounded-full border hover:bg-violet-50 flex items-center justify-center"
              title="Attach screenshot"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImgIcon className="h-4 w-4 text-violet-600" />}
            </button>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Write your message…"
              className="flex-1 h-9 px-3 text-xs border rounded-full bg-background outline-none focus:border-violet-500"
            />
            <Button size="sm" disabled={sending || (!text.trim() && !pendingImage)} onClick={send} className="bg-violet-600 hover:bg-violet-700 text-white rounded-full h-9 w-9 p-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
