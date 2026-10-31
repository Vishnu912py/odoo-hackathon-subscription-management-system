import { useState } from 'react'
import LiveWorkspace from './features/live/LiveWorkspace'
import './App.css'

const navigation = [
  {
    section: 'WORKSPACE',
    items: [
      { label: 'Overview', icon: '◫' },
      { label: 'Subscriptions', icon: '↻' },
      { label: 'Invoices', icon: '▤' },
      { label: 'Payments', icon: '⇄' },
    ],
  },
  {
    section: 'REVENUE OPERATIONS',
    items: [
      { label: 'Recovery queue', icon: '◎' },
      { label: 'Renewals', icon: '◷' },
      { label: 'Customers', icon: '♙' },
    ],
  },
  {
    section: 'MANAGEMENT',
    items: [
      { label: 'Products & plans', icon: '◇' },
      { label: 'Reports', icon: '▥' },
      { label: 'Settings', icon: '⚙' },
    ],
  },
]

type InvoiceSummary = {
  id: string
  number: string
  customer: string
  issue_date: string
  total: string
  balance_due: string
  status: 'draft' | 'confirmed' | 'paid' | 'cancelled'
  is_overdue: boolean
}

const invoices: InvoiceSummary[] = [
  {
    id: 'a1000000-0000-4000-8000-000000000048',
    number: 'INV-2026-0048',
    customer: 'Acme Technologies',
    issue_date: '2026-10-29',
    total: '15000.00',
    balance_due: '10000.00',
    status: 'confirmed',
    is_overdue: true,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000047',
    number: 'INV-2026-0047',
    customer: 'Northstar Labs',
    issue_date: '2026-10-28',
    total: '8500.00',
    balance_due: '0.00',
    status: 'paid',
    is_overdue: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000046',
    number: 'INV-2026-0046',
    customer: 'Vertex Solutions',
    issue_date: '2026-10-27',
    total: '22000.00',
    balance_due: '22000.00',
    status: 'confirmed',
    is_overdue: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000045',
    number: 'INV-2026-0045',
    customer: 'Bluepeak Digital',
    issue_date: '2026-10-25',
    total: '12400.00',
    balance_due: '0.00',
    status: 'paid',
    is_overdue: false,
  },
]

const formatMoney = (value: string) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(Number(value))

const formatInvoiceDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

const getInvoiceDisplayStatus = (invoice: InvoiceSummary) =>
  invoice.is_overdue && Number(invoice.balance_due) > 0
    ? 'Overdue'
    : invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)

const recoveryItems = [
  {
    name: 'Acme Technologies',
    id: 'INV-2026-0048',
    days: '12 days overdue',
    amount: '₹10,000',
    priority: 'High',
  },
  {
    name: 'Vertex Solutions',
    id: 'INV-2026-0046',
    days: '7 days overdue',
    amount: '₹22,000',
    priority: 'Medium',
  },
  {
    name: 'Pioneer Systems',
    id: 'INV-2026-0042',
    days: '3 days overdue',
    amount: '₹4,800',
    priority: 'Low',
  },
]

