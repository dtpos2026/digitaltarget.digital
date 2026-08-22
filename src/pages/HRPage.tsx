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
  getEmployees, saveEmployee, deleteEmployee,
  getAttendance, markAttendance,
  getLeaves, saveLeave, deleteLeave,
  getPayslips, savePayslip, deletePayslip,
  getAdvances, saveAdvance, deleteAdvance,
  genId,
} from '@/lib/store';
import { Employee, Leave, Payslip, Advance, AttendanceStatus } from '@/lib/types';
import { Plus, Pencil, Trash2, Printer, Users, CalendarCheck, Wallet, FileText, Receipt } from 'lucide-react';
import { toast } from 'sonner';

export default function HRPage() {
  const [tab, setTab] = useState('employees');
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">HR Management</h1>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="employees"><Users className="h-4 w-4 mr-1" />Employees</TabsTrigger>
          <TabsTrigger value="attendance"><CalendarCheck className="h-4 w-4 mr-1" />Attendance</TabsTrigger>
          <TabsTrigger value="leaves"><FileText className="h-4 w-4 mr-1" />Leaves</TabsTrigger>
          <TabsTrigger value="payslips"><Receipt className="h-4 w-4 mr-1" />Payslips</TabsTrigger>
          <TabsTrigger value="advances"><Wallet className="h-4 w-4 mr-1" />Advances</TabsTrigger>
        </TabsList>
        <TabsContent value="employees"><EmployeesTab /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="leaves"><LeavesTab /></TabsContent>
        <TabsContent value="payslips"><PayslipsTab /></TabsContent>
        <TabsContent value="advances"><AdvancesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============== Employees ==============
function EmployeesTab() {
  const [employees, setEmployees] = useState(getEmployees());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const refresh = () => setEmployees([...getEmployees()]);

  const handleSave = (e: Employee) => {
    saveEmployee(e);
    refresh();
    setOpen(false);
    toast.success('Employee saved');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete employee?')) return;
    deleteEmployee(id);
    refresh();
    toast.success('Deleted');
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-semibold">Employees ({employees.length})</h3>
        <Button onClick={() => { setEditing(null); setOpen(true); }} size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Designation</TableHead>
            <TableHead>Phone</TableHead><TableHead>Salary</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map(e => (
            <TableRow key={e.id}>
              <TableCell>{e.empCode}</TableCell><TableCell>{e.name}</TableCell>
              <TableCell>{e.designation}</TableCell><TableCell>{e.phone}</TableCell>
              <TableCell>{money(e.basicSalary)}</TableCell>
              <TableCell><Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge></TableCell>
              <TableCell className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(e.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {employees.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No employees yet</TableCell></TableRow>}
        </TableBody>
      </Table>
      {open && <EmployeeDialog employee={editing} onSave={handleSave} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function EmployeeDialog({ employee, onSave, onClose }: { employee: Employee | null; onSave: (e: Employee) => void; onClose: () => void }) {
  const [form, setForm] = useState<Employee>(employee || {
    id: genId(), empCode: '', name: '', fatherName: '', cnic: '', phone: '', address: '',
    designation: '', department: '', joiningDate: new Date().toISOString().split('T')[0],
    basicSalary: 0, allowances: 0, status: 'active', notes: '',
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{employee ? 'Edit' : 'Add'} Employee</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Employee Code *</Label><Input value={form.empCode} onChange={e => setForm({ ...form, empCode: e.target.value })} /></div>
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Father Name</Label><Input value={form.fatherName} onChange={e => setForm({ ...form, fatherName: e.target.value })} /></div>
          <div><Label>CNIC</Label><Input value={form.cnic} onChange={e => setForm({ ...form, cnic: e.target.value })} /></div>
          <div><Label>Phone *</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Designation *</Label><Input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></div>
          <div><Label>Joining Date</Label><Input type="date" value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} /></div>
          <div><Label>Basic Salary *</Label><Input type="number" value={form.basicSalary} onChange={e => setForm({ ...form, basicSalary: Number(e.target.value) })} /></div>
          <div><Label>Allowances</Label><Input type="number" value={form.allowances} onChange={e => setForm({ ...form, allowances: Number(e.target.value) })} /></div>
          <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>Status</Label>
            <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.name || !form.empCode}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Attendance ==============
function AttendanceTab() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [, force] = useState(0);
  const employees = getEmployees().filter(e => e.status === 'active');
  const attendance = getAttendance();

  const getStatus = (empId: string): AttendanceStatus | '' => {
    const a = attendance.find(x => x.employeeId === empId && x.date === date);
    return (a?.status as AttendanceStatus) || '';
  };

  const set = (empId: string, status: AttendanceStatus) => {
    markAttendance(empId, date, status);
    force(x => x + 1);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <Label>Date:</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Mark</TableHead></TableRow></TableHeader>
        <TableBody>
          {employees.map(e => {
            const s = getStatus(e.id);
            return (
              <TableRow key={e.id}>
                <TableCell>{e.empCode}</TableCell><TableCell>{e.name}</TableCell>
                <TableCell>{s ? <Badge>{s}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant={s === 'present' ? 'default' : 'outline'} onClick={() => set(e.id, 'present')}>P</Button>
                  <Button size="sm" variant={s === 'absent' ? 'destructive' : 'outline'} onClick={() => set(e.id, 'absent')}>A</Button>
                  <Button size="sm" variant={s === 'leave' ? 'secondary' : 'outline'} onClick={() => set(e.id, 'leave')}>L</Button>
                  <Button size="sm" variant={s === 'half-day' ? 'secondary' : 'outline'} onClick={() => set(e.id, 'half-day')}>H</Button>
                </TableCell>
              </TableRow>
            );
          })}
          {employees.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No active employees</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

// ============== Leaves ==============
function LeavesTab() {
  const [leaves, setLeaves] = useState(getLeaves());
  const [open, setOpen] = useState(false);
  const employees = getEmployees();
  const [form, setForm] = useState<Leave>({
    id: '', employeeId: '', type: 'casual', fromDate: '', toDate: '', days: 1, reason: '', status: 'pending', appliedAt: '',
  });

  const refresh = () => setLeaves([...getLeaves()]);
  const handleAdd = () => {
    if (!form.employeeId || !form.fromDate) { toast.error('Fill required fields'); return; }
    saveLeave({ ...form, id: genId(), appliedAt: new Date().toISOString() });
    refresh(); setOpen(false);
    setForm({ id: '', employeeId: '', type: 'casual', fromDate: '', toDate: '', days: 1, reason: '', status: 'pending', appliedAt: '' });
    toast.success('Leave applied');
  };

  const updateStatus = (l: Leave, status: Leave['status']) => {
    saveLeave({ ...l, status });
    refresh();
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-semibold">Leaves</h3>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Apply Leave</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Days</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {leaves.map(l => {
            const emp = employees.find(e => e.id === l.employeeId);
            return (
              <TableRow key={l.id}>
                <TableCell>{emp?.name || '—'}</TableCell><TableCell>{l.type}</TableCell>
                <TableCell>{l.fromDate}</TableCell><TableCell>{l.toDate}</TableCell>
                <TableCell>{l.days}</TableCell><TableCell>{l.reason}</TableCell>
                <TableCell><Badge variant={l.status === 'approved' ? 'default' : l.status === 'rejected' ? 'destructive' : 'secondary'}>{l.status}</Badge></TableCell>
                <TableCell className="flex gap-1">
                  {l.status === 'pending' && <>
                    <Button size="sm" onClick={() => updateStatus(l, 'approved')}>✓</Button>
                    <Button size="sm" variant="destructive" onClick={() => updateStatus(l, 'rejected')}>✗</Button>
                  </>}
                  <Button size="icon" variant="ghost" onClick={() => { deleteLeave(l.id); refresh(); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
          {leaves.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No leaves</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Leave</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Employee</Label>
              <Select value={form.employeeId} onValueChange={v => setForm({ ...form, employeeId: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v: any) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">Casual</SelectItem><SelectItem value="sick">Sick</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" value={form.fromDate} onChange={e => setForm({ ...form, fromDate: e.target.value })} /></div>
              <div><Label>To</Label><Input type="date" value={form.toDate} onChange={e => setForm({ ...form, toDate: e.target.value })} /></div>
            </div>
            <div><Label>Days</Label><Input type="number" value={form.days} onChange={e => setForm({ ...form, days: Number(e.target.value) })} /></div>
            <div><Label>Reason</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={handleAdd}>Apply</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============== Payslips ==============
function PayslipsTab() {
  const [payslips, setPayslips] = useState(getPayslips());
  const [open, setOpen] = useState(false);
  const employees = getEmployees();
  const attendance = getAttendance();
  const advances = getAdvances();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState<Payslip | null>(null);

  const refresh = () => setPayslips([...getPayslips()]);

  const generateForEmployee = (empId: string) => {
    const emp = employees.find(e => e.id === empId)!;
    const monthAtt = attendance.filter(a => a.employeeId === empId && a.date.startsWith(month));
    const present = monthAtt.filter(a => a.status === 'present').length;
    const absent = monthAtt.filter(a => a.status === 'absent').length;
    const leaveDays = monthAtt.filter(a => a.status === 'leave').length;
    const halfDay = monthAtt.filter(a => a.status === 'half-day').length;
    const workingDays = 30;
    const empAdvance = advances.filter(a => a.employeeId === empId && !a.recovered).reduce((s, a) => s + a.amount, 0);
    const perDay = emp.basicSalary / workingDays;
    const deductionForAbsent = absent * perDay + halfDay * perDay * 0.5;
    const net = emp.basicSalary + (emp.allowances || 0) - deductionForAbsent - empAdvance;
    setForm({
      id: genId(), employeeId: empId, month,
      workingDays, presentDays: present + halfDay, absentDays: absent, leaveDays,
      basicSalary: emp.basicSalary, allowances: emp.allowances || 0,
      overtime: 0, bonus: 0, advance: empAdvance,
      loanDeduction: 0, otherDeductions: deductionForAbsent,
      netSalary: Math.max(0, Math.round(net)),
    });
    setOpen(true);
  };

  const printPayslip = (p: Payslip) => {
    const emp = employees.find(e => e.id === p.employeeId);
    const html = `<html><head><title>Payslip</title><style>
      body{font-family:Arial;padding:20px;max-width:600px;margin:auto;}
      h2{text-align:center;border-bottom:2px solid #000;padding-bottom:8px;}
      table{width:100%;border-collapse:collapse;margin-top:10px;}
      td{padding:6px;border-bottom:1px solid #ddd;}
      .total{font-weight:bold;font-size:16px;border-top:2px solid #000;}
    </style></head><body>
      <h2>PAYSLIP - ${p.month}</h2>
      <table>
        <tr><td>Employee</td><td>${emp?.name || ''} (${emp?.empCode || ''})</td></tr>
        <tr><td>Designation</td><td>${emp?.designation || ''}</td></tr>
        <tr><td>Working Days</td><td>${p.workingDays}</td></tr>
        <tr><td>Present</td><td>${p.presentDays}</td></tr>
        <tr><td>Absent</td><td>${p.absentDays}</td></tr>
        <tr><td>Leaves</td><td>${p.leaveDays}</td></tr>
        <tr><td>Basic Salary</td><td>${money(p.basicSalary)}</td></tr>
        <tr><td>Allowances</td><td>${money(p.allowances)}</td></tr>
        <tr><td>Bonus</td><td>${money(p.bonus)}</td></tr>
        <tr><td>Overtime</td><td>${money(p.overtime)}</td></tr>
        <tr><td>Advance</td><td>- ${money(p.advance)}</td></tr>
        <tr><td>Other Deductions</td><td>- ${money(Math.round(p.otherDeductions))}</td></tr>
        <tr class="total"><td>NET SALARY</td><td>${money(p.netSalary)}</td></tr>
      </table>
      <p style="margin-top:40px;">_______________________<br/>Signature</p>
    </body></html>`;
    const w = window.open('', '_blank', 'width=700,height=800');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <Label>Month:</Label>
        <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-auto" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-semibold mb-2">Generate New Payslip</h4>
          <div className="space-y-1 max-h-[400px] overflow-auto">
            {employees.filter(e => e.status === 'active').map(e => (
              <Button key={e.id} variant="outline" className="w-full justify-between" onClick={() => generateForEmployee(e.id)}>
                <span>{e.name} ({e.empCode})</span>
                <span className="text-xs text-muted-foreground">{money(e.basicSalary)}</span>
              </Button>
            ))}
          </div>
        </div>
        <div>
          <h4 className="font-semibold mb-2">Saved Payslips</h4>
          <div className="space-y-1 max-h-[400px] overflow-auto">
            {payslips.filter(p => p.month === month).map(p => {
              const emp = employees.find(e => e.id === p.employeeId);
              return (
                <Card key={p.id} className="p-2 flex justify-between items-center">
                  <div><div className="font-medium text-sm">{emp?.name}</div><div className="text-xs text-muted-foreground">Net: {money(p.netSalary)}</div></div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => printPayslip(p)}><Printer className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { deletePayslip(p.id); refresh(); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </div>
                </Card>
              );
            })}
            {payslips.filter(p => p.month === month).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No payslips for this month</p>}
          </div>
        </div>
      </div>
      {form && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Generate Payslip</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Working Days</div><div>{form.workingDays}</div>
              <div>Present</div><div>{form.presentDays}</div>
              <div>Absent</div><div>{form.absentDays}</div>
              <div>Basic</div><div>{money(form.basicSalary)}</div>
              <div>Allowances</div><div>{money(form.allowances)}</div>
              <div>Bonus</div><Input type="number" value={form.bonus} onChange={e => setForm({ ...form, bonus: Number(e.target.value), netSalary: form.basicSalary + form.allowances + Number(e.target.value) + form.overtime - form.advance - form.otherDeductions - form.loanDeduction })} />
              <div>Overtime</div><Input type="number" value={form.overtime} onChange={e => setForm({ ...form, overtime: Number(e.target.value), netSalary: form.basicSalary + form.allowances + form.bonus + Number(e.target.value) - form.advance - form.otherDeductions - form.loanDeduction })} />
              <div>Advance Deduction</div><div>{money(form.advance)}</div>
              <div>Auto Deduction</div><div>{money(Math.round(form.otherDeductions))}</div>
              <div className="font-bold">NET SALARY</div><div className="font-bold">{money(Math.max(0, form.netSalary))}</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { savePayslip({ ...form, paidAt: new Date().toISOString(), paymentMethod: 'cash' }); refresh(); setOpen(false); toast.success('Payslip saved'); }}>Save & Pay</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ============== Advances ==============
function AdvancesTab() {
  const [advances, setAdvances] = useState(getAdvances());
  const [open, setOpen] = useState(false);
  const employees = getEmployees();
  const [form, setForm] = useState<Advance>({ id: '', employeeId: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '', recovered: false });

  const refresh = () => setAdvances([...getAdvances()]);

  const handleAdd = () => {
    if (!form.employeeId || form.amount <= 0) { toast.error('Fill fields'); return; }
    saveAdvance({ ...form, id: genId() });
    refresh(); setOpen(false);
    setForm({ id: '', employeeId: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '', recovered: false });
    toast.success('Advance added');
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-semibold">Salary Advances</h3>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Advance</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Employee</TableHead><TableHead>Amount</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {advances.map(a => {
            const emp = employees.find(e => e.id === a.employeeId);
            return (
              <TableRow key={a.id}>
                <TableCell>{a.date}</TableCell><TableCell>{emp?.name || '—'}</TableCell>
                <TableCell>{money(a.amount)}</TableCell><TableCell>{a.reason}</TableCell>
                <TableCell><Badge variant={a.recovered ? 'default' : 'secondary'}>{a.recovered ? 'Recovered' : 'Pending'}</Badge></TableCell>
                <TableCell className="flex gap-1">
                  {!a.recovered && <Button size="sm" onClick={() => { saveAdvance({ ...a, recovered: true }); refresh(); }}>Mark Recovered</Button>}
                  <Button size="icon" variant="ghost" onClick={() => { deleteAdvance(a.id); refresh(); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
          {advances.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No advances</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Advance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Employee</Label>
              <Select value={form.employeeId} onValueChange={v => setForm({ ...form, employeeId: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Reason</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={handleAdd}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
