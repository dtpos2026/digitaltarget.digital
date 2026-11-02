// ============================================================
// CUSTOMER DISPLAY SETTINGS
//
// Configures the screen above the counter: how it looks, how the width is
// split between orders and advertising, what it announces, how long a ready
// order stays up, and the banners or video shown beside the order columns.
//
// Banners are stored as data URLs in this device's own storage, which is a
// few megabytes in total. That is a real limit, not a soft one, so the card
// shows the current size, warns before it becomes a problem, and reports a
// quota failure plainly instead of pretending the upload worked.
//
// The image itself is never re-encoded. A shop that uploads a 1.2 MB poster
// gets that exact file on the screen; the width, height, fit and position
// below are applied as CSS at display time, so sizing costs no quality.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import VoiceStatusPanel from '@/components/VoiceStatusPanel';
import { planSpeech, type VoiceInfo, type VoiceSupport } from '@/lib/speech';
import {
  Monitor, Trash2, Volume2, Image as ImageIcon, Film, Palette, Columns, Settings2,
  Link as LinkIcon, Speaker,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  loadDisplayConfig,
  saveDisplayConfig,
  displayConfigSizeKb,
  announceOrder,
  mediaStyle,
  ANNOUNCEMENT_VOICES,
  voiceById,
  type CustomerDisplayConfig,
  type DisplayMedia,
  type MediaFit,
  type MediaPosition,
} from '@/lib/customerDisplay';
import { templateById } from '@/lib/displayTemplates';
import DisplayTemplatePicker from '@/components/DisplayTemplatePicker';
import { getSettings } from '@/lib/store';
import { pickMediaFile, isElectron } from '@/lib/electron';
import {
  canChooseOutput, listAudioOutputs, loadAnnounceOutput, saveAnnounceOutput,
  playAnnounceChime, type AudioOutput,
} from '@/lib/announceAudio';

/** Beyond this the shop is close to the storage limit. */
const SIZE_WARN_KB = 3000;

/** The splits a shop actually asks for, plus a free number for anything else. */
const RATIO_PRESETS = [
  { value: 70, label: '70 / 30', hint: 'Mostly orders' },
  { value: 50, label: '50 / 50', hint: 'Even split' },
  { value: 30, label: '30 / 70', hint: 'Mostly advertising' },
  { value: 100, label: 'Orders only', hint: 'No banner panel' },
];

const FITS: Array<{ value: MediaFit; label: string; hint: string }> = [
  { value: 'contain', label: 'Whole image', hint: 'Nothing cropped, nothing stretched.' },
  { value: 'cover', label: 'Fill & crop', hint: 'Fills the panel; edges may be cut off.' },
  { value: 'fill', label: 'Stretch', hint: 'Fills exactly — can distort the picture.' },
];

const POSITIONS: MediaPosition[] = ['center', 'top', 'bottom', 'left', 'right'];

