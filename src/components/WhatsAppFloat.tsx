import { useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { getSettings } from '@/lib/store';

interface Props {
  /** Override message for context (e.g. order page) */
  message?: string;
  /** Override target number */
  number?: string;
}

/**
 * Floating WhatsApp button — fixed bottom-right.
 * Shows on the public website (Online Order / Track Order pages).
 * Number comes from settings.supportWhatsappNumber (fallback to phone1).
 */
export default function WhatsAppFloat({ message, number }: Props) {
  const settings = useMemo(() => {
    try { return getSettings(); } catch { return null as any; }
  }, []);
  if (!settings) return null;

  const enabled = settings.whatsappFloatingEnabled !== false; // default ON
  if (!enabled) return null;

  const raw = (number || settings.supportWhatsappNumber || settings.phone1 || '').toString();
  const phone = raw.replace(/[^\d]/g, '');
  if (phone.length < 8) return null;

  // If user typed local "03001234567" assume Pakistan and prepend 92
  const intl = phone.startsWith('0') ? '92' + phone.slice(1) : phone;

  const text = (message || settings.whatsappFloatingMessage ||
    `Hello ${settings.name || ''}! I wanted to ask about an order.`).trim();

  const href = `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed bottom-5 right-5 z-[9999] group"
    >
      <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-40 animate-ping" aria-hidden />
      <span className="relative flex items-center justify-center h-14 w-14 rounded-full bg-[#25D366] hover:bg-[#1ebe57] text-white shadow-2xl ring-2 ring-white transition-transform group-hover:scale-110">
        {/* WhatsApp SVG */}
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.15 1.6 5.96L2 22l4.27-1.12a9.94 9.94 0 0 0 5.77 1.84h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0 0 12.04 2zm0 18.06h-.01a8.16 8.16 0 0 1-4.16-1.14l-.3-.18-2.53.66.67-2.47-.19-.32a8.16 8.16 0 0 1-1.25-4.36c0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.39a8.11 8.11 0 0 1 2.39 5.78c0 4.5-3.66 8.16-8.16 8.16zm4.71-6.11c-.26-.13-1.52-.75-1.76-.83-.24-.09-.41-.13-.59.13-.17.26-.67.83-.82 1-.15.17-.3.19-.56.06-.26-.13-1.09-.4-2.08-1.28-.77-.69-1.29-1.53-1.44-1.79-.15-.26-.02-.4.11-.53.11-.11.26-.3.39-.45.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.59-1.42-.81-1.95-.21-.51-.43-.44-.59-.45h-.5c-.17 0-.45.06-.69.32-.24.26-.91.89-.91 2.17 0 1.28.93 2.52 1.06 2.69.13.17 1.83 2.8 4.43 3.93.62.27 1.11.43 1.49.55.62.2 1.19.17 1.64.1.5-.07 1.52-.62 1.74-1.22.22-.6.22-1.11.15-1.22-.06-.11-.24-.17-.5-.3z" />
        </svg>
      </span>
    </a>
  );
}
