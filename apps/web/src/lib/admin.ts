export function verifyAdminToken(authHeader: string | null): boolean {
  const expected = process.env.ADMIN_SECRET_TOKEN;
  if (!expected || expected === 'change-me-in-production') {
    return false;
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return token === expected;
}
