import { fileURLToPath } from 'node:url';

// Supabase's database CA is separate from the public HTTPS CA bundle.
// Keep hostname and chain verification enabled on direct and session connections.
export function databaseConnectionUrl(value: string) {
  const url = new URL(value);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.pooler.supabase.com')) {
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.set('sslrootcert', fileURLToPath(new URL('../assets/certs/supabase-ca.crt', import.meta.url)));
  }
  return url.toString();
}
