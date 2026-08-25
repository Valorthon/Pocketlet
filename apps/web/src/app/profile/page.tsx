'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ProfileData {
  email: string;
  username?: string;
  phone?: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (!res.ok) {
          setError('Failed to load profile');
          setLoading(false);
          return;
        }
        const body = (await res.json()) as { user: ProfileData };
        setProfile(body.user);
        setUsername(body.user.username ?? '');
        setPhone(body.user.phone ?? '');
      } catch {
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim() || null,
          phone: phone.trim() || null,
        }),
      });

      const body = (await res.json()) as { error?: string; username?: string; phone?: string };
      if (!res.ok) {
        setError(body.error ?? 'Failed to save profile');
        return;
      }

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              username: body.username,
              phone: body.phone,
            }
          : null
      );
      setUsername(body.username ?? '');
      setPhone(body.phone ?? '');
      setSuccess('Profile saved');
    } catch {
      setError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading profile...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
            ← Pocketlet
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <h1 className="mb-4 text-xl font-semibold text-gray-900">Profile</h1>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>
          )}

          {profile && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-gray-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-gray-500">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                    placeholder="username"
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 pl-8 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  3-30 characters; letters, numbers, underscores, periods, and hyphens.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Phone number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+63 912 345 6789"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Include your country code starting with +.
                </p>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-pocketlet-600 py-3 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save profile'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
