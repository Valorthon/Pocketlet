'use client';

import { useState, useEffect, useCallback } from 'react';

interface Stats {
  totalUsers: number;
  totalWallets: number;
  totalSignups: number;
  totalLogins: number;
  deploymentsToday: number;
  deploymentsTotal: number;
  submissionsSuccess: number;
  submissionsFailed: number;
  transfersSuccess: number;
  transfersFailed: number;
  recoveryInitiated: number;
  recoveryCompleted: number;
  feePayerBalance: string;
}

export default function AdminPage(): JSX.Element {
  const [token, setToken] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(
    async (authToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? 'Failed to load stats');
        }
        const data = (await res.json()) as Stats;
        setStats(data);
        setAuthenticated(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
      setToken(saved);
      fetchStats(saved);
    }
  }, [fetchStats]);

  const handleLogin = () => {
    sessionStorage.setItem('admin_token', token);
    fetchStats(token);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    setAuthenticated(false);
    setStats(null);
    setToken('');
  };

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
          <h1 className="mb-4 text-xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mb-4 text-sm text-gray-600">Enter your admin secret token.</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Admin secret token"
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading || !token.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Access Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  const StatCard = ({
    label,
    value,
  }: {
    label: string;
    value: string | number;
  }): JSX.Element => (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Pocketlet Admin</h1>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300"
          >
            Log out
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Users" value={stats.totalUsers} />
              <StatCard label="Wallets Deployed" value={stats.totalWallets} />
              <StatCard label="Signups" value={stats.totalSignups} />
              <StatCard label="Logins" value={stats.totalLogins} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Deployments Today" value={stats.deploymentsToday} />
              <StatCard label="Deployments Total" value={stats.deploymentsTotal} />
              <StatCard label="Tx Submissions (OK)" value={stats.submissionsSuccess} />
              <StatCard label="Tx Submissions (Fail)" value={stats.submissionsFailed} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Transfers (OK)" value={stats.transfersSuccess} />
              <StatCard label="Transfers (Fail)" value={stats.transfersFailed} />
              <StatCard label="Recovery Initiated" value={stats.recoveryInitiated} />
              <StatCard label="Recovery Completed" value={stats.recoveryCompleted} />
            </div>

            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Fee Payer XLM Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{stats.feePayerBalance}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
