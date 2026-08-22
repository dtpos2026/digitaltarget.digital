// v1.18.1 — identity from the auth adapter: a Supabase-authenticated super
// admin has NO Firebase user, so fbAuth().currentUser was null here and the
// support panels showed an empty sender.
import { currentAuthUser } from '@/lib/authProvider';
// Super Admin → message a specific client + status + internal notes + AI reply
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle, Send, Phone, Sparkles, Loader2, StickyNote } from 'lucide-react';
import { fbAuth } from '@/lib/firebase';
import {
  listenSupport, sendSupportMessage, markRead, fetchTenantPhone, waLink,
  setMessageStatus, listenInternalNotes, addInternalNote,
  type SupportMessage, type SupportStatus, type InternalNote,
} from '@/lib/support';
import SupportImage from '@/components/SupportImage';
import { generateAIReply, getAIConfig } from '@/lib/aiAssistant';
import { SUPPORT_CATEGORIES } from '@/lib/aiKnowledgeBase';

interface Props {
  tenantId: string;
  restaurantName: string;
  onClose: () => void;
  initialText?: string;
}

const QUICK = [
  'Hello! Your subscription is expiring soon.',
  'Reminder: the previous invoice is still unpaid.',
  'Thank you! We have received your payment.',
  'Your issue has been fixed — please re-test.',
];

const STATUS_COLORS: Record<SupportStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  replied: 'bg-purple-100 text-purple-700',
  fixed: 'bg-green-100 text-green-700',
  closed: 'bg-gray-200 text-gray-700',
};

