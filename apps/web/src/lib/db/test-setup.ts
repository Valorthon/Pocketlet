import { db, schema } from './index';

export async function resetDatabase(): Promise<void> {
  await db.delete(schema.metrics);
  await db.delete(schema.users);
}
