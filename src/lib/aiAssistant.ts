import { firestoreUnavailable } from './legacyFirebaseGuard';
// DT POS Assistant — built-in software guide.
// 100% local: no Gemini, no API key, no external calls. Knowledge-base driven.

import { fbDb } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export type AIMode = 'off' | 'manual' | 'ai' | 'ai_human';
export type IssueIntent = 'bug' | 'feature' | 'improvement' | 'urgent' | 'question';

export interface AIConfig {
  mode: AIMode;
  /** @deprecated kept for backward compat — DT POS Assistant chalanay ke liye key ki zaroorat nahi. */
  apiKey?: string;
  model?: string;
  updatedAt?: any;
}

const CFG_DOC = ['globalSettings', 'aiAssistant'] as const;

export async function getAIConfig(): Promise<AIConfig> {
    if (firestoreUnavailable()) return { mode: 'ai' };   // v1.21.0 — not ported to Supabase yet (ai assistant)
  try {
    const s = await getDoc(doc(fbDb(), CFG_DOC[0], CFG_DOC[1]));
    // Default mode = 'ai' (built-in DT POS Assistant on)
    if (!s.exists()) return { mode: 'ai' };
    const data = s.data() as AIConfig;
    return { ...data, mode: data.mode || 'ai' };
  } catch (e) {
    console.warn('getAIConfig', e);
    return { mode: 'ai' };
  }
}

