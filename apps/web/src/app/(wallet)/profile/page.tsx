'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Fingerprint, KeyRound, ShieldCheck, Shield } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { clearDeviceKey } from '@/lib/wallet/device-key';

interface ProfileData {
  email: string;
  username?: string;
  phone?: string;
  hasBackupPasskey?: boolean;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [hasPin, setHasPin] = useState<boolean | null>(null);
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

    const loadPin = async () => {
      try {
        const res = await fetch('/api/auth/pin');
        if (res.ok) {
          const body = (await res.json()) as { hasPin?: boolean };
          setHasPin(body.hasPin ?? false);
        }
      } catch {
        setHasPin(false);
      }
    };

    loadProfile();
    loadPin();
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

  const logout = async () => {
    await clearDeviceKey();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <h3 className="text-base font-bold text-slate-900">Account & Security</h3>

      <Card padded="md" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Passkey Authentication</p>
              <p className="text-[10px] text-slate-400">WebAuthn / device passkey active</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            Enabled
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-pocketlet-50 p-2 text-pocketlet-600">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Payment PIN</p>
              <p className="text-[10px] text-slate-400">
                {hasPin ? '6-digit PIN set' : 'Required to confirm payments'}
              </p>
            </div>
          </div>
          <Link
            href={hasPin ? '/pin/reset' : '/pin/setup'}
            className="rounded-lg bg-pocketlet-100 px-3 py-1.5 text-xs font-bold text-pocketlet-700 hover:bg-pocketlet-200"
          >
            {hasPin ? 'Reset' : 'Set up'}
          </Link>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-pocketlet-50 p-2 text-pocketlet-600">
              <Fingerprint className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Backup Recovery Phrase</p>
              <p className="text-[10px] text-slate-400">Export coming in a future version</p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled>
            View
          </Button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Backup Passkey</p>
              <p className="text-[10px] text-slate-400">
                {profile?.hasBackupPasskey ? 'Secondary device passkey set' : 'Add a second passkey for safety'}
              </p>
            </div>
          </div>
          <Link
            href="/backup-passkey"
            className="rounded-lg bg-pocketlet-100 px-3 py-1.5 text-xs font-bold text-pocketlet-700 hover:bg-pocketlet-200"
          >
            {profile?.hasBackupPasskey ? 'Add another' : 'Set up'}
          </Link>
        </div>
      </Card>

      {profile && (
        <Card padded="md">
          <h4 className="mb-3 text-sm font-bold text-slate-900">Personal Details</h4>

          {error && <div className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          {success && (
            <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Email</label>
              <input
                type="email"
                value={profile.email}
                disabled
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Username</label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-slate-500">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                  placeholder="username"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-8 pr-3.5 text-sm text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                3-30 characters; letters, numbers, underscores, periods, and hyphens.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+63 912 345 6789"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
              />
              <p className="mt-1 text-xs text-slate-500">Include your country code starting with +.</p>
            </div>

            <Button type="submit" fullWidth isLoading={saving}>
              Save profile
            </Button>
          </form>
        </Card>
      )}

      <Button variant="destructive" fullWidth onClick={logout}>
        Log out
      </Button>
    </div>
  );
}
