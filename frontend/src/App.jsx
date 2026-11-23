import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Documents from './pages/Documents.jsx';
import DocumentDetail from './pages/DocumentDetail.jsx';
import Approvals from './pages/Approvals.jsx';
import Departments from './pages/Departments.jsx';
import Users from './pages/Users.jsx';
import Notifications from './pages/Notifications.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Analytics from './pages/Analytics.jsx';
import Expirations from './pages/Expirations.jsx';
import RecycleBin from './pages/RecycleBin.jsx';
import Assistant from './pages/Assistant.jsx';
import Backups from './pages/Backups.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import Verify from './pages/Verify.jsx';
import NotFound from './pages/NotFound.jsx';

function Splash() {
  return <div className="loading" style={{ minHeight: '100vh' }}><Loader2 className="spin" size={26} /> Loading LLCC DMS…</div>;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RoleRoute({ roles, children }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/forbidden" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/verify/:code" element={<Verify />} />
            <Route path="/forbidden" element={<ProtectedRoute><NotFound forbidden /></ProtectedRoute>} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/documents/:id" element={<DocumentDetail />} />
              <Route path="/approvals" element={<RoleRoute roles={['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD']}><Approvals /></RoleRoute>} />
              <Route path="/expirations" element={<Expirations />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/departments" element={<Departments />} />
              <Route path="/analytics" element={<RoleRoute roles={['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD']}><Analytics /></RoleRoute>} />
              <Route path="/audit" element={<RoleRoute roles={['SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD']}><AuditLogs /></RoleRoute>} />
              <Route path="/trash" element={<RoleRoute roles={['SUPER_ADMIN', 'DEPARTMENT_HEAD']}><RecycleBin /></RoleRoute>} />
              <Route path="/backups" element={<RoleRoute roles={['SUPER_ADMIN']}><Backups /></RoleRoute>} />
              <Route path="/users" element={<RoleRoute roles={['SUPER_ADMIN']}><Users /></RoleRoute>} />
              <Route path="/settings" element={<RoleRoute roles={['SUPER_ADMIN']}><Settings /></RoleRoute>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
