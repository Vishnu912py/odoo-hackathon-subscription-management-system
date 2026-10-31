export type NavTab =
  | 'Overview'
  | 'Subscriptions'
  | 'Invoices'
  | 'Payments'
  | 'Products'
  | 'Plans'
  | 'Taxes'
  | 'Discounts'
  | 'Templates'
  | 'Staff'

export const BASE_TABS: readonly NavTab[] = Object.freeze([
  'Overview',
  'Subscriptions',
  'Invoices',
  'Payments',
])

export const CATALOG_ADMIN_TABS: readonly NavTab[] = Object.freeze([
  'Products',
  'Plans',
  'Taxes',
  'Discounts',
  'Templates',
])

export const ADMIN_TABS: readonly NavTab[] = Object.freeze([
  ...BASE_TABS,
  ...CATALOG_ADMIN_TABS,
  'Staff',
])

export function isCatalogTab(tab: NavTab): boolean {
  return (CATALOG_ADMIN_TABS as readonly string[]).includes(tab)
}

export function isAdminOnlyTab(tab: NavTab): boolean {
  return isCatalogTab(tab) || tab === 'Staff'
}

export function getAllowedTabsForRole(role: 'admin' | 'staff' | 'customer' | string): readonly NavTab[] {
  if (role === 'admin') return ADMIN_TABS
  return BASE_TABS
}

export function isTabAllowedForRole(tab: NavTab, role: 'admin' | 'staff' | 'customer' | string): boolean {
  if (isAdminOnlyTab(tab)) {
    return role === 'admin'
  }
  return true
}

