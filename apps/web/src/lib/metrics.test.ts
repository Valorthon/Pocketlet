import { describe, it, expect } from 'vitest';
import { incrementMetric, getMetric, getAggregateStats } from './metrics';
import { createUser } from './auth/store';

describe('metrics', () => {
  it('increments and retrieves a metric correctly', async () => {
    await incrementMetric('auth.signup.completed', 3);
    const value = await getMetric('auth.signup.completed');
    expect(value).toBe(3);
  });

  it('accumulates multiple increments for the same metric', async () => {
    await incrementMetric('auth.login.completed', 2);
    await incrementMetric('auth.login.completed', 4);
    const value = await getMetric('auth.login.completed');
    expect(value).toBe(6);
  });

  it('tracks daily and total periods independently', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await incrementMetric('wallet.deploy.success', 1);

    const todayValue = await getMetric('wallet.deploy.success', today);
    const totalValue = await getMetric('wallet.deploy.success');

    expect(todayValue).toBe(1);
    expect(totalValue).toBe(1);
  });

  it('does not mix up different metric keys (regression for && bug)', async () => {
    await incrementMetric('wallet.transfer.success', 7);
    await incrementMetric('wallet.transfer.failure', 3);

    const successValue = await getMetric('wallet.transfer.success');
    const failureValue = await getMetric('wallet.transfer.failure');

    expect(successValue).toBe(7);
    expect(failureValue).toBe(3);
  });

  it('returns 0 for missing metrics', async () => {
    const value = await getMetric('wallet.recovery.completed');
    expect(value).toBe(0);
  });

  it('computes aggregate stats from metrics and users', async () => {
    await createUser('stats@example.com', '000000');
    await incrementMetric('auth.signup.completed', 1);
    await incrementMetric('auth.login.completed', 2);
    await incrementMetric('wallet.deploy.success', 1);

    const stats = await getAggregateStats();

    expect(stats.totalUsers).toBe(1);
    expect(stats.totalWallets).toBe(0);
    expect(stats.totalSignups).toBe(1);
    expect(stats.totalLogins).toBe(2);
    expect(stats.deploymentsTotal).toBe(1);
  });
});