export default function CustomerDisplaySettingsCard() {
  const [cfg, setCfg] = useState<CustomerDisplayConfig>(() => loadDisplayConfig());
  const fileRef = useRef<HTMLInputElement>(null);
  const [sizeKb, setSizeKb] = useState(0);
  const [openMedia, setOpenMedia] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [showVideoUrl, setShowVideoUrl] = useState(false);
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [output, setOutput] = useState(() => loadAnnounceOutput());
  // What Windows can speak — filled by the voice status panel, used for the
  // per-line hints ("read by the Hindi voice", "will be skipped").
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const onSupport = useCallback((s: VoiceSupport) => setVoices(s.voices), []);
  const shopName = (() => { try { return getSettings().name; } catch { return undefined; } })();

  useEffect(() => { setSizeKb(displayConfigSizeKb(cfg)); }, [cfg]);

  useEffect(() => {
    void listAudioOutputs().then(setOutputs);
  }, []);

  const commit = (next: CustomerDisplayConfig) => {
    const res = saveDisplayConfig(next);
    if (!res.ok) {
      toast.error(res.error || 'Could not save.');
      return false;
    }
    setCfg(next);
    return true;
  };

  const patch = (p: Partial<CustomerDisplayConfig>) => commit({ ...cfg, ...p });

  const patchMedia = (id: string, p: Partial<DisplayMedia>) =>
    patch({ media: cfg.media.map(m => (m.id === id ? { ...m, ...p } : m)) });

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: DisplayMedia[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        toast.error(`${f.name} is not an image.`);
        continue;
      }
      // 1.5 MB is already a large banner for a screen; beyond that the shop
      // runs out of storage after two or three.
      if (f.size > 1_500_000) {
        toast.error(`${f.name} is ${(f.size / 1_000_000).toFixed(1)} MB. Use an image under 1.5 MB.`);
        continue;
      }
      // Read as-is. No canvas, no resize, no re-encode — the screen shows the
      // file the shop chose, at the quality they chose it at.
      const src = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(f);
      }).catch(() => '');
      if (src) added.push({ id: `m${Date.now()}${added.length}`, kind: 'image', src, fit: 'contain', position: 'center' });
    }
    if (added.length) {
      if (commit({ ...cfg, media: [...cfg.media, ...added] })) {
        toast.success(`${added.length} banner(s) added.`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const pushVideo = (src: string, label?: string) => {
    if (!src.trim()) return false;
    const ok = commit({
      ...cfg,
      media: [...cfg.media, {
        id: `v${Date.now()}`, kind: 'video', src: src.trim(),
        fit: 'contain', position: 'center',
        caption: label,
      }],
    });
    if (ok) toast.success('Video added.');
    return ok;
  };

  /**
   * ===== THE ADD VIDEO BUTTON THAT DID NOTHING =====
   *
   * This used to call `window.prompt()` and ask the shop to TYPE a path.
   * Electron does not implement prompt() — it returns null and logs
   * "prompt() is and will not be supported" — so in the packaged Windows app
   * the button was a no-op. It worked when tested in a browser, which is
   * exactly how it shipped.
   *
   * A native file chooser is also simply the right control: nobody should be
   * typing file:///C:/Users/.../promo.mp4 by hand.
   */
  const addVideo = async () => {
    const picked = await pickMediaFile('video');
    if (picked.success && picked.url) {
      // The video is NOT copied. These settings live in localStorage next to
      // the banners, and a promo video is tens of megabytes — so the path is
      // stored and the file has to stay where it is.
      if (pushVideo(picked.url, picked.name)) setVideoUrl('');
      return;
    }
    if (picked.canceled) return;
    if (picked.error && picked.error !== 'not-desktop') {
      toast.error(`Could not open the file chooser: ${picked.error}`);
      return;
    }
    // Browser build: there is no file chooser that yields a lasting path, so
    // the address field below is the way in. Say so instead of doing nothing.
    setShowVideoUrl(true);
    toast.info('Paste the video address below — the desktop app can browse for the file.');
  };

  const remove = (id: string) => commit({ ...cfg, media: cfg.media.filter(m => m.id !== id) });

  const testVoice = async () => {
    const r = await announceOrder(101, cfg);
    if (!r.spoken) toast.error(r.reason || 'This device could not speak the announcement.');
    else if (r.reason) toast.warning(`Played, but: ${r.reason}`);
    else toast.success(r.notes?.find(n => n.startsWith('Urdu line')) || 'Announcement played.');
  };

  /** How one announcement line will be spoken on this computer. */
  const lineHint = (text: string, lang: string) => {
    if (!voices) return null;
    const r = planSpeech(text.replace(/\{n\}/g, '101'), lang, voices, { hindiForUrdu: cfg.announceHindiForUrdu });
    if (r.kind === 'skip') return <span className="text-destructive"> — {r.reason}</span>;
    if (r.kind === 'hindi-for-urdu') return <span className="text-status-warning"> — no Urdu voice; read by the Hindi voice “{r.voice.name}”.</span>;
    return <span> — voice: {r.voice.name}</span>;
  };

  const testChime = async () => {
    const r = await playAnnounceChime(output);
    if (!r.ok) toast.error(r.reason || 'Could not play the chime.');
    else if (r.reason) toast.warning(r.reason);
    else toast.success('Chime played.');
  };

  const openDisplay = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/customer-display`;
    const api: any = (window as any).electronAPI;
    if (api?.openKdsWindow) {
      const res = await api.openKdsWindow({ url, fullscreen: true });
      if (res?.success) toast.success('Customer Display opened on the external screen.');
      else toast.error(`Could not open the display: ${res?.error || 'unknown error'}`);
      return;
    }
    window.open('#/customer-display', '_blank');
  };

  const template = templateById('customer', cfg.templateId);

  return (
    <Card className="p-4 md:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Monitor className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Customer Display</h3>
          <p className="text-xs text-muted-foreground mt-1">
            The screen above the counter: which orders are being prepared, which
            are ready to collect, and your own banners or video in between.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="cd-enabled" className="text-sm">Enable customer display</Label>
          <p className="text-xs text-muted-foreground">Turn on before opening it on a screen.</p>
        </div>
        <Switch id="cd-enabled" checked={cfg.enabled} onCheckedChange={v => patch({ enabled: v })} />
      </div>

      {/* ===== LOOK ===== */}
      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4" />
          <Label className="text-sm">Design</Label>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(['manual', 'automatic'] as const).map(mode => (
            <Button
              key={mode}
              type="button" size="sm"
              variant={cfg.templateMode === mode ? 'default' : 'outline'}
              onClick={() => patch({ templateMode: mode })}
            >
              {mode === 'manual' ? 'Choose a design' : 'Match the screen automatically'}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {cfg.templateMode === 'automatic'
            ? 'The display reads the screen it opens on and picks a design to suit its size and shape — a wide TV gets the large-number layout, a small or square panel gets the compact one. Nothing is stretched to fit.'
            : 'The design below is used on every screen, whatever its size. The layout still reflows and the type still scales.'}
        </p>

        {cfg.templateMode === 'manual' && (
          <DisplayTemplatePicker
            surface="customer"
            value={cfg.templateId}
            shopName={shopName}
            onApply={id => {
              if (patch({ templateId: id })) toast.success(`${templateById('customer', id).name} applied.`);
            }}
          />
        )}
      </div>

      {/* ===== SPLIT ===== */}
      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Columns className="h-4 w-4" />
          <Label className="text-sm">Orders and advertising</Label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {RATIO_PRESETS.map(r => (
            <Button
              key={r.value}
              type="button" size="sm"
              variant={cfg.orderRatio === r.value ? 'default' : 'outline'}
              onClick={() => patch({ orderRatio: r.value })}
              title={r.hint}
            >
              {r.label}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Or set the order share exactly (%)</Label>
            <Input
              type="number" min={20} max={100} className="w-28"
              value={cfg.orderRatio}
              onChange={e => patch({ orderRatio: Math.max(20, Math.min(100, Number(e.target.value) || 70)) })}
            />
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            {cfg.orderRatio >= 100
              ? 'The whole screen is orders — banners are not shown.'
              : `Orders take ${cfg.orderRatio}%, banners ${100 - cfg.orderRatio}%.`}
            {' '}On a narrow screen the banners move below the orders instead of squeezing both.
          </p>
        </div>
        {cfg.orderRatio !== template.orderRatio && cfg.templateMode === 'manual' && (
          <p className="text-xs text-muted-foreground">
            The {template.name} design normally uses {template.orderRatio}%. Your setting wins.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Heading</Label>
          <Input value={cfg.heading} onChange={e => patch({ heading: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Keep a ready order on screen (seconds)</Label>
          <Input type="number" min={10} max={600} value={cfg.readyHoldSeconds}
                 onChange={e => patch({ readyHoldSeconds: Number(e.target.value) || 90 })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Message along the bottom</Label>
        <Input
          placeholder="Thanks for your patience!"
          value={cfg.footerMessage}
          onChange={e => patch({ footerMessage: e.target.value })}
        />
        <p className="text-[11px] text-muted-foreground">
          The last thing a waiting customer reads, so it is your words. Leave
          it empty to hide the bar.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="cd-credit" className="text-sm">Show &ldquo;Powered by Digital Target&rdquo;</Label>
          <p className="text-xs text-muted-foreground">
            A single small line under your restaurant&rsquo;s name. The screen&rsquo;s
            branding is yours — your logo and your name are the largest things on it.
          </p>
        </div>
        <Switch id="cd-credit" checked={cfg.showDeveloperCredit}
                onCheckedChange={v => patch({ showDeveloperCredit: v })} />
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="cd-announce" className="text-sm flex items-center gap-1.5">
              <Volume2 className="h-4 w-4" /> Announce the order number aloud
            </Label>
            <p className="text-xs text-muted-foreground">Spoken when an order becomes ready.</p>
          </div>
          <Switch id="cd-announce" checked={cfg.announce} onCheckedChange={v => patch({ announce: v })} />
        </div>

        {cfg.announce && (
          <div className="space-y-3">
            {/* ===== FIRST ANNOUNCEMENT ===== */}
            <div className="space-y-1.5">
              <Label className="text-xs">Announcement</Label>
              <div className="flex flex-wrap gap-1.5">
                {ANNOUNCEMENT_VOICES.map(v => (
                  <Button
                    key={v.id}
                    type="button" size="sm"
                    variant={cfg.announceTemplate === v.text ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => patch({ announceTemplate: v.text, announceLang: v.lang })}
                  >
                    {v.label}
                  </Button>
                ))}
              </div>
              <Input value={cfg.announceTemplate}
                     onChange={e => patch({ announceTemplate: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                <code>{'{n}'}</code> becomes the order number. Language:{' '}
                <b>{cfg.announceLang}</b>
                {lineHint(cfg.announceTemplate, cfg.announceLang)}
              </p>
            </div>

            {/* ===== SECOND LANGUAGE ===== */}
            <div className="rounded-md bg-muted/40 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Say it again in another language</Label>
                <Switch
                  checked={!!cfg.announceTemplate2}
                  onCheckedChange={v => patch({
                    announceTemplate2: v ? (voiceById('ur-ready')?.text || '') : '',
                    announceLang2: 'ur-PK',
                  })}
                />
              </div>
              {cfg.announceTemplate2 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {ANNOUNCEMENT_VOICES.map(v => (
                      <Button
                        key={v.id}
                        type="button" size="sm"
                        variant={cfg.announceTemplate2 === v.text ? 'default' : 'outline'}
                        className="h-7 text-xs"
                        onClick={() => patch({ announceTemplate2: v.text, announceLang2: v.lang })}
                      >
                        {v.label}
                      </Button>
                    ))}
                  </div>
                  <Input value={cfg.announceTemplate2}
                         onChange={e => patch({ announceTemplate2: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground">
                    Spoken straight after the first. Language: <b>{cfg.announceLang2}</b>
                    {lineHint(cfg.announceTemplate2, cfg.announceLang2)}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Most counters want the number in Urdu and again in English.
                </p>
              )}
            </div>

            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">Repeat</Label>
                <Input type="number" min={1} max={5} className="w-20"
                       value={cfg.announceRepeat}
                       onChange={e => patch({ announceRepeat: Number(e.target.value) || 1 })} />
              </div>
              <Button size="sm" variant="outline" onClick={() => void testVoice()}>Test the voice</Button>
            </div>

            <VoiceStatusPanel
              hindiForUrdu={cfg.announceHindiForUrdu}
              onHindiForUrdu={v => patch({ announceHindiForUrdu: v })}
              onSupport={onSupport}
            />

            {/* ===== CHIME AND WHERE THE SOUND COMES OUT ===== */}
            <div className="rounded-md border p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <Label className="text-xs">Chime before the announcement</Label>
                  <p className="text-[11px] text-muted-foreground">
                    The sound that makes the room look up. The words only reach
                    someone already listening.
                  </p>
                </div>
                <Switch checked={cfg.announceChime}
                        onCheckedChange={v => patch({ announceChime: v })} />
              </div>

              {canChooseOutput() ? (
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Speaker className="h-3.5 w-3.5" /> Play the chime on
                  </Label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                      value={output}
                      onChange={e => { setOutput(e.target.value); saveAnnounceOutput(e.target.value); }}
                    >
                      <option value="default">System default</option>
                      {outputs.filter(o => o.deviceId !== 'default').map(o => (
                        <option key={o.deviceId} value={o.deviceId}>{o.label}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" onClick={testChime}>Test</Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Use this to send the chime to the dining-room speakers and
                    leave the rest of the computer's sound alone. <b>The spoken
                    part cannot be routed this way</b> — Windows produces it
                    outside the page and sends it to the app's own output, which
                    is set in Windows under Sound&nbsp;→&nbsp;Volume mixer.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This device cannot choose an output; sound follows the Windows
                  default.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== BANNERS ===== */}
      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label className="text-sm">Banners and video</Label>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                   onChange={e => addImages(e.target.files)} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <ImageIcon className="h-4 w-4 mr-1" /> Add image
            </Button>
            <Button size="sm" variant="outline" onClick={addVideo}>
              <Film className="h-4 w-4 mr-1" /> Add video
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowVideoUrl(v => !v)}>
              <LinkIcon className="h-4 w-4 mr-1" /> Video address
            </Button>
          </div>
        </div>

        {showVideoUrl && (
          <div className="rounded-md bg-muted/40 p-2.5 space-y-2">
            <Label className="text-xs">Video address</Label>
            <div className="flex gap-2">
              <Input
                className="h-9"
                placeholder="https://… or file:///C:/promo.mp4"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && pushVideo(videoUrl)) setVideoUrl(''); }}
              />
              <Button size="sm" disabled={!videoUrl.trim()}
                      onClick={() => { if (pushVideo(videoUrl)) setVideoUrl(''); }}>
                Add
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isElectron()
                ? 'For a file on this computer, Add video opens a file chooser — easier than typing a path.'
                : 'In the desktop app, Add video opens a file chooser for a video on that computer.'}
            </p>
          </div>
        )}

        {cfg.media.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No banners yet. Without any, the display shows only the order
            columns and uses the full width for them.
          </p>
        ) : (
          <div className="space-y-2">
            {cfg.media.map(m => {
              const open = openMedia === m.id;
              return (
                <div key={m.id} className="rounded-md border p-2 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-20 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0">
                      {m.kind === 'image'
                        ? <img src={m.src} alt="" style={mediaStyle(m) as React.CSSProperties} />
                        : <Film className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Input
                        placeholder="Caption (optional)"
                        value={m.caption || ''}
                        className="h-8 text-xs"
                        onChange={e => patchMedia(m.id, { caption: e.target.value })}
                      />
                      {m.kind === 'video' && (
                        <p className="text-[10px] text-muted-foreground truncate mt-1">{m.src}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setOpenMedia(open ? null : m.id)}
                            title="Size and position">
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  {open && (
                    <div className="rounded-md bg-muted/40 p-2.5 space-y-2.5">
                      <div className="space-y-1">
                        <Label className="text-xs">How it fills the panel</Label>
                        <div className="flex gap-1.5 flex-wrap">
                          {FITS.map(f => (
                            <Button
                              key={f.value}
                              type="button" size="sm"
                              variant={(m.fit || 'contain') === f.value ? 'default' : 'outline'}
                              className="h-7 text-xs"
                              onClick={() => patchMedia(m.id, { fit: f.value })}
                              title={f.hint}
                            >
                              {f.label}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {FITS.find(f => f.value === (m.fit || 'contain'))?.hint}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Position in the panel</Label>
                        <div className="flex gap-1.5 flex-wrap">
                          {POSITIONS.map(p => (
                            <Button
                              key={p}
                              type="button" size="sm"
                              variant={(m.position || 'center') === p ? 'default' : 'outline'}
                              className="h-7 text-xs capitalize"
                              onClick={() => patchMedia(m.id, { position: p })}
                            >
                              {p}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Width ({m.widthPct ?? 100}% of the panel)</Label>
                          <Input type="range" min={10} max={100} step={5}
                                 value={m.widthPct ?? 100}
                                 onChange={e => patchMedia(m.id, { widthPct: Number(e.target.value) })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Height ({m.heightPct ?? 100}% of the panel)</Label>
                          <Input type="range" min={10} max={100} step={5}
                                 value={m.heightPct ?? 100}
                                 onChange={e => patchMedia(m.id, { heightPct: Number(e.target.value) })} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Seconds on screen (blank uses the default)</Label>
                        <Input type="number" min={2} max={120} className="h-8 w-24"
                               placeholder={String(cfg.mediaSeconds)}
                               value={m.seconds ?? ''}
                               onChange={e => patchMedia(m.id, {
                                 seconds: e.target.value === '' ? undefined : Number(e.target.value),
                               })} />
                        {m.kind === 'video' && (
                          <p className="text-[11px] text-muted-foreground">
                            A video always plays to its end, so this is ignored for it.
                          </p>
                        )}
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Sizing is applied to the original file at display time —
                        nothing is re-saved, so the picture keeps the quality it
                        was uploaded at.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Seconds per banner</Label>
                <Input type="number" min={2} max={120} className="w-24"
                       value={cfg.mediaSeconds}
                       onChange={e => patch({ mediaSeconds: Number(e.target.value) || 8 })} />
              </div>
              <p className="text-xs text-muted-foreground pb-2">
                A video always plays to its end before the next item.
              </p>
            </div>
          </div>
        )}

        <p className={`text-xs ${sizeKb > SIZE_WARN_KB ? 'text-status-warning font-medium' : 'text-muted-foreground'}`}>
          Stored size: {sizeKb} KB
          {sizeKb > SIZE_WARN_KB && ' — close to this device\u2019s storage limit. Remove a banner before adding more.'}
        </p>
      </div>

      <Button onClick={openDisplay} disabled={!cfg.enabled}>
        <Monitor className="h-4 w-4 mr-1" /> Open Customer Display
      </Button>
      {!cfg.enabled && (
        <p className="text-xs text-muted-foreground">Enable the display above to open it.</p>
      )}
    </Card>
  );
}
