import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Eye, EyeOff, GraduationCap, Loader2, LockKeyhole, LogIn, Mail,
  QrCode, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import { Loading } from '../components/ui.jsx';
import '../styles/login.css';

const FEATURES = [
  { icon: ShieldCheck, label: 'Role-based access control' },
  { icon: RefreshCw, label: 'Complete version control' },
  { icon: QrCode, label: 'QR code document verification' },
];

function destinationFrom(location) {
  const from = location?.state?.from;
  if (!from) return '/dashboard';
  if (typeof from === 'string') return from;
  return `${from.pathname || '/dashboard'}${from.search || ''}${from.hash || ''}`;
}

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <Loading label="Checking your session…" />;
  if (user) return <Navigate to={destinationFrom(location)} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter both your email address and password.');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(destinationFrom(location), { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to sign in. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-hero__brand">
          <div className="brand-mark"><GraduationCap size={22} /></div>
          <span>LLCC Document Management System</span>
        </div>

        <div className="login-hero__body">
          <h1>Secure institutional records, one trusted repository.</h1>
          <p>
            A central, auditable workspace for college documents — from first draft
            to final approval and verified sharing.
          </p>
          <div className="login-hero__features">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label}>
                <span><Icon size={16} /></span>
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="login-hero__foot">
          © {new Date().getFullYear()} Laguna College · Authorized personnel only
        </div>
      </section>

      <section className="login-panel">
        <div className="login-box">
          <h2>Welcome back</h2>
          <p>Sign in to continue to your document workspace.</p>

          {error && <div className="login-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <div className="input-with-icon">
                <Mail size={17} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@llcc.edu"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon input-with-icon--toggle">
                <LockKeyhole size={17} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn--primary btn--block login-submit" disabled={busy}>
              {busy ? <><Loader2 size={17} className="spin" /> Signing in…</> : <><LogIn size={17} /> Sign in</>}
            </button>
          </form>

          <div className="login-hint">
            <strong>Development bootstrap account</strong><br />
            For initial setup only — <code>admin@llcc.edu</code> / <code>Admin@12345</code>
          </div>
        </div>
      </section>
    </div>
  );
}
