import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db';

const { metrics } = schema;

export type MetricKey =
  | 'wallet.deploy.success'
  | 'wallet.deploy.failure'
  | 'wallet.submit.success'
  | 'wallet.submit.failure'
  | 'wallet.transfer.success'
  | 'wallet.transfer.failure'
  | 'wallet.recovery.initiated'
  | 'wallet.recovery.completed'
  | 'auth.signup.completed'
  | 'auth.login.completed'
  | 'auth.passkey.registration.failure';

function getPeriod(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function incrementMetric(
  key: MetricKey,
  count = 1
): Promise<void> {
  const period = getPeriod();

  await db
    .insert(metrics)
    .values({ key, period, value: count })
    .onConflictDoUpdate({
      target: [metrics.key, metrics.period],
      set: {
        value: sql`${metrics.value} + ${count}`,
        updatedAt: new Date(),
      },
    });

  await db
    .insert(metrics)
    .values({ key, period: 'total', value: count })
    .onConflictDoUpdate({
      target: [metrics.key, metrics.period],
      set: {
        value: sql`${metrics.value} + ${count}`,
        updatedAt: new Date(),
      },
    });
}

export async function getMetric(
  key: MetricKey,
  period?: string
): Promise<number> {
  const row = await db.query.metrics.findFirst({
    where: eq(metrics.key, key) && eq(metrics.period, period ?? 'total'),
  });
  return row?.value ?? 0;
}

export interface AggregateStats {
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
}

export async function getAggregateStats(): Promise<AggregateStats> {
  const today = getPeriod();

  const [
    usersResult,
    walletsResult,
    signups,
    logins,
    deployToday,
    deployTotal,
    submitSuccess,
    submitFailed,
    transferSuccess,
    transferFailed,
    recoveryInit,
    recoveryDone,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(schema.users),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(sql`${schema.users.walletContractId} is not null`),
    getMetric('auth.signup.completed'),
    getMetric('auth.login.completed'),
    getMetric('wallet.deploy.success', today),
    getMetric('wallet.deploy.success'),
    getMetric('wallet.submit.success'),
    getMetric('wallet.submit.failure'),
    getMetric('wallet.transfer.success'),
    getMetric('wallet.transfer.failure'),
    getMetric('wallet.recovery.initiated'),
    getMetric('wallet.recovery.completed'),
  ]);

  return {
    totalUsers: usersResult[0]?.count ?? 0,
    totalWallets: walletsResult[0]?.count ?? 0,
    totalSignups: signups,
    totalLogins: logins,
    deploymentsToday: deployToday,
    deploymentsTotal: deployTotal,
    submissionsSuccess: submitSuccess,
    submissionsFailed: submitFailed,
    transfersSuccess: transferSuccess,
    transfersFailed: transferFailed,
    recoveryInitiated: recoveryInit,
    recoveryCompleted: recoveryDone,
  };
}
