import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, CalendarClock, Check, CheckCircle2, FileText,
  Info, RefreshCw, XCircle,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { EmptyState, Loading, useToast } from '../components/ui.jsx';
import { formatDateTime, relativeTime } from '../utils/format.js';
import '../styles/notifications.css';

const TYPE_META = {
  APPROVAL: { icon: CheckCircle2, tone: 'approval' },
  APPROVED: { icon: CheckCircle2, tone: 'approval' },
  REJECTION: { icon: XCircle, tone: 'rejection' },
  REJECTED: { icon: XCircle, tone: 'rejection' },
  REVISION: { icon: AlertTriangle, tone: 'warning' },
  REVISION_REQUESTED: { icon: AlertTriangle, tone: 'warning' },
  EXPIRATION: { icon: CalendarClock, tone: 'expiration' },
  EXPIRING: { icon: CalendarClock, tone: 'expiration' },
  DOCUMENT: { icon: FileText, tone: 'document' },
  UPLOAD: { icon: FileText, tone: 'document' },
  SYSTEM: { icon: Info, tone: 'info' },
};

function metaFor(type) {
  return TYPE_META[String(type || '').toUpperCase()] || { icon: Bell, tone: 'info' };
}

export default function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch (err) {
      const message = errorMessage(err, 'Unable to load notifications.');
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const markRead = useCallback(async (id) => {
    setBusyId(id);
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((items) => items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnread((count) => Math.max(0, count - 1));
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to mark the notification as read.'));
    } finally {
      setBusyId(null);
    }
  }, [toast]);

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all');
      setNotifications((items) => items.map((n) => ({ ...n, isRead: true })));
      setUnread(0);
      toast.success('All notifications marked as read.');
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to mark all notifications as read.'));
    } finally {
      setMarkingAll(false);
    }
  };

  const handleOpen = (notification) => {
    if (!notification.isRead) markRead(notification.id);
    if (notification.document?.id) navigate(`/documents/${notification.document.id}`);
  };

  const shown = useMemo(
    () => (tab === 'unread' ? notifications.filter((n) => !n.isRead) : notifications),
    [notifications, tab],
  );

  if (loading && !notifications.length && !loadError) return <Loading label="Loading notifications…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>
            {unread > 0
              ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.`
              : "You're all caught up."}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={markAll} disabled={unread === 0 || markingAll}>
            <Check size={16} /> {markingAll ? 'Updating…' : 'Mark all read'}
          </button>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <div className="tabs" role="tablist" aria-label="Notification filter">
            <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
              All <span className="tabs__count">{notifications.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>
              Unread <span className="tabs__count">{unread}</span>
            </button>
          </div>
        </div>
        <div className="card__body card__body--flush">
          {loadError && !notifications.length ? (
            <div className="empty-state">
              <div className="empty-state__icon"><RefreshCw size={26} /></div>
              <h4>Couldn't load notifications</h4>
              <p>{loadError}</p>
              <button type="button" className="btn btn--primary" onClick={load}><RefreshCw size={15} /> Retry</button>
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={tab === 'unread' ? CheckCircle2 : Bell}
              title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              message={tab === 'unread' ? 'Everything has been read. Nice work!' : 'Updates about approvals, revisions and expirations will appear here.'}
            />
          ) : (
            <div className="notif-page__list">
              {shown.map((notification) => {
                const { icon: Icon, tone } = metaFor(notification.type);
                return (
                  <div
                    key={notification.id}
                    role="button"
                    tabIndex={0}
                    className={`notif-item notif-page__item ${notification.isRead ? '' : 'notif-item--unread'}`}
                    onClick={() => handleOpen(notification)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleOpen(notification);
                      }
                    }}
                  >
                    <span className={`notif-page__icon notif-page__icon--${tone}`}><Icon size={17} /></span>
                    <div className="notif-page__content">
                      <div className="notif-page__title">
                        <strong>{notification.title}</strong>
                        {!notification.isRead && <span className="notif-page__new">New</span>}
                      </div>
                      {notification.message && <p>{notification.message}</p>}
                      <div className="notif-page__meta">
                        {notification.actor?.name && <span>by {notification.actor.name}</span>}
                        {notification.document?.title && (
                          <>
                            <span>·</span>
                            <Link
                              to={`/documents/${notification.document.id}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {notification.document.title}
                            </Link>
                          </>
                        )}
                        <span>·</span>
                        <time title={formatDateTime(notification.createdAt)}>{relativeTime(notification.createdAt)}</time>
                      </div>
                    </div>
                    {!notification.isRead && (
                      <button
                        type="button"
                        className="icon-btn notif-page__read"
                        aria-label="Mark as read"
                        title="Mark as read"
                        disabled={busyId === notification.id}
                        onClick={(event) => { event.stopPropagation(); markRead(notification.id); }}
                      >
                        <Check size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
