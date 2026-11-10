// Demo accounts used by the "Try the demo" buttons on the login page.
// Ids match the frontend's browser demo data so both sides show the same companies.
// Safe to run more than once: existing records are left as they are.
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';

const companies = [
  { id: 'c_abc', name: 'ABC Constructions', city: 'Kochi' },
  { id: 'c_sky', name: 'Skyline Builders', city: 'Thrissur' },
];

const users = [
  { id: 'u_ravi', companyId: 'c_abc', name: 'Ravi Kumar', email: 'demo@abc.com', role: 'owner' },
  { id: 'u_suresh', companyId: 'c_abc', name: 'Suresh P', email: 'suresh@abc.com', role: 'staff' },
  { id: 'u_anil', companyId: 'c_sky', name: 'Anil Varghese', email: 'demo@skyline.com', role: 'owner' },
] as const;

/** A calendar day `days` before today (negative = in the future), stored as UTC midnight. */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Same projects as the frontend's demo data (frontend/src/api/mockDb.ts).
const project = (
  id: string,
  companyId: string,
  name: string,
  clientName: string,
  clientPhone: string,
  location: string,
  contractValue: number,
  estimatedCost: number,
  startedDaysAgo: number,
  endsInDays: number,
  progress: number,
  status: 'ongoing' | 'on_hold' | 'completed',
  categoryBudgets: Record<string, number> = {},
) => ({
  id,
  companyId,
  name,
  clientName,
  clientPhone,
  location,
  contractValue,
  estimatedCost,
  categoryBudgets,
  startDate: daysAgo(startedDaysAgo),
  expectedEndDate: daysAgo(-endsInDays),
  progress,
  status,
  createdAt: daysAgo(startedDaysAgo),
});

const projects = [
  project('p_aluva', 'c_abc', 'House – Aluva', 'Thomas Mathew', '9846098460', 'Aluva, Ernakulam', 42_00_000, 34_00_000, 30, 300, 10, 'ongoing', {
    materials: 15_00_000,
    labour: 9_00_000,
    electrical: 3_00_000,
    plumbing: 2_50_000,
  }),
  project('p_villa', 'c_abc', 'Villa – Kakkanad', 'Rajesh Menon', '9847012345', 'Kakkanad, Kochi', 85_00_000, 68_00_000, 180, 120, 65, 'ongoing', {
    materials: 26_00_000,
    labour: 18_00_000,
    equipment: 3_00_000,
    transport: 2_00_000,
    electrical: 6_00_000,
    plumbing: 5_00_000,
    permits: 1_00_000,
  }),
  project('p_mall', 'c_abc', 'Commercial Complex – Edappally', 'Sunrise Traders', '9895011223', 'Edappally, Kochi', 2_40_00_000, 1_95_00_000, 310, 150, 70, 'ongoing', {
    materials: 95_00_000,
    labour: 55_00_000,
    equipment: 10_00_000,
    electrical: 15_00_000,
    plumbing: 10_00_000,
  }),
  project('p_reno', 'c_abc', 'Apartment Renovation – Vyttila', 'Anita Joseph', '9744556677', 'Vyttila, Kochi', 18_50_000, 14_00_000, 150, -40, 100, 'completed'),
  project('p_office', 'c_sky', 'Office Interior – Infopark', 'TechNova Solutions', '9633221100', 'Infopark, Kochi', 32_00_000, 25_00_000, 70, 60, 40, 'ongoing'),
];

// Same suppliers as the frontend's demo data.
const supplier = (id: string, companyId: string, name: string, type: 'supplier' | 'subcontractor' | 'labour', phone: string) => ({
  id,
  companyId,
  name,
  type,
  phone,
  createdAt: daysAgo(320),
});

const suppliers = [
  supplier('s_kcs', 'c_abc', 'Kerala Cements & Steel', 'supplier', '9847100200'),
  supplier('s_babu', 'c_abc', 'Babu – Mason team', 'labour', '9846500600'),
  supplier('s_joseph', 'c_abc', 'Joseph – Labour contractor', 'subcontractor', '9895300400'),
  supplier('s_jcb', 'c_abc', 'JCB & Crane Rentals', 'supplier', '9744200300'),
  supplier('s_malabar', 'c_abc', 'Malabar Bricks', 'supplier', '9633400500'),
  supplier('s_aqua', 'c_abc', 'AquaFlow Plumbing', 'subcontractor', '9847600700'),
  supplier('s_bright', 'c_abc', 'Bright Electricals', 'subcontractor', '9846700800'),
  supplier('s_sree', 'c_abc', 'Sree Transports', 'supplier', '9895800900'),
  supplier('s_decor', 'c_abc', 'Home Decor Mart', 'supplier', '9744900100'),
  supplier('s_interior', 'c_sky', 'Interior World', 'supplier', '9633111222'),
  supplier('s_carp', 'c_sky', 'Carpentry team', 'labour', '9633333444'),
];

