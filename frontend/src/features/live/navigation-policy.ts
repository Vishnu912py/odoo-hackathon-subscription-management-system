import { isTabAllowedForRole, type NavTab } from '../catalog/navigation.ts'

export type LivePage = NavTab

export interface NavigationItem {
  id: LivePage
  label: string
  icon: string
  desc: string
}

/**
 * Access control for RevOps Shield navigation pages:
 * - Admin: Overview, Subscriptions, Invoices, Payments, catalog configuration, Staff
 * - Staff: Overview, Subscriptions, Invoices, Payments (Staff is admin-only)
 * - Customer: Overview, Subscriptions, Invoices (Payments and Staff are forbidden per OpenAPI contract)
 */
export function isPagePermittedForRole(page: LivePage, role: 'admin' | 'staff' | 'customer'): boolean {
  return isTabAllowedForRole(page, role)
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
    items.push(
      { id: 'Products', label: 'Products', icon: '▤', desc: 'Products configuration' },
      { id: 'Plans', label: 'Plans', icon: '▤', desc: 'Plans configuration' },
      { id: 'Taxes', label: 'Taxes', icon: '▤', desc: 'Taxes configuration' },
      { id: 'Discounts', label: 'Discounts', icon: '▤', desc: 'Discounts configuration' },
      { id: 'Templates', label: 'Templates', icon: '▤', desc: 'Templates configuration' },
    )
    items.push({ id: 'Staff', label: 'Staff Management', icon: '👥', desc: 'Manage staff accounts & invitations' })
  }
  return items
}

