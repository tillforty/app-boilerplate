/**
 * Dummy data for the demo/showcase pages. Entirely client-side — no backend —
 * so the example CRM pages render fully populated out of the box. Swap these for
 * real API calls when you build the actual feature.
 */

export type CustomerStatus = 'active' | 'trial' | 'churned' | 'lead'

export interface Customer {
  id: string
  name: string
  company: string
  email: string
  status: CustomerStatus
  mrr: number // monthly recurring revenue, USD
  seats: number
  joined: string // ISO date
}

export const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'trial', 'churned', 'lead']

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  churned: 'Churned',
  lead: 'Lead',
}

/** Badge variant per status (maps to the shadcn Badge variants). */
export const STATUS_VARIANT: Record<CustomerStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  trial: 'secondary',
  churned: 'destructive',
  lead: 'outline',
}

export const DEMO_CUSTOMERS: Customer[] = [
  { id: 'c-1001', name: 'Ava Bennett', company: 'Northwind Labs', email: 'ava@northwind.io', status: 'active', mrr: 1290, seats: 24, joined: '2024-02-11' },
  { id: 'c-1002', name: 'Liam Carter', company: 'Helios Freight', email: 'liam@helios.co', status: 'active', mrr: 880, seats: 16, joined: '2024-03-04' },
  { id: 'c-1003', name: 'Noah Walsh', company: 'Brightpath', email: 'noah@brightpath.app', status: 'trial', mrr: 0, seats: 5, joined: '2025-05-22' },
  { id: 'c-1004', name: 'Mia Foster', company: 'Cedar & Co', email: 'mia@cedar.com', status: 'active', mrr: 2400, seats: 48, joined: '2023-11-18' },
  { id: 'c-1005', name: 'Ethan Reed', company: 'Quanta Systems', email: 'ethan@quanta.dev', status: 'churned', mrr: 0, seats: 0, joined: '2023-08-09' },
  { id: 'c-1006', name: 'Sophia Nguyen', company: 'Lumen Health', email: 'sophia@lumen.health', status: 'active', mrr: 3150, seats: 62, joined: '2024-01-27' },
  { id: 'c-1007', name: 'Jack Murphy', company: 'Atlas Retail', email: 'jack@atlasretail.com', status: 'trial', mrr: 0, seats: 8, joined: '2025-06-01' },
  { id: 'c-1008', name: 'Olivia Hughes', company: 'Verde Energy', email: 'olivia@verde.energy', status: 'lead', mrr: 0, seats: 0, joined: '2025-06-09' },
  { id: 'c-1009', name: 'Lucas Gray', company: 'Pinnacle AI', email: 'lucas@pinnacle.ai', status: 'active', mrr: 1760, seats: 33, joined: '2024-04-15' },
  { id: 'c-1010', name: 'Emma Price', company: 'Solara', email: 'emma@solara.io', status: 'churned', mrr: 0, seats: 0, joined: '2023-09-30' },
  { id: 'c-1011', name: 'Daniel Cox', company: 'Ironclad Mfg', email: 'daniel@ironclad.com', status: 'active', mrr: 990, seats: 19, joined: '2024-07-02' },
  { id: 'c-1012', name: 'Chloe Ward', company: 'Maple Studio', email: 'chloe@maple.studio', status: 'lead', mrr: 0, seats: 0, joined: '2025-05-30' },
]

export interface Activity {
  id: string
  who: string
  action: string
  when: string
}

export const DEMO_ACTIVITY: Activity[] = [
  { id: 'a1', who: 'Ava Bennett', action: 'upgraded to the Scale plan', when: '2h ago' },
  { id: 'a2', who: 'Jack Murphy', action: 'started a trial', when: '5h ago' },
  { id: 'a3', who: 'Sophia Nguyen', action: 'added 12 seats', when: 'Yesterday' },
  { id: 'a4', who: 'Emma Price', action: 'cancelled their subscription', when: '2d ago' },
  { id: 'a5', who: 'Lucas Gray', action: 'paid invoice #4471', when: '3d ago' },
]

export const FAQ: { q: string; a: string }[] = [
  { q: 'What is this page?', a: 'A showcase of reusable shadcn/ui patterns — tables, search, filters, tabs, modals, CRUD, dropdowns, badges and an accordion — wired to client-side dummy data so you can copy them into real features.' },
  { q: 'Where does the data come from?', a: 'From src/lib/demo-data.ts. It is entirely in-memory; edits in the UI persist only for the session. Replace it with real API calls when building a feature.' },
  { q: 'How do I add a column or field?', a: 'Extend the Customer interface in demo-data.ts, then add a TableHead/TableCell in CustomersPage and a field in the create/edit dialog.' },
  { q: 'Is this safe to ship?', a: 'These are example pages. Keep them while prototyping, then delete the showcase routes (Customers, Components) and demo-data.ts before going to production.' },
]
