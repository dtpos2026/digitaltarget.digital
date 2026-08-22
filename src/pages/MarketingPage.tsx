import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Megaphone, Upload, Download, Send, Trash2, Users, FileSpreadsheet, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  getOrders, getSettings,
  getMarketingContacts, saveMarketingContact, deleteMarketingContact,
  getMarketingTemplate, saveMarketingTemplate,
} from '@/lib/store';
import { openWhatsApp, normalizePhone } from '@/lib/whatsapp';

interface Contact {
  no: string;       // phone number
  name: string;
  category: string; // Dining / Takeaway / Delivery / Custom / Imported
}

const DEFAULT_TEMPLATE = `Assalam o Alaikum {name},

{restaurant} ki taraf se aap ke liye special offer hai!
🍔 Aaj kal ke menu par 10% off — yeh sab kuch dekhne aaiye.

Shukria!
{restaurant}`;

export default function MarketingPage() {
  const settings = getSettings();
  const [tab, setTab] = useState<'customers' | 'import'>('customers');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<'all' | 'dining' | 'takeaway' | 'delivery' | 'imported'>('all');
  const [imported, setImported] = useState<Contact[]>(() =>
    getMarketingContacts().map(c => ({ no: c.no, name: c.name, category: c.category }))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<string>(
    () => getMarketingTemplate() || DEFAULT_TEMPLATE
  );
  const [sending, setSending] = useState(false);

  useEffect(() => {
    saveMarketingTemplate(template);
  }, [template]);

  // Build customer list from orders (deduped by phone)
  const fromOrders: Contact[] = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const o of getOrders()) {
      const phone = o.customer?.phone || o.creditCustomerPhone || '';
      const name = o.customer?.name || o.creditCustomerName || '';
      if (!phone) continue;
      const key = phone.replace(/[^\d]/g, '');
      if (!key) continue;
      const cat = o.orderType === 'dining' ? 'Dining'
        : o.orderType === 'takeaway' ? 'Takeaway' : 'Delivery';
      if (!map.has(key)) map.set(key, { no: phone, name: name || 'Customer', category: cat });
    }
    return Array.from(map.values());
  }, []);

  const allContacts: Contact[] = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of [...fromOrders, ...imported]) {
      const key = (c.no || '').replace(/[^\d]/g, '');
      if (!key) continue;
      if (!map.has(key)) map.set(key, c);
    }
    return Array.from(map.values());
  }, [fromOrders, imported]);

  const filtered = allContacts.filter(c => {
    if (filterCat !== 'all') {
      const cat = c.category.toLowerCase();
      if (filterCat === 'imported' && cat !== 'imported') return false;
      if (filterCat !== 'imported' && cat !== filterCat) return false;
    }
    if (!search) return true;
    const s = search.toLowerCase();
    return c.name.toLowerCase().includes(s) || c.no.includes(s) || c.category.toLowerCase().includes(s);
  });

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.no)));
  };
  const toggleOne = (no: string) => {
    const s = new Set(selected);
    if (s.has(no)) s.delete(no); else s.add(no);
    setSelected(s);
  };

  // Excel import: expects columns No / Name / Category (order-agnostic, case-insensitive)
  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      const list: Contact[] = [];
      for (const r of rows) {
        const keys = Object.keys(r).reduce<Record<string, string>>((acc, k) => {
          acc[k.toLowerCase().trim()] = String(r[k] ?? '').trim();
          return acc;
        }, {});
        const no = keys['no'] || keys['number'] || keys['phone'] || keys['mobile'] || keys['contact'] || '';
        const name = keys['name'] || keys['customer'] || keys['customer name'] || '';
        const category = keys['category'] || keys['type'] || 'Imported';
        if (!no) continue;
        list.push({ no, name: name || 'Customer', category: category || 'Imported' });
      }
      if (!list.length) { toast.error('No valid rows found. Expected columns: No, Name, Category.'); return; }
      // Merge with existing imported
      const map = new Map(imported.map(c => [(c.no || '').replace(/[^\d]/g, ''), c]));
      for (const c of list) {
        const key = (c.no || '').replace(/[^\d]/g, '');
        if (!key) continue;
        map.set(key, c);
        saveMarketingContact({ id: key, no: c.no, name: c.name, category: c.category });
      }
      setImported(Array.from(map.values()));
      toast.success(`Imported ${list.length} contacts.`);
      setTab('customers');
    } catch (e: any) {
      toast.error('Failed to read Excel file: ' + (e?.message || 'invalid file'));
    }
  };

  const downloadSample = () => {
    const data = [
      { No: '0300-1234567', Name: 'Ali Khan', Category: 'Regular' },
      { No: '03211234567', Name: 'Sara Ahmed', Category: 'VIP' },
      { No: '+923331234567', Name: 'Bilal', Category: 'Imported' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'marketing-contacts-sample.xlsx');
  };

  const buildMessage = (c: Contact) =>
    template
      .replace(/\{name\}/gi, c.name || 'Customer')
      .replace(/\{restaurant\}/gi, settings.name || 'Our Restaurant')
      .replace(/\{category\}/gi, c.category || '')
      .replace(/\{phone\}/gi, c.no || '');

  const sendOne = (c: Contact) => {
    const phone = normalizePhone(c.no);
    if (!phone) { toast.error(`Invalid number: ${c.no}`); return; }
    openWhatsApp(phone, buildMessage(c), c.name);
  };

  const sendBulk = async () => {
    const list = allContacts.filter(c => selected.has(c.no));
    if (!list.length) { toast.error('Select at least one contact'); return; }
    setSending(true);
    toast.info(`Sending to ${list.length} — a WhatsApp window will open for each contact.`);
    for (let i = 0; i < list.length; i++) {
      sendOne(list[i]);
      // Small delay so popups/windows don't crash; user sends each then continues.
      await new Promise(r => setTimeout(r, 1500));
    }
    setSending(false);
    toast.success('Done. Check WhatsApp window/queue.');
  };

  const removeImported = (no: string) => {
    const key = (no || '').replace(/[^\d]/g, '');
    if (key) deleteMarketingContact(key);
    setImported(imported.filter(c => c.no !== no));
  };

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-[#25D366]" />
        <div>
          <h1 className="text-xl font-bold">Marketing — Bulk WhatsApp</h1>
          <p className="text-xs text-muted-foreground">Customer list + Excel import + auto-generated messages</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant="secondary">{allContacts.length} contacts</Badge>
          <Badge className="bg-[#25D366]">{selected.size} selected</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Left: contacts */}
        <Card className="p-3">
          <Tabs value={tab} onValueChange={v => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="customers"><Users className="h-3 w-3 mr-1" /> Customers</TabsTrigger>
              <TabsTrigger value="import"><FileSpreadsheet className="h-3 w-3 mr-1" /> Import Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="customers" className="space-y-3 mt-3">
              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / number / category..." />
                </div>
                {(['all', 'dining', 'takeaway', 'delivery', 'imported'] as const).map(c => (
                  <Button key={c} size="sm" variant={filterCat === c ? 'default' : 'outline'}
                    onClick={() => setFilterCat(c)} className="capitalize">{c}</Button>
                ))}
              </div>

              <div className="border rounded-md max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox checked={selected.size > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>No</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="w-32 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No contacts. Customers POS orders se aate hain ya Excel import karein.
                      </TableCell></TableRow>
                    )}
                    {filtered.map((c, i) => (
                      <TableRow key={c.no + i}>
                        <TableCell><Checkbox checked={selected.has(c.no)} onCheckedChange={() => toggleOne(c.no)} /></TableCell>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{c.no}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell><Badge variant="outline">{c.category}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe57] text-white h-7"
                            onClick={() => sendOne(c)}>
                            <Send className="h-3 w-3 mr-1" /> Send
                          </Button>
                          {c.category === 'Imported' && (
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => removeImported(c.no)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="import" className="space-y-3 mt-3">
              <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-sm">Upload an Excel file (.xlsx / .xls / .csv)</p>
                <p className="text-xs text-muted-foreground">
                  Columns: <b>No</b>, <b>Name</b>, <b>Category</b> (order kuch bhi ho, case-insensitive)
                </p>
                <div className="flex gap-2 justify-center">
                  <label>
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                    <Button asChild className="bg-[#25D366] hover:bg-[#1ebe57] text-white">
                      <span><Upload className="h-4 w-4 mr-2" /> Choose File</span>
                    </Button>
                  </label>
                  <Button variant="outline" onClick={downloadSample}>
                    <Download className="h-4 w-4 mr-2" /> Sample Excel
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Imported contacts <b>Customers tab</b> mein "Imported" category ke saath show honge. Phir select karke bulk send karein.
              </p>
            </TabsContent>
          </Tabs>
        </Card>

        {/* Right: template + send */}
        <Card className="p-3 space-y-3 h-fit sticky top-3">
          <h3 className="text-sm font-bold">Message Template</h3>
          <Textarea rows={10} value={template} onChange={e => setTemplate(e.target.value)} className="text-xs font-mono" />
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <p>Variables: <code>{'{name}'}</code> <code>{'{restaurant}'}</code> <code>{'{category}'}</code> <code>{'{phone}'}</code></p>
          </div>
          <div className="border rounded-md p-2 bg-muted/30">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Preview</p>
            <pre className="text-[11px] whitespace-pre-wrap leading-snug">
              {buildMessage(filtered[0] || { no: '03001234567', name: 'Customer', category: 'Regular' })}
            </pre>
          </div>
          <Button onClick={sendBulk} disabled={sending || selected.size === 0}
            className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white">
            <Send className="h-4 w-4 mr-2" /> Send to {selected.size} selected
          </Button>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Note: Har contact ke liye WhatsApp window/popup khulegi (browser limitation). Aap "Send" press karein,
            agla aa jayega 1.5s baad. Desktop .exe mein embedded module use hota hai.
          </p>
        </Card>
      </div>
    </div>
  );
}
