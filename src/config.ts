import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  // Trimmed so a stray space, newline or trailing "/" pasted into the hosting dashboard can't break CORS.
  frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:5173').trim().replace(/\/+$/, ''),
  isProduction: process.env.NODE_ENV === 'production',
};
