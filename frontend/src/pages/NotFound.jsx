import { useNavigate } from 'react-router-dom';
import { FileQuestion, ShieldAlert } from 'lucide-react';

export default function NotFound({ forbidden = false }) {
  const navigate = useNavigate();
  const Icon = forbidden ? ShieldAlert : FileQuestion;

  return (
    <div className="empty-state" style={{ paddingTop: 70, paddingBottom: 70 }}>
      <div className="empty-state__icon"><Icon size={28} /></div>
      <h4>{forbidden ? '403 — Access restricted' : '404 — Page not found'}</h4>
      <p>
        {forbidden
          ? 'You do not have permission to view this page. Contact an administrator if you believe you should have access.'
          : "The page you're looking for doesn't exist or has been moved."}
      </p>
      <button type="button" className="btn btn--primary" onClick={() => navigate('/dashboard')}>
        Back to dashboard
      </button>
    </div>
  );
}
