import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  getAccountCategories, saveAccountCategory, deleteAccountCategory,
  getTransactions, saveTransaction, deleteTransaction,
  getParties, saveParty, deleteParty,
  getLedger, addLedgerEntry,
  getDailyCashCloses, saveDailyCashClose, deleteDailyCashClose,
  getOrders, genId,
  getPaymentAccounts, savePaymentAccount, deletePaymentAccount,
} from '@/lib/store';
import { Transaction, Party, AccountCategory, DailyCashClose, PaymentAccount, PaymentAccountType } from '@/lib/types';
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown, Users2, BookOpen, Calculator, FileText, Landmark, FileDown, Printer } from 'lucide-react';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfHeader, drawPdfFooter, getThemePrimaryRgb } from '@/lib/pdfBrand';

function fmt(n: number) { return 'Rs. ' + Math.round(n || 0).toLocaleString(); }

function buildAccountsPdfA4() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const [tr, tg, tb] = getThemePrimaryRgb();

  let y = drawPdfHeader(doc, { title: 'Accounts Ledger Report' });

  // Summary
  const txns = getTransactions();
  const orders = getOrders().filter(o => o.status === 'paid');
  const totalIncome = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    + orders.reduce((s, o) => s + o.grandTotal, 0);
  const totalExpense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit = totalIncome - totalExpense;
  const parties = getParties();
  const ledger = getLedger();
  const payAccounts = getPaymentAccounts();

  autoTable(doc, {
    startY: y,
    head: [['Summary', 'Amount (PKR)']],
    body: [
      ['Total Income (Sales + Other)', fmt(totalIncome)],
      ['Total Expense', fmt(totalExpense)],
      ['Net Profit', fmt(profit)],
      ['Active Parties', String(parties.length)],
      ['Payment Accounts', String(payAccounts.length)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [tr, tg, tb], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    margin: { left: 10, right: 10 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Payment Accounts
  if (payAccounts.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Payment Accounts', 10, y); y += 2;
    autoTable(doc, {
      startY: y + 1,
      head: [['Type', 'Name', 'Account #', 'Title', 'Received']],
      body: payAccounts.map(a => {
        const recv = orders.filter(o => o.paymentAccountId === a.id).reduce((s, o) => s + o.grandTotal, 0) + (a.openingBalance || 0);
        return [a.type.toUpperCase(), a.name, a.accountNumber || '—', a.accountTitle || '—', fmt(recv)];
      }),
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: 10, right: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // Income
  const incomeList = txns.filter(t => t.type === 'income').sort((a, b) => b.date.localeCompare(a.date));
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Income Entries', 10, y);
  autoTable(doc, {
    startY: y + 2,
    head: [['Date', 'Category', 'Description', 'Party', 'Method', 'Amount']],
    body: incomeList.length ? incomeList.map(t => [t.date, t.categoryName, t.description || '—', t.partyName || '—', t.paymentMethod, fmt(t.amount)])
      : [['—', '—', 'No entries', '—', '—', '—']],
    foot: incomeList.length ? [['', '', '', '', 'Total', fmt(incomeList.reduce((s, t) => s + t.amount, 0))]] : undefined,
    theme: 'grid',
    headStyles: { fillColor: [22, 163, 74], textColor: 255 },
    footStyles: { fillColor: [220, 252, 231], textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 8 },
    margin: { left: 10, right: 10 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Expense
  const expList = txns.filter(t => t.type === 'expense').sort((a, b) => b.date.localeCompare(a.date));
  if (y > 240) { doc.addPage(); y = 15; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Expense Entries', 10, y);
  autoTable(doc, {
    startY: y + 2,
    head: [['Date', 'Category', 'Description', 'Party', 'Method', 'Amount']],
    body: expList.length ? expList.map(t => [t.date, t.categoryName, t.description || '—', t.partyName || '—', t.paymentMethod, fmt(t.amount)])
      : [['—', '—', 'No entries', '—', '—', '—']],
    foot: expList.length ? [['', '', '', '', 'Total', fmt(expList.reduce((s, t) => s + t.amount, 0))]] : undefined,
    theme: 'grid',
    headStyles: { fillColor: [220, 38, 38], textColor: 255 },
    footStyles: { fillColor: [254, 226, 226], textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 8 },
    margin: { left: 10, right: 10 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // All Parties Ledger
  doc.addPage(); y = drawPdfHeader(doc, { title: 'Complete Party Ledgers' });

  parties.forEach((p, idx) => {
    const entries = ledger.filter(l => l.partyId === p.id).sort((a, b) => a.date.localeCompare(b.date));
    const balance = (p.openingBalance || 0) + entries.reduce((s, e) => s + e.debit - e.credit, 0);
    if (y > 250) { doc.addPage(); y = drawPdfHeader(doc, { title: 'Complete Party Ledgers (cont.)' }); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`${idx + 1}. ${p.name}  (${p.type})  ${p.phone || ''}`, 10, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Balance: ${fmt(Math.abs(balance))} ${balance >= 0 ? '(They owe)' : '(We owe)'}`, W - 10, y, { align: 'right' });
    autoTable(doc, {
      startY: y + 2,
      head: [['Date', 'Description', 'Reference', 'Debit', 'Credit']],
      body: [
        ['—', 'Opening Balance', '', p.openingBalance > 0 ? fmt(p.openingBalance) : '—', p.openingBalance < 0 ? fmt(-p.openingBalance) : '—'],
        ...entries.map(e => [e.date, e.description || '—', e.reference || '—', e.debit > 0 ? fmt(e.debit) : '—', e.credit > 0 ? fmt(e.credit) : '—']),
      ],
      foot: [['', '', 'Closing Balance', balance >= 0 ? fmt(balance) : '—', balance < 0 ? fmt(-balance) : '—']],
      theme: 'grid',
      headStyles: { fillColor: [tr, tg, tb], textColor: 255 },
      footStyles: { fillColor: [237, 233, 254], textColor: 0, fontStyle: 'bold' },
      styles: { fontSize: 8 },
      margin: { left: 10, right: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  });

  drawPdfFooter(doc);
  doc.save(`accounts-ledger-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function buildAccountsPdf80mm() {
  // 80mm wide, auto height
  const txns = getTransactions();
  const orders = getOrders().filter(o => o.status === 'paid');
  const parties = getParties();
  const ledger = getLedger();
  const brand = localStorage.getItem('pos-brand-name') || 'DT POS';

  // Estimate height
  const estLines = 40 + parties.reduce((s, p) => s + 4 + ledger.filter(l => l.partyId === p.id).length, 0)
    + txns.length;
  const height = Math.max(150, estLines * 4 + 40);

  const doc = new jsPDF({ unit: 'mm', format: [80, height] });
  const W = 80;
  let y = 6;
  const center = (t: string, size = 9, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    doc.text(t, W / 2, y, { align: 'center' }); y += size * 0.45 + 1;
  };
  const line = (char = '-') => { doc.setFont('courier', 'normal'); doc.setFontSize(8); doc.text(char.repeat(42), W / 2, y, { align: 'center' }); y += 3; };
  const row = (l: string, r: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8);
    doc.text(l, 3, y); doc.text(r, W - 3, y, { align: 'right' }); y += 3.5;
  };
  const wrap = (t: string, size = 7) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
    const lines = doc.splitTextToSize(t, W - 6);
    lines.forEach((ln: string) => { doc.text(ln, 3, y); y += size * 0.42 + 0.5; });
  };

  center(brand, 11, true);
  center('Accounts Ledger Report', 9, true);
  center(new Date().toLocaleString(), 7);
  line('=');

  const totalIncome = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    + orders.reduce((s, o) => s + o.grandTotal, 0);
  const totalExpense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  center('SUMMARY', 9, true); line();
  row('Total Income', fmt(totalIncome));
  row('Total Expense', fmt(totalExpense));
  row('Net Profit', fmt(totalIncome - totalExpense), true);
  line('=');

  // Income
  const incList = txns.filter(t => t.type === 'income');
  center('INCOME', 9, true); line();
  if (!incList.length) { wrap('No income entries'); }
  incList.forEach(t => {
    row(`${t.date}  ${t.categoryName}`.slice(0, 30), fmt(t.amount));
    if (t.description) wrap(`  ${t.description}`, 6);
  });
  row('Total', fmt(incList.reduce((s, t) => s + t.amount, 0)), true);
  line('=');

  // Expense
  const expList = txns.filter(t => t.type === 'expense');
  center('EXPENSES', 9, true); line();
  if (!expList.length) { wrap('No expense entries'); }
  expList.forEach(t => {
    row(`${t.date}  ${t.categoryName}`.slice(0, 30), fmt(t.amount));
    if (t.description) wrap(`  ${t.description}`, 6);
  });
  row('Total', fmt(expList.reduce((s, t) => s + t.amount, 0)), true);
  line('=');

  // Ledgers
  center('PARTY LEDGERS', 9, true); line();
  parties.forEach(p => {
    const ents = ledger.filter(l => l.partyId === p.id).sort((a, b) => a.date.localeCompare(b.date));
    const bal = (p.openingBalance || 0) + ents.reduce((s, e) => s + e.debit - e.credit, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(`${p.name} (${p.type})`, 3, y); y += 3.5;
    if (p.phone) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(p.phone, 3, y); y += 3; }
    row('Opening', fmt(p.openingBalance));
    ents.forEach(e => {
      const txt = `${e.date} ${(e.description || '').slice(0, 18)}`;
      const amt = e.debit > 0 ? `D ${fmt(e.debit)}` : `C ${fmt(e.credit)}`;
      row(txt, amt);
    });
    row('Balance', `${fmt(Math.abs(bal))} ${bal >= 0 ? '(DR)' : '(CR)'}`, true);
    line();
  });

  center('Powered by Digital Target', 7);
  center('DT POS Cloud', 7);

  doc.save(`accounts-80mm-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function AccountsPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Wallet className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Accounts</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { try { buildAccountsPdfA4(); toast.success('PDF report generated'); } catch (e: any) { toast.error(e?.message || 'PDF failed'); } }}>
            <FileDown className="h-4 w-4 mr-1" /> Full Report (A4)
          </Button>
          <Button size="sm" variant="outline" onClick={() => { try { buildAccountsPdf80mm(); toast.success('80mm receipt generated'); } catch (e: any) { toast.error(e?.message || 'PDF failed'); } }}>
            <Printer className="h-4 w-4 mr-1" /> POS 80mm Report
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="overview"><FileText className="h-4 w-4 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="payaccts"><Landmark className="h-4 w-4 mr-1" />Payment A/Cs</TabsTrigger>
          <TabsTrigger value="income"><TrendingUp className="h-4 w-4 mr-1" />Income</TabsTrigger>
          <TabsTrigger value="expense"><TrendingDown className="h-4 w-4 mr-1" />Expense</TabsTrigger>
          <TabsTrigger value="parties"><Users2 className="h-4 w-4 mr-1" />Parties</TabsTrigger>
          <TabsTrigger value="ledger"><BookOpen className="h-4 w-4 mr-1" />Ledger</TabsTrigger>
          <TabsTrigger value="cashclose"><Calculator className="h-4 w-4 mr-1" />Cash Close</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="payaccts"><PaymentAccountsTab /></TabsContent>
        <TabsContent value="income"><TxnTab type="income" /></TabsContent>
        <TabsContent value="expense"><TxnTab type="expense" /></TabsContent>
        <TabsContent value="parties"><PartiesTab /></TabsContent>
        <TabsContent value="ledger"><LedgerTab /></TabsContent>
        <TabsContent value="cashclose"><CashCloseTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  const txns = getTransactions();
  const orders = getOrders().filter(o => o.status === 'paid');
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7);

  const todayIncome = txns.filter(t => t.type === 'income' && t.date.startsWith(today)).reduce((s, t) => s + t.amount, 0)
    + orders.filter(o => o.paidAt?.startsWith(today)).reduce((s, o) => s + o.grandTotal, 0);
  const todayExpense = txns.filter(t => t.type === 'expense' && t.date.startsWith(today)).reduce((s, t) => s + t.amount, 0);
  const monthIncome = txns.filter(t => t.type === 'income' && t.date.startsWith(monthStart)).reduce((s, t) => s + t.amount, 0)
    + orders.filter(o => o.paidAt?.startsWith(monthStart)).reduce((s, o) => s + o.grandTotal, 0);
  const monthExpense = txns.filter(t => t.type === 'expense' && t.date.startsWith(monthStart)).reduce((s, t) => s + t.amount, 0);

  const parties = getParties();
  const ledger = getLedger();
  const receivables = parties.filter(p => p.type === 'customer').reduce((s, p) => {
    const bal = p.openingBalance + ledger.filter(l => l.partyId === p.id).reduce((x, l) => x + l.debit - l.credit, 0);
    return s + Math.max(0, bal);
  }, 0);
  const payables = parties.filter(p => p.type === 'supplier').reduce((s, p) => {
    const bal = -p.openingBalance + ledger.filter(l => l.partyId === p.id).reduce((x, l) => x + l.credit - l.debit, 0);
    return s + Math.max(0, bal);
  }, 0);

  const Stat = ({ label, value, color }: any) => (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${color || ''}`}>{money(Math.round(value))}</div>
    </Card>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Today Income" value={todayIncome} color="text-green-600" />
      <Stat label="Today Expense" value={todayExpense} color="text-red-600" />
      <Stat label="Today Profit" value={todayIncome - todayExpense} color={todayIncome - todayExpense >= 0 ? 'text-green-600' : 'text-red-600'} />
      <Stat label="Today Net Cash" value={todayIncome - todayExpense} />
      <Stat label="Month Income" value={monthIncome} color="text-green-600" />
      <Stat label="Month Expense" value={monthExpense} color="text-red-600" />
      <Stat label="Receivables (We get)" value={receivables} color="text-blue-600" />
      <Stat label="Payables (We owe)" value={payables} color="text-orange-600" />
    </div>
  );
}

function TxnTab({ type }: { type: 'income' | 'expense' }) {
  const [txns, setTxns] = useState(getTransactions());
  const [cats, setCats] = useState(getAccountCategories());
  const parties = getParties();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Transaction>({
    id: '', date: new Date().toISOString().split('T')[0], type, categoryId: '', categoryName: '',
    amount: 0, paymentMethod: 'cash', description: '', reference: '', partyId: '', partyName: '',
  });
  const [newCat, setNewCat] = useState('');

  const refresh = () => setTxns([...getTransactions()]);
  const refreshCats = () => setCats([...getAccountCategories()]);

  const list = txns.filter(t => t.type === type).sort((a, b) => b.date.localeCompare(a.date));
  const typeCats = cats.filter(c => c.type === type);
  const total = list.reduce((s, t) => s + t.amount, 0);

  const handleSave = () => {
    if (!form.categoryId || form.amount <= 0) { toast.error('Fill amount and category'); return; }
    const cat = cats.find(c => c.id === form.categoryId);
    const party = parties.find(p => p.id === form.partyId);
    saveTransaction({ ...form, id: genId(), categoryName: cat?.name || '', partyName: party?.name });
    refresh(); setOpen(false);
    setForm({ id: '', date: new Date().toISOString().split('T')[0], type, categoryId: '', categoryName: '', amount: 0, paymentMethod: 'cash', description: '', reference: '', partyId: '', partyName: '' });
    toast.success(type === 'income' ? 'Income added' : 'Expense added');
  };

  const addCat = () => {
    if (!newCat.trim()) return;
    saveAccountCategory({ id: genId(), name: newCat.trim(), type });
    setNewCat(''); refreshCats();
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h3 className="font-semibold capitalize">{type}</h3>
          <div className="text-sm text-muted-foreground">Total: <span className="font-bold">{money(total)}</span></div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add {type}</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead>Party</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {list.map(t => (
            <TableRow key={t.id}>
              <TableCell>{t.date}</TableCell><TableCell>{t.categoryName}</TableCell>
              <TableCell>{t.description}</TableCell><TableCell>{t.partyName || '—'}</TableCell>
              <TableCell><Badge variant="outline">{t.paymentMethod}</Badge></TableCell>
              <TableCell className="text-right font-medium">{money(t.amount)}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => { if (confirm('Delete?')) { deleteTransaction(t.id); refresh(); } }}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No entries</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {type}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></div>
            </div>
            <div><Label>Category</Label>
              <div className="flex gap-2">
                <Select value={form.categoryId} onValueChange={v => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{typeCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 mt-1">
                <Input placeholder="New category" value={newCat} onChange={e => setNewCat(e.target.value)} className="text-xs" />
                <Button size="sm" variant="outline" onClick={addCat}>+</Button>
              </div>
            </div>
            <div><Label>Payment Method</Label>
              <Select value={form.paymentMethod} onValueChange={(v: any) => setForm({ ...form, paymentMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem>
                  <SelectItem value="online">Online</SelectItem><SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Party (optional)</Label>
              <Select value={form.partyId || 'none'} onValueChange={v => setForm({ ...form, partyId: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {parties.filter(p => type === 'expense' ? p.type === 'supplier' : p.type === 'customer').map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PartiesTab() {
  const [parties, setParties] = useState(getParties());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Party>({ id: '', type: 'supplier', name: '', phone: '', address: '', openingBalance: 0, isActive: true });
  const refresh = () => setParties([...getParties()]);

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-semibold">Parties (Suppliers & Customers)</h3>
        <Button size="sm" onClick={() => { setForm({ id: '', type: 'supplier', name: '', phone: '', address: '', openingBalance: 0, isActive: true }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Party</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Opening</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {parties.map(p => (
            <TableRow key={p.id}>
              <TableCell><Badge variant={p.type === 'supplier' ? 'secondary' : 'default'}>{p.type}</Badge></TableCell>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>{p.phone}</TableCell>
              <TableCell>{money(p.openingBalance)}</TableCell>
              <TableCell>{p.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => { if (confirm('Delete?')) { deleteParty(p.id); refresh(); } }}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {parties.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No parties</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Party</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v: any) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="supplier">Supplier</SelectItem><SelectItem value="customer">Customer</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Opening Balance (+ they owe us / - we owe them)</Label><Input type="number" value={form.openingBalance} onChange={e => setForm({ ...form, openingBalance: Number(e.target.value) })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => { if (!form.name) { toast.error('Name required'); return; } saveParty({ ...form, id: genId() }); refresh(); setOpen(false); toast.success('Saved'); }}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LedgerTab() {
  const parties = getParties();
  const ledger = getLedger();
  const [partyId, setPartyId] = useState(parties[0]?.id || '');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], description: '', debit: 0, credit: 0, reference: '' });

  const party = parties.find(p => p.id === partyId);
  const entries = ledger.filter(l => l.partyId === partyId).sort((a, b) => a.date.localeCompare(b.date));
  const balance = (party?.openingBalance || 0) + entries.reduce((s, e) => s + e.debit - e.credit, 0);

  const handleAdd = () => {
    if (!partyId) return;
    addLedgerEntry({ id: genId(), partyId, ...form });
    setForm({ date: new Date().toISOString().split('T')[0], description: '', debit: 0, credit: 0, reference: '' });
    setOpen(false);
    toast.success('Entry added');
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <Label>Party:</Label>
        <Select value={partyId} onValueChange={setPartyId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{parties.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.type})</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!partyId}><Plus className="h-4 w-4 mr-1" />Entry</Button>
        <div className="ml-auto font-bold">
          Balance: <span className={balance >= 0 ? 'text-green-600' : 'text-red-600'}>{money(Math.abs(balance))} {balance >= 0 ? '(They owe)' : '(We owe)'}</span>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
        <TableBody>
          {party && <TableRow><TableCell colSpan={3} className="font-medium">Opening Balance</TableCell><TableCell className="text-right">{party.openingBalance > 0 ? `${money(party.openingBalance)}` : '—'}</TableCell><TableCell className="text-right">{party.openingBalance < 0 ? `${money(-party.openingBalance)}` : '—'}</TableCell></TableRow>}
          {entries.map(e => (
            <TableRow key={e.id}>
              <TableCell>{e.date}</TableCell><TableCell>{e.description}</TableCell><TableCell>{e.reference}</TableCell>
              <TableCell className="text-right">{e.debit > 0 ? `${money(e.debit)}` : '—'}</TableCell>
              <TableCell className="text-right">{e.credit > 0 ? `${money(e.credit)}` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Ledger Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Debit (they owe)</Label><Input type="number" value={form.debit} onChange={e => setForm({ ...form, debit: Number(e.target.value) })} /></div>
              <div><Label>Credit (payment)</Label><Input type="number" value={form.credit} onChange={e => setForm({ ...form, credit: Number(e.target.value) })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={handleAdd}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CashCloseTab() {
  const [closes, setCloses] = useState(getDailyCashCloses());
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [notes, setNotes] = useState('');

  const orders = getOrders().filter(o => o.status === 'paid' && o.paidAt?.startsWith(date) && o.paymentMethod === 'cash');
  const txns = getTransactions().filter(t => t.date === date && t.paymentMethod === 'cash');
  const totalSales = orders.reduce((s, o) => s + o.grandTotal, 0);
  const cashIncome = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const cashExpense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const expected = opening + totalSales + cashIncome - cashExpense;
  const diff = counted - expected;

  // Pending credit (carry-forward) — never closed by Close Day
  const pendingCreditOrders = getOrders().filter(o =>
    (o.status === 'credit_pending') ||
    (o.paymentMethod === 'credit' && o.status !== 'credit_received' && o.status !== 'void' && o.status !== 'cancelled')
  );
  const pendingCreditTotal = pendingCreditOrders.reduce((s, o) => s + o.grandTotal, 0);

  const handleClose = () => {
    saveDailyCashClose({
      id: genId(), date, openingCash: opening, totalSales, totalExpense: cashExpense,
      totalReceipts: cashIncome, expectedCash: expected, countedCash: counted,
      difference: diff, closedBy: localStorage.getItem('pos-user-role') || 'admin', notes,
    });
    setCloses([...getDailyCashCloses()]);
    toast.success('Day closed');
    setOpening(0); setCounted(0); setNotes('');
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Close Day</h3>
        <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Opening Cash</Label><Input type="number" value={opening} onChange={e => setOpening(Number(e.target.value))} /></div>
        <div className="bg-muted p-3 rounded space-y-1 text-sm">
          <div className="flex justify-between"><span>Cash Sales</span><span>{money(totalSales)}</span></div>
          <div className="flex justify-between"><span>Other Cash Income</span><span>+ {money(cashIncome)}</span></div>
          <div className="flex justify-between"><span>Cash Expenses</span><span>- {money(cashExpense)}</span></div>
          <div className="flex justify-between font-bold border-t pt-1"><span>Expected Cash</span><span>{money(expected)}</span></div>
        </div>
        <div><Label>Counted Cash</Label><Input type="number" value={counted} onChange={e => setCounted(Number(e.target.value))} /></div>
        <div className={`text-center font-bold p-2 rounded ${diff === 0 ? 'bg-green-100 text-green-700' : diff > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
          Difference: {money(diff)} {diff > 0 ? '(Excess)' : diff < 0 ? '(Short)' : '(Balanced)'}
        </div>
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 rounded text-sm">
          <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
            <span>Pending Credit (carry-forward)</span>
            <span>{money(pendingCreditTotal)}</span>
          </div>
          <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-1">
            {pendingCreditOrders.length} bill(s) udhaar — Close Day se delete nahi honge.
          </p>
        </div>
        <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <Button onClick={handleClose} className="w-full">Close Day</Button>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Recent Closes</h3>
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {closes.slice().reverse().map(c => (
            <Card key={c.id} className="p-2 text-sm">
              <div className="flex justify-between items-center gap-2 font-medium"><span>{c.date}</span><span className={c.difference === 0 ? 'text-green-600' : c.difference > 0 ? 'text-blue-600' : 'text-red-600'}>Diff: {money(c.difference)}</span></div>
              <div className="text-xs text-muted-foreground">Sales: {money(c.totalSales)} | Expense: {money(c.totalExpense)} | Counted: {money(c.countedCash)}</div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2 text-destructive"
                onClick={() => {
                  if (!confirm('Delete this close day record?')) return;
                  deleteDailyCashClose(c.id);
                  setCloses(getDailyCashCloses());
                  toast.success('Close day record deleted');
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Delete
              </Button>
            </Card>
          ))}
          {closes.length === 0 && <p className="text-sm text-muted-foreground text-center">No closes yet</p>}
        </div>
      </Card>
    </div>
  );
}

// ============== PAYMENT ACCOUNTS TAB ==============
function PaymentAccountsTab() {
  const [accounts, setAccounts] = useState<PaymentAccount[]>(getPaymentAccounts());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PaymentAccount>({
    id: '', name: '', accountNumber: '', accountTitle: '', type: 'bank',
    isActive: true, openingBalance: 0, notes: '', sortOrder: 0,
  });

  const refresh = () => setAccounts([...getPaymentAccounts()]);
  const orders = getOrders().filter(o => o.status === 'paid');

  const totalForAcct = (id: string) =>
    orders.filter(o => o.paymentAccountId === id).reduce((s, o) => s + o.grandTotal, 0);

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Account name required'); return; }
    savePaymentAccount({ ...form, id: form.id || genId() });
    refresh(); setOpen(false);
    setForm({ id: '', name: '', accountNumber: '', accountTitle: '', type: 'bank', isActive: true, openingBalance: 0, notes: '', sortOrder: 0 });
    toast.success('Saved');
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Landmark className="h-4 w-4" /> Payment Accounts</h3>
          <p className="text-xs text-muted-foreground">Bank, JazzCash and Easypaisa accounts that customers pay into.</p>
        </div>
        <Button size="sm" onClick={() => { setForm({ id: '', name: '', accountNumber: '', accountTitle: '', type: 'bank', isActive: true, openingBalance: 0, notes: '', sortOrder: 0 }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />Add Account
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Account # / Mobile</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="text-right">Received (PKR)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map(a => (
            <TableRow key={a.id}>
              <TableCell><Badge variant="outline" className="uppercase">{a.type}</Badge></TableCell>
              <TableCell className="font-medium">{a.name}</TableCell>
              <TableCell className="font-mono text-xs">{a.accountNumber || '—'}</TableCell>
              <TableCell>{a.accountTitle || '—'}</TableCell>
              <TableCell className="text-right font-bold text-primary">
                {money((totalForAcct(a.id) + (a.openingBalance || 0)))}
              </TableCell>
              <TableCell>{a.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" onClick={() => { setForm(a); setOpen(true); }}>
                  ✎
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm('Delete this account?')) { deletePaymentAccount(a.id); refresh(); } }}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {accounts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No payment accounts. Add Meezan/HBL/JazzCash etc.</TableCell></TableRow>}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? 'Edit' : 'Add'} Payment Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v: PaymentAccountType) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="jazzcash">JazzCash</SelectItem>
                    <SelectItem value="easypaisa">Easypaisa</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                    <SelectItem value="cash">Cash Drawer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.isActive ? 'yes' : 'no'} onValueChange={v => setForm({ ...form, isActive: v === 'yes' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Active</SelectItem>
                    <SelectItem value="no">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Account Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Meezan Bank" /></div>
            <div><Label>Account Number / Mobile #</Label><Input value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} placeholder="0300-1234567 or IBAN" /></div>
            <div><Label>Account Title</Label><Input value={form.accountTitle} onChange={e => setForm({ ...form, accountTitle: e.target.value })} placeholder="Holder name" /></div>
            <div><Label>Opening Balance (PKR)</Label><Input type="number" value={form.openingBalance} onChange={e => setForm({ ...form, openingBalance: Number(e.target.value) })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <Button onClick={handleSave} className="w-full">Save</Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