// Same client payments as the frontend's demo data. Fixed ids so re-running adds nothing new.
type Kind = 'advance' | 'installment' | 'final' | 'refund';
type Mode = 'cash' | 'upi' | 'bank' | 'cheque';
const payments: {
  id: string;
  companyId: string;
  projectId: string;
  kind: Kind;
  amount: number;
  date: Date;
  mode: Mode;
  reference: string;
  note: string;
  createdById: string;
  createdBy: string;
  createdAt: Date;
}[] = [];
const pay = (projectId: string, amount: number, ago: number, mode: Mode, note: string, kind: Kind = 'installment', reference = '') => {
  const p = projects.find((x) => x.id === projectId)!;
  const by = p.companyId === 'c_abc' ? users[0] : users[2];
  payments.push({
    id: `pay_demo_${payments.length + 1}`,
    companyId: p.companyId,
    projectId,
    kind,
    amount,
    date: daysAgo(ago),
    mode,
    reference,
    note,
    createdById: by.id,
    createdBy: by.name,
    createdAt: daysAgo(ago),
  });
};
pay('p_villa', 15_00_000, 170, 'bank', 'Advance payment', 'advance', 'NEFT 88231');
pay('p_villa', 15_00_000, 120, 'bank', 'Foundation completed');
pay('p_villa', 12_00_000, 70, 'cheque', 'Ground floor slab', 'installment', 'Chq 004512');
pay('p_villa', 10_00_000, 20, 'upi', 'First floor slab');
pay('p_mall', 50_00_000, 300, 'bank', 'Advance payment', 'advance');
pay('p_mall', 40_00_000, 220, 'bank', 'Basement completed');
pay('p_mall', 40_00_000, 130, 'bank', 'Second floor slab');
pay('p_mall', 30_00_000, 45, 'cheque', 'Fourth floor slab');
pay('p_reno', 9_00_000, 140, 'bank', 'Advance payment', 'advance');
pay('p_reno', 9_50_000, 60, 'bank', 'Final payment', 'final');
pay('p_aluva', 8_00_000, 28, 'bank', 'Advance payment', 'advance');
pay('p_office', 10_00_000, 60, 'bank', 'Advance payment', 'advance');

// Same supplier bills and expenses as the frontend's demo data.
type Category = 'materials' | 'labour' | 'subcontractor' | 'equipment' | 'transport' | 'rent' | 'permits' | 'electrical' | 'plumbing' | 'other';
const companyOf = (projectId: string) => projects.find((x) => x.id === projectId)!.companyId;
const supplierIdByName = (companyId: string, name: string) =>
  suppliers.find((s) => s.companyId === companyId && s.name === name)?.id ?? null;
const userByName = (name: string) => users.find((u) => u.name === name)!;

const bills = [
  ['b_villa_elec', 'p_villa', 'Bright Electricals', 'electrical', 4_50_000, 35, 30, 'BE/2026/118', 'Conduits and wiring – stage 1'],
  ['b_mall_steel', 'p_mall', 'Kerala Cements & Steel', 'materials', 6_00_000, 20, 15, 'KCS/7781', 'Roof slab steel – on credit'],
].map(([id, projectId, supplierName, category, amount, ago, dueInDays, billNumber, note]) => ({
  id: id as string,
  companyId: companyOf(projectId as string),
  projectId: projectId as string,
  supplierId: supplierIdByName(companyOf(projectId as string), supplierName as string)!,
  category: category as Category,
  billNumber: billNumber as string,
  billDate: daysAgo(ago as number),
  dueDate: daysAgo((ago as number) - (dueInDays as number)),
  amount: amount as number,
  note: note as string,
  createdById: 'u_ravi',
  createdBy: 'Ravi Kumar',
  createdAt: daysAgo(ago as number),
}));

