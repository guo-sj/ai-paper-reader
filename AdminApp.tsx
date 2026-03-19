import React, { useEffect, useState } from 'react';
import { clearAnalysisCache } from './services/analysisCache';
import { clearPapersCache } from './services/papersCache';

interface Subscriber {
  id: number;
  email: string;
  subscribed_at: string;
  categories: string[];
}

type View = 'login' | 'dashboard';

const AdminApp: React.FC = () => {
  const [view, setView] = useState<View>('login');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/admin/me', {
          credentials: 'include',
        });
        if (!res.ok) {
          setView('login');
        } else {
          const data = await res.json();
          setView(data.authenticated ? 'dashboard' : 'login');
        }
      } catch {
        setView('login');
      } finally {
        setChecking(false);
      }
    };
    checkAuth();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-600">
        Checking admin session...
      </div>
    );
  }

  return view === 'login' ? (
    <AdminLogin onSuccess={() => setView('dashboard')} />
  ) : (
    <AdminDashboard onLogout={() => setView('login')} />
  );
};

const AdminLogin: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setStatus('error');
        setMessage(data.error || 'Login failed');
        return;
      }
      setStatus('idle');
      onSuccess();
    } catch {
      setStatus('error');
      setMessage('Network error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-xl shadow border border-slate-200 p-6">
        <h1 className="text-xl font-bold mb-4 text-slate-800">Admin Login</h1>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Username
            </label>
            <input
              type="text"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={status === 'loading'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === 'loading'}
            />
          </div>
          {status === 'error' && (
            <p className="text-sm text-red-600">{message}</p>
          )}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

const AdminDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'success'>('idle');

  const loadSubscribers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/subscribers', {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load subscribers');
      } else {
        setSubscribers(data.subscribers || []);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscribers();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setAdding(true);
    try {
      const res = await fetch('/api/admin/subscribers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, sendWelcome: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to add subscriber');
      } else {
        setNewEmail('');
        await loadSubscribers();
      }
    } catch {
      alert('Network error');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this subscriber?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/subscribers/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to delete subscriber');
      } else {
        setSubscribers((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      alert('Network error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail) return;
    setSendingTest(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      const res = await fetch('/api/admin/send-test-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestStatus('error');
        setTestMessage(data.error || 'Failed to send test email');
        return;
      }
      setTestStatus('success');
      setTestMessage('Test email sent successfully.');
    } catch {
      setTestStatus('error');
      setTestMessage('Network error');
    } finally {
      setSendingTest(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    onLogout();
  };

  const handleClearCache = () => {
    clearPapersCache();
    clearAnalysisCache();
    setCacheStatus('success');
    window.setTimeout(() => setCacheStatus('idle'), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Subscribers Admin</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          Logout
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <section className="mb-6 bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Overview
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Total subscribers:{' '}
              <span className="font-semibold">{subscribers.length}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearCache}
                className="px-3 py-2 bg-white text-slate-700 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
              >
                清理缓存
              </button>
              {cacheStatus === 'success' && (
                <span className="text-xs text-green-600">已清理</span>
              )}
            </div>
          </div>
        </section>

        <section className="mb-6 bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Add Subscriber
          </h2>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={handleAdd}
          >
            <input
              type="email"
              placeholder="email@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={adding}
            />
            <button
              type="submit"
              disabled={adding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </form>
        </section>

        <section className="mb-6 bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Send Test Email
          </h2>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={handleSendTest}
          >
            <input
              type="email"
              placeholder="recipient@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={sendingTest}
            />
            <button
              type="submit"
              disabled={sendingTest}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {sendingTest ? 'Sending...' : 'Send'}
            </button>
          </form>
          {testStatus !== 'idle' && (
            <p
              className={`mt-2 text-sm ${
                testStatus === 'success' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {testMessage}
            </p>
          )}
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Subscribers
          </h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : subscribers.length === 0 ? (
            <p className="text-sm text-slate-500">No subscribers found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-4 font-medium text-slate-600">
                      ID
                    </th>
                    <th className="py-2 pr-4 font-medium text-slate-600">
                      Email
                    </th>
                    <th className="py-2 pr-4 font-medium text-slate-600">
                      Subscribed At
                    </th>
                    <th className="py-2 pr-4 font-medium text-slate-600">
                      Categories
                    </th>
                    <th className="py-2 pr-4 font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-2 pr-4 text-slate-700">{s.id}</td>
                      <td className="py-2 pr-4 text-slate-800">{s.email}</td>
                      <td className="py-2 pr-4 text-slate-600">
                        {new Date(s.subscribed_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-slate-600">
                        {s.categories.length === 0 ? (
                          <span className="text-slate-400">全部</span>
                        ) : (
                          s.categories.join(', ')
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          {deletingId === s.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminApp;


