import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('llcc_user') || 'null');
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('llcc_token'));
  const [loading, setLoading] = useState(Boolean(token));

  const clear = useCallback(() => {
    localStorage.removeItem('llcc_token');
    localStorage.removeItem('llcc_user');
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('llcc_token')) {
      clear();
      return null;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      localStorage.setItem('llcc_user', JSON.stringify(data.user));
      return data.user;
    } catch {
      clear();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    if (token) refresh();
    else setLoading(false);
    const onUnauthorized = () => clear();
    window.addEventListener('llcc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('llcc:unauthorized', onUnauthorized);
  }, [token, refresh, clear]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('llcc_token', data.token);
    localStorage.setItem('llcc_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setLoading(false);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* local logout still succeeds */
    }
    clear();
  }, [clear]);

  const hasRole = useCallback((...roles) => Boolean(user && roles.includes(user.role)), [user]);

  const isAdmin = hasRole('SUPER_ADMIN');
  const canApprove = hasRole('SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD');
  const canViewAdmin = hasRole('SUPER_ADMIN', 'DEAN');
  const canManageDepartments = isAdmin;
  const canManageBackups = isAdmin;
  const canExport = hasRole('SUPER_ADMIN', 'DEAN', 'DEPARTMENT_HEAD');
  const canUseTrash = hasRole('SUPER_ADMIN', 'DEPARTMENT_HEAD');

  const value = useMemo(() => ({
    user, token, loading, login, logout, refresh, clear, hasRole,
    isAdmin, canApprove, canViewAdmin, canManageDepartments, canManageBackups, canExport, canUseTrash,
    roleLabel: {
      SUPER_ADMIN: 'Super Administrator',
      DEAN: 'Dean',
      DEPARTMENT_HEAD: 'Department Head',
      STAFF: 'Staff',
    }[user?.role] || '',
    updateProfile: async (payload) => {
      const { data } = await api.put('/auth/profile', payload);
      setUser(data.user);
      localStorage.setItem('llcc_user', JSON.stringify(data.user));
      return data.user;
    },
  }), [user, token, loading, login, logout, refresh, clear, hasRole, isAdmin, canApprove, canViewAdmin, canManageDepartments, canManageBackups, canExport, canUseTrash]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export { errorMessage };