export default function SupportInboxDialog({ tenantId, restaurantName, onClose, initialText }: Props) {
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [text, setText] = useState(initialText || '');
  const [noteText, setNoteText] = useState('');
  const [notePriority, setNotePriority] = useState<'low'|'medium'|'high'|'urgent'>('medium');
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [tab, setTab] = useState<'chat'|'notes'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = listenSupport(tenantId, setMsgs);
    const unsub2 = listenInternalNotes(tenantId, setNotes);
    fetchTenantPhone(tenantId).then(setPhone);
    return () => { unsub(); unsub2(); };
  }, [tenantId]);

  useEffect(() => { markRead(tenantId, 'admin'); }, [tenantId, msgs.length]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }); }, [msgs.length, tab]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const email = currentAuthUser()?.email || '';
      await sendSupportMessage(tenantId, 'admin', body, email, { status: 'replied' });
      setText('');
    } catch (e: any) { console.error(e); }
    setSending(false);
  };

  const aiSuggest = async () => {
    setAiBusy(true);
    try {
      const cfg = await getAIConfig();
      if (!cfg.apiKey) { alert('AI key not configured. Go to AI Settings.'); return; }
      const lastOwner = [...msgs].reverse().find(m => m.from === 'owner');
      if (!lastOwner) { alert('No message from the owner.'); return; }
      const reply = await generateAIReply({
        userMessage: lastOwner.body,
        category: lastOwner.category,
        restaurantName,
        branchName: lastOwner.meta?.branchName,
        userName: lastOwner.meta?.userName,
        version: lastOwner.meta?.appVersion,
        history: msgs.slice(-6).map(m => ({ from: m.from, body: m.body })),
      });
      setText(reply);
    } catch (e: any) {
      alert('AI failed: ' + e?.message);
    }
    setAiBusy(false);
  };

  const addNote = async () => {
    const body = noteText.trim();
    if (!body) return;
    const email = currentAuthUser()?.email || '';
    await addInternalNote(tenantId, { body, authorEmail: email, priority: notePriority });
    setNoteText('');
  };

  const changeStatus = async (msgId: string, status: SupportStatus) => {
    await setMessageStatus(tenantId, msgId, status);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-3 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-violet-600" />
            {restaurantName}
          </DialogTitle>
          <div className="flex items-center gap-2 mt-1">
            {phone && (
              <a href={waLink(phone, text || `Dear ${restaurantName},`)} target="_blank" rel="noreferrer"
                className="text-[11px] text-green-600 font-semibold inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" /> WA: {phone}
              </a>
            )}
            <div className="flex gap-1 ml-auto">
              <button onClick={() => setTab('chat')}
                className={`text-[11px] px-2 py-0.5 rounded-full ${tab==='chat'?'bg-violet-600 text-white':'bg-muted'}`}>
                Chat
              </button>
              <button onClick={() => setTab('notes')}
                className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${tab==='notes'?'bg-violet-600 text-white':'bg-muted'}`}>
                <StickyNote className="h-3 w-3" /> Internal Notes ({notes.length})
              </button>
            </div>
          </div>
        </DialogHeader>

        {tab === 'chat' && (
          <>
            <div ref={scrollRef} className="h-[360px] overflow-y-auto p-3 space-y-2 bg-muted/20">
              {msgs.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-10">
                  No messages.
                </div>
              )}
              {msgs.map(m => (
                <div key={m.id} className={`flex ${m.from === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-xs ${
                    m.from === 'admin' ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-card border rounded-bl-sm'
                  }`}>
                    {m.from === 'owner' && (
                      <div className="text-[9px] font-bold uppercase opacity-70 mb-0.5 flex flex-wrap gap-1 items-center">
                        {m.meta?.userName || 'Owner'}
                        {m.category && (
                          <span className="bg-muted text-foreground px-1 rounded">
                            {SUPPORT_CATEGORIES.find(c => c.id === m.category)?.emoji} {m.category}
                          </span>
                        )}
                        {m.status && (
                          <span className={`px-1 rounded ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                        )}
                      </div>
                    )}
                    {m.aiGenerated && (
                      <div className="text-[9px] opacity-70 mb-0.5 inline-flex items-center gap-1">
                        <Sparkles className="h-2.5 w-2.5" /> AI
                      </div>
                    )}
                    {m.imageUrl && (
                      <SupportImage src={m.imageUrl} className="rounded max-h-40 mb-1 border" />
                    )}

                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    {m.meta && m.from === 'owner' && (
                      <div className="text-[9px] mt-1 opacity-70 border-t border-black/10 pt-0.5">
                        {m.meta.branchName && `📍${m.meta.branchName} · `}
                        {m.meta.deviceName && `💻${m.meta.deviceName} · `}
                        {m.meta.appVersion && `v${m.meta.appVersion}`}
                      </div>
                    )}
                    <div className={`text-[9px] mt-0.5 ${m.from === 'admin' ? 'text-white/70' : 'text-muted-foreground'} flex items-center gap-2`}>
                      <span>{m.createdAt?.toDate?.()?.toLocaleString() || '…'}</span>
                      {m.from === 'owner' && (
                        <select
                          value={m.status || 'new'}
                          onChange={e => changeStatus(m.id, e.target.value as SupportStatus)}
                          className="text-[9px] border rounded px-1 py-0 bg-background text-foreground"
                        >
                          <option value="new">New</option>
                          <option value="in_progress">In Progress</option>
                          <option value="replied">Replied</option>
                          <option value="fixed">Fixed</option>
                          <option value="closed">Closed</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t bg-card">
              <div className="px-3 py-2 flex flex-wrap gap-1 border-b">
                {QUICK.map((q, i) => (
                  <button key={i} onClick={() => setText(q)}
                    className="text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-violet-100 border">
                    {q.slice(0, 32)}…
                  </button>
                ))}
                <button onClick={aiSuggest} disabled={aiBusy}
                  className="text-[10px] px-2 py-1 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 border inline-flex items-center gap-1">
                  {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  AI Suggest Reply
                </button>
              </div>
              <div className="p-2 flex gap-1.5">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Reply…"
                  rows={2}
                  className="flex-1 px-3 py-1.5 text-xs border rounded-lg bg-background outline-none focus:border-violet-500 resize-none"
                />
                <div className="flex flex-col gap-1">
                  <Button size="sm" disabled={sending || !text.trim()} onClick={send}
                    className="bg-violet-600 hover:bg-violet-700 text-white">
                    <Send className="h-4 w-4" />
                  </Button>
                  {phone && (
                    <a href={waLink(phone, text || `Dear ${restaurantName},`)} target="_blank" rel="noreferrer"
                      className="h-8 w-8 rounded bg-green-600 hover:bg-green-700 text-white flex items-center justify-center" title="WhatsApp">
                      <Phone className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'notes' && (
          <div className="p-3 space-y-2">
            <div className="text-[10px] text-muted-foreground bg-amber-50 border border-amber-200 rounded px-2 py-1">
              🔒 Internal notes — visible only to the Super Admin and support team, never to the restaurant.
            </div>
            <div className="max-h-[260px] overflow-y-auto space-y-1.5">
              {notes.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">No notes.</div>}
              {notes.map(n => (
                <div key={n.id} className="border rounded p-2 text-xs bg-card">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      n.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                      n.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      n.priority === 'medium' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>{n.priority}</span>
                    <span className="text-[10px] text-muted-foreground">{n.authorEmail}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{n.createdAt?.toDate?.()?.toLocaleString() || ''}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{n.body}</div>
                  {(n.assignedTo || n.expectedFixDate || n.fixVersion) && (
                    <div className="text-[10px] text-muted-foreground mt-1 border-t pt-1">
                      {n.assignedTo && `👤 ${n.assignedTo} `}
                      {n.expectedFixDate && `📅 ${n.expectedFixDate} `}
                      {n.fixVersion && `🏷 v${n.fixVersion}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t pt-2 space-y-1.5">
              <div className="flex gap-1.5">
                <select value={notePriority} onChange={e => setNotePriority(e.target.value as any)}
                  className="text-xs border rounded px-2 py-1 bg-background">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <Button size="sm" onClick={addNote} disabled={!noteText.trim()}
                  className="ml-auto bg-violet-600 hover:bg-violet-700 text-white">Add Note</Button>
              </div>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Developer assignment, expected fix, status update…"
                rows={3}
                className="w-full text-xs border rounded px-2 py-1 bg-background resize-none"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