const expenses: {
  id: string;
  companyId: string;
  projectId: string;
  amount: number;
  date: Date;
  category: Category;
  supplierId: string | null;
  billId: string | null;
  paidTo: string;
  mode: Mode;
  note: string;
  createdById: string;
  createdBy: string;
  createdAt: Date;
}[] = [];
const spend = (
  projectId: string,
  category: Category,
  amount: number,
  ago: number,
  paidTo: string,
  mode: Mode,
  note: string,
  by: string,
  billId: string | null = null,
) => {
  const companyId = companyOf(projectId);
  expenses.push({
    id: `exp_demo_${expenses.length + 1}`,
    companyId,
    projectId,
    amount,
    date: daysAgo(ago),
    category,
    supplierId: supplierIdByName(companyId, paidTo),
    billId,
    paidTo,
    mode,
    note,
    createdById: userByName(by).id,
    createdBy: by,
    createdAt: daysAgo(ago),
  });
};
spend('p_villa', 'materials', 6_50_000, 165, 'Kerala Cements & Steel', 'bank', 'Cement and steel for foundation', 'Ravi Kumar');
spend('p_villa', 'labour', 3_80_000, 150, 'Babu – Mason team', 'cash', 'Foundation labour', 'Suresh P');
spend('p_villa', 'materials', 4_80_000, 118, 'Kerala Cements & Steel', 'bank', 'Steel rods', 'Ravi Kumar');
spend('p_villa', 'labour', 4_20_000, 100, 'Babu – Mason team', 'cash', 'Ground floor labour', 'Suresh P');
spend('p_villa', 'equipment', 2_40_000, 90, 'JCB & Crane Rentals', 'bank', 'Excavation and concrete mixer rent', 'Ravi Kumar');
spend('p_villa', 'materials', 5_60_000, 75, 'Malabar Bricks', 'bank', 'Bricks and blocks', 'Ravi Kumar');
spend('p_villa', 'transport', 1_30_000, 60, 'Sree Transports', 'cash', 'Material transport', 'Suresh P');
spend('p_villa', 'labour', 3_60_000, 50, 'Babu – Mason team', 'cash', 'First floor labour', 'Suresh P');
spend('p_villa', 'plumbing', 2_85_000, 40, 'AquaFlow Plumbing', 'bank', 'Pipes and fittings', 'Ravi Kumar');
spend('p_villa', 'electrical', 3_20_000, 30, 'Bright Electricals', 'upi', 'Part payment – wiring stage 1', 'Ravi Kumar', 'b_villa_elec');
spend('p_villa', 'materials', 5_50_000, 25, 'Kerala Cements & Steel', 'upi', 'Cement for first floor slab', 'Ravi Kumar');
spend('p_villa', 'permits', 50_000, 12, 'Panchayat office', 'bank', 'Permit and approval fees', 'Ravi Kumar');
spend('p_villa', 'labour', 2_50_000, 8, 'Babu – Mason team', 'cash', 'Weekly wages', 'Suresh P');
spend('p_mall', 'materials', 40_00_000, 280, 'Kerala Cements & Steel', 'bank', 'Basement materials', 'Ravi Kumar');
spend('p_mall', 'labour', 22_00_000, 250, 'Joseph – Labour contractor', 'bank', 'Basement and ground floor labour', 'Ravi Kumar');
spend('p_mall', 'equipment', 7_40_000, 200, 'JCB & Crane Rentals', 'bank', 'Tower crane rent', 'Ravi Kumar');
spend('p_mall', 'materials', 35_00_000, 180, 'Kerala Cements & Steel', 'bank', 'Steel price increase', 'Ravi Kumar');
spend('p_mall', 'labour', 20_00_000, 150, 'Joseph – Labour contractor', 'bank', 'Floors 1–3 labour', 'Ravi Kumar');
spend('p_mall', 'materials', 30_00_000, 60, 'Kerala Cements & Steel', 'bank', 'Floors 4–5 materials', 'Ravi Kumar');
spend('p_mall', 'plumbing', 9_50_000, 50, 'AquaFlow Plumbing', 'bank', 'Plumbing – all floors', 'Ravi Kumar');
spend('p_mall', 'electrical', 14_00_000, 40, 'Bright Electricals', 'bank', 'Electrical – all floors', 'Ravi Kumar');
spend('p_mall', 'labour', 20_00_000, 30, 'Joseph – Labour contractor', 'bank', 'Floors 4–5 labour', 'Ravi Kumar');
spend('p_mall', 'transport', 3_50_000, 15, 'Sree Transports', 'cash', 'Material transport', 'Suresh P');
spend('p_reno', 'materials', 6_20_000, 130, 'Home Decor Mart', 'bank', 'Tiles, paint and fittings', 'Ravi Kumar');
spend('p_reno', 'labour', 4_50_000, 100, 'Babu – Mason team', 'cash', 'Renovation labour', 'Suresh P');
spend('p_reno', 'electrical', 1_30_000, 90, 'Bright Electricals', 'upi', 'Rewiring', 'Ravi Kumar');
spend('p_reno', 'plumbing', 1_20_000, 80, 'AquaFlow Plumbing', 'upi', 'Bathroom plumbing', 'Ravi Kumar');
spend('p_aluva', 'materials', 2_40_000, 20, 'Kerala Cements & Steel', 'upi', 'Foundation materials', 'Ravi Kumar');
spend('p_aluva', 'labour', 1_20_000, 10, 'Babu – Mason team', 'cash', 'Foundation labour', 'Suresh P');
spend('p_aluva', 'labour', 20_000, 3, 'Babu – Mason team', 'cash', 'Advance to mason team', 'Suresh P');
spend('p_office', 'materials', 4_50_000, 50, 'Interior World', 'bank', 'Plywood and glass', 'Anil Varghese');
spend('p_office', 'labour', 3_00_000, 20, 'Carpentry team', 'cash', 'Carpentry work', 'Anil Varghese');