export async function setAIConfig(cfg: Partial<AIConfig>) {
    if (firestoreUnavailable()) return;   // v1.21.0 — not ported to Supabase yet (ai assistant)
  await setDoc(
    doc(fbDb(), CFG_DOC[0], CFG_DOC[1]),
    { ...cfg, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/* ---------- Intent classifier ---------- */

const BUG_HINTS    = /\b(bug|error|crash|fail|kaam nahi|nahi chal|nahi ho|broken|hang|stuck|wrong|galat|problem|masla|issue|blank|print nahi)\b/i;
const FEATURE_HINTS= /\b(feature|chahiye|add karo|add kar|option ho|hona chahiye|request|suggest|naya|new|please add)\b/i;
const URGENT_HINTS = /\b(urgent|jaldi|abhi|emergency|critical|production|down|live)\b/i;

export function classifyIntent(text: string): IssueIntent {
  const t = (text || '').toLowerCase();
  if (URGENT_HINTS.test(t) && BUG_HINTS.test(t)) return 'urgent';
  if (BUG_HINTS.test(t)) return 'bug';
  if (FEATURE_HINTS.test(t)) return 'feature';
  if (URGENT_HINTS.test(t)) return 'urgent';
  return 'question';
}

/* ---------- Local DT POS Assistant Knowledge Bank ----------
   100% offline. No API key. Keyword-weighted scoring across all software modules. */

interface KBEntry {
  topic: string;
  keywords: RegExp;
  /** extra weight when these words also appear (boosts disambiguation) */
  boost?: RegExp;
  answer: string;
}

const KB: KBEntry[] = [
  {
    topic: 'Printer',
    keywords: /\b(printer|print|kot|receipt|slip|thermal|escpos|lan|usb|blank|paper|80mm|58mm|cashdraw)\b/i,
    boost: /\b(blank|nahi aata|not printing|setup|test)\b/i,
    answer:
`🖨️ **Printer Setup & Troubleshooting**

• **Settings → Printer Settings** kholein.
• **USB**: set the default printer in Windows → "Test Print".
• **LAN**: enter the IP and port 9100 → Test Print.
• Paper size: select 80mm or 58mm correctly.
• If a blank slip prints: check the paper width, reinstall the driver, check ESC/POS mode.
• KOT auto-print happens when "Send to Kitchen" is pressed in the POS.
• Older bills: the **Bill Reprint** page (with an audit log).
• Manual reprint: **Reprint Bill / Reprint KOT** options Bill page pe.`,
  },
  {
    topic: 'Deals & Variants',
    keywords: /\b(deal|combo|variant|variation|pizza|burger|size|small|medium|large|topping|modifier|addon|add-on)\b/i,
    answer:
`🍕 **Deal / Variant Setup**

• **Menu Manager → Variations & Deals** kholein.
• Add variants to an item (Small/Medium/Large) — each with its own price.
• To build a deal, tap items POS-style — the variant picker opens.
• Customer portal: variant items show "From Rs. ___" → clicking opens the picker.
• Tapping a variant item in the POS requires choosing a variant.
• The variant editor is 300px tall with internal scrolling.`,
  },
  {
    topic: 'Reports',
    keywords: /\b(report|sales|revenue|profit|kitna|earning|kharcha|advanced|gross|net|discount|profitability|costing)\b/i,
    answer:
`📊 **Reports Guide**

• **Reports Page**: Daily / Weekly / Monthly sales summary.
• **Advanced Reports**: Item-wise, variant-wise, category, subcategory — Qty, Gross, Discount, Net.
• **Profitability**: Recipe cost vs sale price, food cost %.
• **Costing Reports**: Wastage + receiving cost breakdown.
• All reports run on the **Business Day** engine (set the shift timing in Settings).
• PDF export aur 80mm thermal print dono available.`,
  },
  {
    topic: 'Login',
    keywords: /\b(login|sign in|signin|password|locked|lock|please wait|loading|email yaad|remember|save)\b/i,
    answer:
`🔐 **Login & Account**

• Check the email and password carefully (upper and lower case).
• **Remember Me** is now on by default — the email is saved on both Windows and web.
• Pressing "Switch Account" clears the saved email.
• The device must be approved — approve it from the Devices page.
• The POS locks when the plan expires — contact Digital Target.
• "Please Wait" stuck ho to Ctrl+R (Reload) .`,
  },
  {
    topic: 'Update',
    keywords: /\b(update|version|install|upgrade|setup|exe|windows app|new build|release)\b/i,
    answer:
`⬆️ **Update Guide**

• **Tenant → Version page** se "Check for Updates" .
• Download the new .exe → install → the app syncs its version to Firebase itself.
• An **automatic backup** is taken before updating (Zero Data Loss System).
• Update History: **Update Safety** page.
• The Super Admin can see the version and status of every device.`,
  },
  {
    topic: 'Backup',
    keywords: /\b(backup|restore|data loss|safety|rollback|repair|export|import)\b/i,
    answer:
`🛡️ **Data Safety**

• **Update Safety** page (#/update-safety) se manual backup len.
• Saved both to the cloud and locally.
• "Inspect & Repair" se database health check + auto-fix.
• Update install hone se pehle automatic snapshot Firestore me jata hai.
• Restore Super Admin ke through hota hai security ke liye.`,
  },
  {
    topic: 'Inventory',
    keywords: /\b(inventory|stock|kg|gram|litre|liter|pcs|piece|recipe|ingredient|wastage|receiving|supplier|party)\b/i,
    answer:
`📦 **Inventory & Recipes**

• **Inventory**: Stock units (Kg / Gram / Litre / Pcs).
• **Receiving**: Supplier (Party Master) se stock add with cost.
• **Recipes**: Har item ke ingredients define karein → order par auto deduct.
• **Wastage**: Reason ke saath spoilage record → profit me deduct.
• **Costing Report**: Actual food cost % nikalti hai.`,
  },
  {
    topic: 'Foodpanda',
    keywords: /\b(foodpanda|food panda|aggregator|3rd party|third party)\b/i,
    answer:
`🛵 **Foodpanda Mode**

• Settings me "Enable Foodpanda Mode" toggle ON karein.
• POS me extra order type button aata hai.
• **Foodpanda Orders** page: New → Preparing → Ready → Picked → Delivered.
• Separate filter aur report bhi.`,
  },
  {
    topic: 'Customers',
    keywords: /\b(customer|crm|loyalty|phone|address|blocked|caller|repeat)\b/i,
    answer:
`👥 **Customer Management**

• **Customers Page**: Phone number se add — name, address, loyalty points.
• **CRM Insights**: Top customers, repeat rate.
• **Blocked Customers / Locations**: Spam ya fake orders block karein.
• POS pe phone enter karte hi customer auto-fill hota hai.`,
  },
  {
    topic: 'Riders',
    keywords: /\b(rider|delivery boy|driver|pin|map|gps|live|tracking|dispatch)\b/i,
    answer:
`🏍️ **Riders & Delivery**

• **Riders List**: phone + 4-digit PIN ke saath add karein.
• Rider Public URL → PIN se login → claim orders.
• **Live Riders Map**: real-time GPS tracking.
• **Delivery Board**: assignment + status dashboard.
• Rider pickup karte hi order Kitchen Display se auto clear ho jata hai.`,
  },
  {
    topic: 'Business Day',
    keywords: /\b(business day|shift|timing|date range|kal|aaj|late night|opening|closing)\b/i,
    answer:
`⏰ **Business Day Engine**

• Settings → "Business Day Timing" me shift set karein (e.g. 08:00 to 03:00 next day).
• Sab dashboards aur reports usi shift window pe sales group karte hain.
• Calendar date ki bajaye shift-based grouping — late night sales sahi din ko milti hain.`,
  },
  {
    topic: 'Users & Roles',
    keywords: /\b(user|role|permission|access|cashier|manager|waiter|kitchen staff|staff add)\b/i,
    answer:
`👤 **Users & Roles**

• **Users & Roles** page se naye staff add karein.
• Roles: Owner, Manager, Cashier, Waiter, Kitchen, Rider.
• Per-page access toggle ho sakti hai.
• Sensitive actions (discount, void, bill edit) role-based locked hain.
• Bill Editor sirf Admin / Manager ko milta hai with audit history.`,
  },
  {
    topic: 'Online Portal',
    keywords: /\b(online|website|portal|qr code|menu link|public|web order)\b/i,
    answer:
`🌐 **Online Ordering**

• **Online Portal** page se public website link enable karein.
• Customer order → Owner approval → POS me enter.
• Menu items me "Show on website" toggle ON karein.
• Variant items "From Rs. ___" show hote hain.
• Tables ke QR codes **Tables Page** se generate karein.`,
  },
  {
    topic: 'Subscription',
    keywords: /\b(subscription|plan|expire|renew|payment|billing|invoice|trial)\b/i,
    answer:
`💳 **Subscription**

• Plans: Trial, Basic, Standard, Pro.
• Renewal Super Admin manage karta hai.
• Plan expire hone par POS lock ho jata hai.
• Renewal: 📧 digitaltarget.digital@gmail.com`,
  },
  {
    topic: 'Devices',
    keywords: /\b(device|approve|new device|hardware|monitor|block device|delete device|machine|computer)\b/i,
    answer:
`💻 **Device Control (Restaurant Admin)**

• **Devices Page** (Admin sidebar) se aapne device khud manage kar saktay hain.
• **Actions**: Approve · Block / Unblock · Delete · PDF Ledger.
• Naya device pehli baar login kare to pending hota hai — plan limit ke andar auto-approve hota hai.
• Super Admin bhi live activity (Online/Offline, Last Seen) dekh sakta hai.
• Block / Delete karne par woh device foran logout ho jata hai.`,
  },
  {
    topic: 'Sync',
    keywords: /\b(sync|offline|internet|firebase|cloud|realtime|onsnapshot|slow)\b/i,
    answer:
`☁️ **Sync & Offline**

• App offline kaam karti hai — orders local me save hote hain.
• Internet wapas aate hi auto-sync.
• Sync status badge sidebar me dikhta hai.
• Firestore realtime listeners (onSnapshot) se products / orders live update hote hain.
• Slow sync ke liye Settings → Inspect & Repair instead.`,
  },
  {
    topic: 'Running / Hold Bills',
    keywords: /\b(running|retry|hold|unpaid|pending bill|open bill|kot bill)\b/i,
    answer:
`🧾 **Running / Retry / Hold Bills**

• Jab tak bill Pay na ho, woh Running/Retry/Hold se nahi hatta.
• Unpaid bills pe red **UNPAID** badge lagta hai.
• Delivery bill pe 🛵 Rider name, Dining bill pe 🧑‍🍳 Waiter name show hota hai.
• Paid hone ke baad hi report me count hota hai.`,
  },
  {
    topic: 'Bill Edit',
    keywords: /\b(bill edit|edit bill|change quantity|remove item|discount edit|recalculate|audit)\b/i,
    answer:
`✏️ **Bill Editor (Admin / Manager)**

• Item add / edit / remove / quantity change.
• Discount add / edit / remove with auto total recalculation.
• Sirf Admin / Manager access.
• Har change ki **audit history**: kisne kiya, kab kiya.`,
  },
  {
    topic: 'KDS',
    keywords: /\b(kds|kitchen display|kitchen screen|delayed|preparing|ready ticket)\b/i,
    answer:
`👨‍🍳 **Kitchen Display (KDS)**

• Sirf active orders show hote hain: Pending / Preparing / In Progress.
• Served / Dispatched / Delivered / Paid orders auto-remove ho jate hain.
• Rider pickup karte hi delivery order KDS se nikal jata hai.
• Delayed status sirf tab dikhta hai jab order waqai stuck ho.`,
  },
  {
    topic: 'Duplicate KOT',
    keywords: /\b(duplicate|double print|double kot|same order twice)\b/i,
    answer:
`🛑 **Duplicate KOT / Order Prevention**

• Order create button pe 4-second signature lock — double-click pe duplicate nahi banta.
• Ek order pe ek hi KOT print.
• Print queue level pe bhi dedupe.
• Manual reprint alag section se: Reprint Bill / Reprint KOT.`,
  },
  {
    topic: 'WhatsApp',
    keywords: /\b(whatsapp|wa|message customer|broadcast)\b/i,
    answer:
`💬 **WhatsApp**

• **WhatsApp Page** se customer ko receipt / order update bhejein.
• Marketing contacts panel se broadcast filter.
• Floating WA button har page pe.`,
  },
  {
    topic: 'Super Admin',
    keywords: /\b(super admin|portfolio|all restaurants|fleet|global)\b/i,
    answer:
`👑 **Super Admin Tools**

• **Portfolio Dashboard**: total sale, orders, revenue across all restaurants.
• **Versions Page**: fleet version + update status.
• **AI Assistant Inbox**: restaurant messages forward yahan hote hain.
• **Update Safety Page**: backups + repair history.
• **Live Map**: device locations real-time.`,
  },
  {
    topic: 'Contact',
    keywords: /\b(contact|support|help|email|whatsapp number|phone number|digital target)\b/i,
    answer:
`📞 **Digital Target Support**

• 📧 **digitaltarget.digital@gmail.com**
• ☎ 0345-1873354
• In-app: Support Chat Widget (Dashboard / Settings page ke neechay).`,
  },
  {
    topic: 'Greeting',
    keywords: /\b(hello|salam|hi|hey|assalam|good morning|good evening|thank you|thanks|theek|ok)\b/i,
    answer:
`👋 **Assalam-o-Alaikum!**

Main **DT POS Assistant** hoon — aap ka built-in software guide.
Mujh se aap puchein:
• 🖨️ Printer · 📊 Reports · 🍕 Deal/Variant
• 📦 Inventory · 🛵 Foodpanda · 🏍️ Riders
• 💻 Devices · ⬆️ Update · 🛡️ Backup
• 🧾 Running/Hold Bills · ✏️ Bill Edit · 👨‍🍳 KDS
• 💳 Subscription · 👥 Customers · 👤 Users

Ya koi bhi masla likhein — agar mujhe pakka jawab na mile, Super Admin ko forward kar dunga.`,
  },
];

function buildFallback(): string {
  const topics = Array.from(new Set(KB.map(k => k.topic))).filter(t => t !== 'Greeting');
  return `🤔 Main is sawaal ka exact jawab confirm nahi kar saka.

Aap in topics me se koi keyword likhein:
${topics.map(t => `• ${t}`).join('\n')}

Ya sawaal thori detail me likhein (e.g. "LAN printer setup", "deal banana", "bill edit history").

📩 Aap ka message **Digital Target Support team** ko forward kar diya gaya hai.
📧 digitaltarget.digital@gmail.com`;
}

/* ---------- Public reply generator ---------- */

export interface AIReplyInput {
  userMessage: string;
  category?: string;
  restaurantName?: string;
  branchName?: string;
  userName?: string;
  version?: string;
  history?: { from: 'owner' | 'admin'; body: string }[];
}

function scoreEntry(msg: string, entry: KBEntry): number {
  const matches = msg.match(new RegExp(entry.keywords.source, 'gi'));
  if (!matches) return 0;
  let score = matches.length * 2;
  if (entry.boost) {
    const b = msg.match(new RegExp(entry.boost.source, 'gi'));
    if (b) score += b.length * 3;
  }
  // Topic name mention boost
  if (msg.toLowerCase().includes(entry.topic.toLowerCase())) score += 4;
  return score;
}

export async function generateAIReply(input: AIReplyInput): Promise<string> {
  await new Promise(r => setTimeout(r, 250));

  const msg = (input.userMessage || '').trim();
  if (!msg) return buildFallback();

  // Score every KB entry, pick top 2 — combine if very close
  const scored = KB.map(entry => ({ entry, score: scoreEntry(msg, entry) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const intent = classifyIntent(msg);
  const greet = input.userName ? `Ji ${input.userName}, ` : '';

  if (scored.length > 0) {
    const top = scored[0];
    let reply = `${greet}\n\n${top.entry.answer}`;

    // If a second topic also scored close, append a "related" hint
    if (scored.length > 1 && scored[1].score >= Math.max(2, top.score - 2) && scored[1].entry.topic !== top.entry.topic) {
      reply += `\n\n🔗 **Related**: you can also ask about ${scored[1].entry.topic}.`;
    }

    if (intent === 'bug' || intent === 'urgent') {
      reply += `\n\n📩 This issue has been forwarded to the **Digital Target Support team** — they will follow up shortly.`;
    } else if (intent === 'feature') {
      reply += `\n\n✨ Your feature request has been noted — the team will review it.`;
    }
    return reply.trim();
  }

  return `${greet}\n\n${buildFallback()}`;
}