function DemoDashboard() {
  const [activePage, setActivePage] = useState('Overview')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const pageTitles: Record<string, string> = {
    Overview: 'Revenue overview',
    Subscriptions: 'Subscriptions',
    Invoices: 'Invoices',
    Payments: 'Payments',
    'Recovery queue': 'Payment recovery',
    Renewals: 'Upcoming renewals',
    Customers: 'Customers',
    'Products & plans': 'Products & plans',
    Reports: 'Reports & analytics',
    Settings: 'Workspace settings',
  }

  const selectPage = (label: string) => {
    setActivePage(label)
    setMobileMenuOpen(false)
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside id="main-sidebar" className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`} aria-label="Main sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">
              RevOps<span>Shield</span>
            </div>
            <div className="brand-caption">REVENUE OPERATIONS</div>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">B</div>
          <div className="workspace-info">
            <strong>Brightloop Software</strong>
            <span>Workspace</span>
          </div>
          <span className="switcher-arrow">⌄</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              <p className="nav-heading">{group.section}</p>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  className={`nav-link ${activePage === item.label ? 'active' : ''}`}
                  onClick={() => selectPage(item.label)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.label === 'Recovery queue' && (
                    <span className="nav-count">3</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">?</div>
            <div>
              <strong>Need a hand?</strong>
              <span>Visit our help center</span>
            </div>
            <span className="help-arrow">↗</span>
          </div>
          <div className="profile">
            <div className="profile-avatar">AS</div>
            <div className="profile-info">
              <strong>Albin Savi</strong>
              <span>Administrator</span>
            </div>
            <button className="profile-menu" aria-label="Profile options" disabled>
              ···
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileMenuOpen}
              aria-controls="main-sidebar"
            >
              ☰
            </button>
            <div className="breadcrumbs">
              Workspace <span>/</span> <strong>{activePage}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="environment-label">
              <i /> Demo environment
            </span>
            <button className="icon-button" aria-label="Notifications" disabled>
              ♧<i />
            </button>
            <div className="topbar-avatar">AS</div>
          </div>
        </header>

        <div className="page-content">
          {activePage === 'Overview' ? (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow">SATURDAY, OCTOBER 31, 2026</p>
                  <h1>Revenue overview</h1>
                  <p className="page-subtitle">
                    Here's what's happening with your subscriptions and revenue.
                  </p>
                </div>
                <button className="primary-button" onClick={() => selectPage('Invoices')}>
                  <span>＋</span> View invoices
                </button>
              </section>

              <section className="stats-grid" aria-label="Revenue statistics">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Total invoiced</span>
                    <span className="stat-icon green">₹</span>
                  </div>
                  <div className="stat-value">₹8,42,500</div>
                  <div className="stat-foot">
                    <span className="trend positive">↗ 12.8%</span>
                    <span> vs last month</span>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Active subscriptions</span>
                    <span className="stat-icon blue">↻</span>
                  </div>
                  <div className="stat-value">248</div>
                  <div className="stat-foot">
                    <span className="trend positive">↗ 8.2%</span>
                    <span> vs last month</span>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Payments received</span>
                    <span className="stat-icon purple">⇄</span>
                  </div>
                  <div className="stat-value">₹6,18,200</div>
                  <div className="stat-foot">
                    <span className="trend positive">↗ 6.4%</span>
                    <span> vs last month</span>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Outstanding balance</span>
                    <span className="stat-icon orange">!</span>
                  </div>
                  <div className="stat-value">₹1,24,300</div>
                  <div className="stat-foot">
                    <span className="trend negative">↑ 3.1%</span>
                    <span> needs attention</span>
                  </div>
                </article>
              </section>

              <section className="content-grid">
                <article className="panel revenue-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Revenue performance</h2>
                      <p>Monthly invoiced amount · illustrative demo</p>
                    </div>
                    <button className="select-button" disabled>
                      Last 6 months⌄
                    </button>
                  </div>
                  <div className="chart-summary">
                    <strong>₹8,42,500</strong>
                    <span className="trend positive">↗ 12.8%</span>
                  </div>
                  <div className="chart">
                    {[42, 57, 48, 72, 64, 88].map((height, index) => (
                      <div className="chart-column" key={index}>
                        <div className="bar-track">
                          <div
                            className={`bar ${index === 5 ? 'bar-current' : ''}`}
                            style={{ height: `${height}%` }}
                          />
                        </div>
                        <span>{['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'][index]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="chart-note">
                    <span className="legend-dot" /> Amount invoiced
                    <span className="chart-period">Illustrative demo data</span>
                  </div>
                </article>

                <article className="panel recovery-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recovery overview</h2>
                      <p>Invoices that need attention</p>
                    </div>
                    <span className="attention-count">3 open</span>
                  </div>
                  <div className="recovery-total">
                    <span>Total to recover</span>
                    <strong>₹36,800</strong>
                  </div>
                  <div className="recovery-progress"><span /></div>
                  <div className="recovery-meta">
                    <span>₹18,200 recovered</span>
                    <span>33% progress</span>
                  </div>
                  <div className="priority-row">
                    <span className="priority-dot high" /> High priority <strong>1</strong>
                  </div>
                  <div className="priority-row">
                    <span className="priority-dot medium" /> Medium priority <strong>1</strong>
                  </div>
                  <div className="priority-row">
                    <span className="priority-dot low" /> Low priority <strong>1</strong>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => selectPage('Recovery queue')}
                  >
                    Open recovery queue →
                  </button>
                </article>
              </section>

              <section className="panel table-panel">
                <div className="panel-heading table-heading">
                  <div>
                    <h2>Recent invoices</h2>
                    <p>Keep track of your latest billing activity</p>
                  </div>
                  <button className="text-button" onClick={() => selectPage('Invoices')}>
                    View all invoices →
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>INVOICE</th>
                        <th>CUSTOMER</th>
                        <th>ISSUE DATE</th>
                        <th>AMOUNT</th>
                        <th>STATUS</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice) => {
                        const displayStatus = getInvoiceDisplayStatus(invoice)
                        return (
                          <tr key={invoice.id}>
                            <td className="invoice-id">{invoice.number}</td>
                            <td>{invoice.customer}</td>
                            <td>{formatInvoiceDate(invoice.issue_date)}</td>
                            <td className="amount-cell">{formatMoney(invoice.total)}</td>
                            <td>
                              <span className={`status-badge ${displayStatus.toLowerCase()}`}>
                                {displayStatus}
                              </span>
                            </td>
                            <td>
                              <button
                                className="row-menu"
                                aria-label={`More options for ${invoice.number}`}
                                disabled
                                title="Invoice actions are not available yet"
                              >
                                ···
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="demo-notice">
                Demo interface · All displayed figures and records are illustrative, not live financial data.
              </p>
            </>
          ) : (
            <section className="placeholder-page">
              <p className="eyebrow">REVOPS SHIELD WORKSPACE</p>
              <h1>{pageTitles[activePage]}</h1>
              <p className="page-subtitle">
                This section is part of the frontend foundation. Live records and actions will be connected through the shared API contract.
              </p>
              {activePage === 'Recovery queue' ? (
                <div className="panel recovery-list">
                  <div className="panel-heading">
                    <div>
                      <h2>Invoices requiring follow-up</h2>
                      <p>Prioritized by overdue duration</p>
                    </div>
                    <span className="attention-count">3 open</span>
                  </div>
                  {recoveryItems.map((item) => (
                    <div className="recovery-item" key={item.id}>
                      <div className="recovery-customer">
                        <strong>{item.name}</strong>
                        <span>{item.id} · {item.days}</span>
                      </div>
                      <strong className="recovery-amount">{item.amount}</strong>
                      <span className={`priority-label ${item.priority.toLowerCase()}`}>
                        {item.priority}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel coming-soon">
                  <div className="coming-icon">◇</div>
                  <h2>{pageTitles[activePage]}</h2>
                  <p>
                    The page layout is ready for integration. Backend data and permitted actions will be added as the team API becomes available.
                  </p>
                  <button className="primary-button" onClick={() => selectPage('Overview')}>
                    ← Back to overview
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [preview, setPreview] = useState(() => new URLSearchParams(window.location.search).get('preview') === 'design')
  return <>
    {preview && <div className="connection-mode">
      <strong>{preview ? 'Design preview · illustrative data only' : 'Live backend workspace'}</strong>
      <button onClick={() => setPreview(value => !value)}>{preview ? 'Open live workspace' : 'View Albin’s design preview'}</button>
    </div>}
    {preview ? <div className="demo-preview"><DemoDashboard /></div> : <LiveWorkspace />}
  </>
}
