/**
 * Dummy data for the static showcase page (ComponentsPage). Entirely client-side.
 *
 * NOTE: the Customers page is no longer backed by this file — it now talks to the
 * real `/customers` API (see src/lib/customers.ts). What remains here only feeds
 * the read-only Components gallery.
 */

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
  { q: 'What is this page?', a: 'A showcase of reusable shadcn/ui patterns — tables, search, filters, tabs, modals, CRUD, dropdowns, badges and an accordion — that you can copy into real features.' },
  { q: 'Where does customer data come from?', a: 'The Customers page is wired to the real /customers API (src/lib/customers.ts + backend/app/customers.py). This file only holds the static demo content for this gallery.' },
  { q: 'How do I add a column or field to Customers?', a: 'Add the column in migrations + backend/app/customers.py, extend the Customer type in src/lib/customers.ts, then add a TableHead/TableCell and a field in the create/edit dialog.' },
  { q: 'Is this safe to ship?', a: 'The Components gallery is an example page — delete the route and this file before going to production. The Customers feature is real and safe to build on.' },
]
