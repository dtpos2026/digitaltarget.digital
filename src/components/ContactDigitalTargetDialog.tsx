import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Phone, Mail, MessageCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

const PHONE = '03451873354';
const PHONE_DISPLAY = '0345-1873354';
const WHATSAPP_INTL = '923451873354'; // +92 345 1873354
const EMAIL = 'digitaltarget.digital@gmail.com';
const WHATSAPP_MSG = 'Hello, I would like an account for DT POS. Please send me the details.';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ContactDigitalTargetDialog({ open, onClose }: Props) {
  const copy = (text: string, label: string) => {
    try { navigator.clipboard?.writeText(text); toast.success(`${label} copied`); } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">
            <span className="block text-base">📞 Contact Digital Target</span>
            <span className="block text-[11px] font-normal text-muted-foreground mt-1">
              Contact us for a new account, a demo or support
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          {/* WhatsApp */}
          <a
            href={`https://wa.me/${WHATSAPP_INTL}?text=${encodeURIComponent(WHATSAPP_MSG)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-lg border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 px-3 py-3 transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold">WhatsApp Chat</p>
                <p className="text-[10px] text-muted-foreground">{PHONE_DISPLAY}</p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-green-700 dark:text-green-300">OPEN →</span>
          </a>

          {/* Call */}
          <a
            href={`tel:+92${WHATSAPP_INTL.slice(2)}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 px-3 py-3 transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Phone className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold">Call Now</p>
                <p className="text-[10px] text-muted-foreground">{PHONE_DISPLAY}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(PHONE, 'Number'); }}
              className="text-[10px] font-bold text-primary inline-flex items-center gap-1"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </a>

          {/* Email */}
          <a
            href={`mailto:${EMAIL}?subject=${encodeURIComponent('DT POS — Account Request')}&body=${encodeURIComponent(WHATSAPP_MSG)}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-3 transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold">Email</p>
                <p className="text-[10px] text-muted-foreground">{EMAIL}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(EMAIL, 'Email'); }}
              className="text-[10px] font-bold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </a>
        </div>

        <p className="text-center text-[10px] text-muted-foreground pt-1">
          © {new Date().getFullYear()} Digital Target — Burewala, Pakistan
        </p>
      </DialogContent>
    </Dialog>
  );
}
