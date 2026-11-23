import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, ClipboardCheck, Building2, Users, Bell, ShieldCheck,
  FileBarChart, Recycle, CalendarClock, DatabaseBackup, Settings, UserRound,
  LogOut, Menu, X, Search, ChevronDown, GraduationCap, Check,
} from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { initials, relativeTime } from '../utils/format.js';
import { useToast } from './ui.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: '*' },
  { to: '/documents', label: 'Documents', icon: FolderOpen, roles: '*' },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD'] },
  { to: '/expirations', label: 'Expirations', icon: CalendarClock, roles: '*' },
  { to: '/analytics', label: 'Analytics & Reports', icon: FileBarChart, roles: ['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD'] },
  { to: '/departments', label: 'Departments', icon: Building2, roles: '*' },
  { to: '/audit', label: 'Audit Logs', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD'] },
  { to: '/trash', label: 'Recycle Bin', icon: Recycle, roles: ['SUPER_ADMIN', 'DEPARTMENT_HEAD'] },
  { to: '/backups', label: 'Backups', icon: DatabaseBackup, roles: ['SUPER_ADMIN'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['SUPER_ADMIN'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN'] },
];

export default function Layout() {
  const { user, logout, hasRole, roleLabel } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const notifRef = useRef(null);

  const loadNotifications = async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch { /* notifications are non-critical */ }
  };

  useEffect(() => { loadNotifications(); }, [location.pathname]);
  useEffect(() => {
    const close = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const links = useMemo(() => NAV.filter((item) => item.roles === '*' || hasRole(...item.roles)), [hasRole]);

  const doLogout = async () => {
    await logout();
    toast.info('You have been signed out.');
    navigate('/login', { replace: true });
  };

  const markRead = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((items) => items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
    } catch { /* ignore */ }
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((items) => items.map((n) => ({ ...n, isRead: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <div className="brand-mark"><GraduationCap size={22} /></div>
          <div>
            <strong>LLCC DMS</strong>
            <span>Document Repository</span>
          </div>
          <button type="button" className="icon-btn sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <nav className="sidebar__nav" aria-label="Main navigation">
          <p className="sidebar__label">WORKSPACE</p>
          {links.slice(0, 5).map((item) => <NavItem key={item.to} item={item} onNavigate={() => setSidebarOpen(false)} />)}
          <p className="sidebar__label">MANAGEMENT</p>
          {links.slice(5).map((item) => <NavItem key={item.to} item={item} onNavigate={() => setSidebarOpen(false)} />)}
        </nav>
        <div className="sidebar__footer">
          <NavLink to="/profile" className={({ isActive }) => `sidebar__profile ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
            <span className="avatar avatar--sm">{initials(user?.name)}</span>
            <span className="sidebar__profile-text"><strong>{user?.name}</strong><small>{roleLabel}</small></span>
          </NavLink>
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      <div className="main-shell">
        <header className="topbar">
          <button type="button" className="icon-btn topbar__menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <form className="topbar__search" onSubmit={(e) => { e.preventDefault(); navigate(`/documents?q=${encodeURIComponent(quickSearch)}`); setSidebarOpen(false); }}>
            <Search size={18} />
            <input value={quickSearch} onChange={(e) => setQuickSearch(e.target.value)} placeholder="Search documents, references, keywords…" aria-label="Search documents" />
            <kbd>Enter</kbd>
          </form>
          <div className="topbar__actions">
            <div className="notif-wrap" ref={notifRef}>
              <button type="button" className="icon-btn topbar__bell" onClick={() => setNotifOpen((v) => !v)} aria-label="Notifications">
                <Bell size={20} />
                {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {notifOpen && (
                <div className="popover notif-popover">
                  <div className="popover__head">
                    <strong>Notifications</strong>
                    {unread > 0 && <button type="button" className="link-btn" onClick={markAll}><Check size={14} /> Mark all read</button>}
                  </div>
                  <div className="notif-list">
                    {notifications.length === 0 && <p className="muted padded">You're all caught up.</p>}
                    {notifications.slice(0, 6).map((n) => (
                      <button type="button" key={n.id} className={`notif-item ${n.isRead ? '' : 'notif-item--unread'}`} onClick={() => { if (!n.isRead) markRead(n.id); if (n.document?.id) navigate(`/documents/${n.document.id}`); setNotifOpen(false); }}>
                        <span className={`notif-item__dot notif-item__dot--${n.type?.toLowerCase()}`} />
                        <span><strong>{n.title}</strong><small>{n.message}</small><em>{relativeTime(n.createdAt)}</em></span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="popover__foot" onClick={() => { navigate('/notifications'); setNotifOpen(false); }}>View all notifications</button>
                </div>
              )}
            </div>
            <div className="user-menu-wrap">
              <button type="button" className="topbar__user" onClick={() => setUserOpen((v) => !v)}>
                <span className="avatar">{initials(user?.name)}</span>
                <span className="topbar__user-text"><strong>{user?.name}</strong><small>{roleLabel}</small></span>
                <ChevronDown size={15} />
              </button>
              {userOpen && (
                <div className="popover user-popover">
                  <div className="popover__head"><strong>{user?.name}</strong><small>{user?.email}</small></div>
                  <button type="button" onClick={() => { navigate('/profile'); setUserOpen(false); }}><UserRound size={16} /> My profile</button>
                  <button type="button" onClick={() => { navigate('/notifications'); setUserOpen(false); }}><Bell size={16} /> Notifications</button>
                  <button type="button" className="danger" onClick={doLogout}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Lapu-Lapu City College | Document Management System</span>
          <span>Secure institutional repository</span>
        </footer>
      </div>
    </div>
  );
}

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} onClick={onNavigate} className={({ isActive }) => `sidebar__link ${isActive || (item.to !== '/documents' && location.pathname.startsWith(`${item.to}/`)) ? 'active' : ''}`}>
      <Icon size={18} /><span>{item.label}</span>
    </NavLink>
  );
}