// Same client payment schedules as the frontend's demo data (negative = due in the future).
const installments = (
  [
    ['p_villa', 'Advance', 15_00_000, 175],
    ['p_villa', 'Foundation', 15_00_000, 125],
    ['p_villa', 'Ground floor slab', 12_00_000, 75],
    ['p_villa', 'First floor slab', 10_00_000, 25],
    ['p_villa', 'Plastering', 15_00_000, -30],
    ['p_villa', 'Handover', 18_00_000, -120],
    ['p_mall', 'Advance', 50_00_000, 305],
    ['p_mall', 'Basement', 40_00_000, 225],
    ['p_mall', 'Second floor slab', 40_00_000, 135],
    ['p_mall', 'Fourth floor slab', 30_00_000, 50],
    ['p_mall', 'Roof slab', 40_00_000, 10],
    ['p_mall', 'Finishing', 40_00_000, -60],
    ['p_aluva', 'Advance', 8_00_000, 30],
    ['p_aluva', 'Foundation', 8_00_000, -20],
    ['p_aluva', 'Ground floor slab', 10_00_000, -90],
  ] as const
).map(([projectId, label, amount, dueAgo], i) => ({
  id: `ins_demo_${i + 1}`,
  companyId: companyOf(projectId),
  projectId,
  label,
  amount,
  dueDate: daysAgo(dueAgo),
}));

const passwordHash = await bcrypt.hash('demo123', 12);

for (const company of companies) {
  await prisma.company.upsert({ where: { id: company.id }, update: {}, create: company });
}
for (const user of users) {
  await prisma.user.upsert({ where: { email: user.email }, update: {}, create: { ...user, passwordHash } });
}
for (const p of projects) {
  await prisma.project.upsert({ where: { id: p.id }, update: {}, create: p });
}
for (const s of suppliers) {
  await prisma.supplier.upsert({ where: { id: s.id }, update: {}, create: s });
}
for (const p of payments) {
  await prisma.payment.upsert({ where: { id: p.id }, update: {}, create: p });
}
for (const b of bills) {
  await prisma.bill.upsert({ where: { id: b.id }, update: {}, create: b });
}
for (const e of expenses) {
  await prisma.expense.upsert({ where: { id: e.id }, update: {}, create: e }); // after bills: one pays a bill
}
for (const i of installments) {
  await prisma.installment.upsert({ where: { id: i.id }, update: {}, create: i });
}

console.log(
  `Seeded ${companies.length} demo companies, ${users.length} demo users (password: demo123), ` +
    `${projects.length} projects, ${suppliers.length} suppliers, ${payments.length} payments, ` +
    `${bills.length} bills, ${expenses.length} expenses and ${installments.length} installments.`,
);
await prisma.$disconnect();
