export type LivePage = 'Overview' | 'Subscriptions' | 'Invoices' | 'Payments' | 'Staff'

export interface NavigationItem {
  id: LivePage
  label: string
  icon: string
  desc: string
}

/**
 * Access control for RevOps Shield navigation pages:
 * - Admin: Overview, Subscriptions, Invoices, Payments, Staff
 * - Staff: Overview, Subscriptions, Invoices, Payments (Staff is admin-only)
 * - Customer: Overview, Subscriptions, Invoices (Payments and Staff are forbidden per OpenAPI contract)
 */
export function isPagePermittedForRole(page: LivePage, role: 'admin' | 'staff' | 'customer'): boolean {
  if (page === 'Staff') return role === 'admin'
  if (page === 'Payments') return role === 'admin' || role === 'staff'
  return true
}

export function getNavigationItems(role: 'admin' | 'staff' | 'customer'): NavigationItem[] {
  const items: NavigationItem[] = [
    { id: 'Overview', label: 'Overview', icon: '◫', desc: 'Revenue analytics & performance summary' },
    { id: 'Subscriptions', label: 'Subscriptions', icon: '↻', desc: 'Subscription contracts & billing cycles' },
    { id: 'Invoices', label: 'Invoices', icon: '▤', desc: 'Billing invoices & payment statuses' },
  ]
  if (role === 'admin' || role === 'staff') {
    items.push({ id: 'Payments', label: 'Payments', icon: '⇄', desc: 'Payment receipts & reconciliation' })
  }
  if (role === 'admin') {
    items.push({ id: 'Staff', label: 'Staff Management', icon: '👥', desc: 'Manage staff accounts & invitations' })
  }
  return items
}

