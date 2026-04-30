import { useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './pages/Dashboard'
import Movement from './pages/Movement'
import History from './pages/History'
import Settings from './pages/Settings'
import QuoteBuilder from './pages/QuoteBuilder'
import OrderSheet from './pages/OrderSheet'
import PriceManagement from './pages/PriceManagement'
import { Toast } from './components/Toast'
import { type Material } from './lib/supabase'
import drtLogo from './assets/drt-logo.svg'
import './index.css'

type Page = 'dashboard' | 'movement' | 'history' | 'quote' | 'order' | 'prices' | 'settings'

const queryClient = new QueryClient()

type ToastItem = {
  id: string
  message: string
  type: 'success' | 'error'
}

export default function App() {
  const [page, setPage] = useState<Page>('movement')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(t => t.filter(toast => toast.id !== id))
  }, [])

  const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
    {
      id: 'dashboard', label: 'Dashboard',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>),
    },
    {
      id: 'movement', label: 'Inventory',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>),
    },
    {
      id: 'history', label: 'History',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3M12 2a10 10 0 100 20A10 10 0 0012 2z" strokeLinecap="round" /></svg>),
    },
    {
      id: 'quote', label: 'DRT Quote',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>),
    },
    {
      id: 'order', label: 'Order Sheet',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>),
    },
    {
      id: 'prices', label: 'Prices',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 0v20M2 12h20M12 2c-2.76 3.33-4 6.67-4 10s1.24 6.67 4 10M12 2c2.76 3.33 4 6.67 4 10s-1.24 6.67-4 10" strokeLinecap="round" strokeLinejoin="round" /></svg>),
    },
    {
      id: 'settings', label: 'Settings',
      icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>),
    },
  ]

  return (
    <QueryClientProvider client={queryClient}>
    <div className="layout">
      {/* Sidebar — desktop only */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={drtLogo} alt="DRT Interiors" style={{ width: '100%', maxWidth: 180, height: 'auto', display: 'block' }} />
          <p style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Inventory Control</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p>DRT Interiors Ltd &copy; {new Date().getFullYear()}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {page === 'dashboard' && <Dashboard onNavigateInventory={(_mat: Material) => setPage('movement')} />}
        {page === 'movement' && <Movement showToast={showToast} />}
        {page === 'history' && <History />}
        {page === 'quote' && <QuoteBuilder showToast={showToast} />}
        {page === 'order' && <OrderSheet showToast={showToast} />}
        {page === 'prices' && <PriceManagement showToast={showToast} />}
        {page === 'settings' && <Settings showToast={showToast} />}
      </main>

      {/* Bottom nav — mobile only */}
      <nav className="mobile-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`mobile-nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
    </QueryClientProvider>
  )
}
