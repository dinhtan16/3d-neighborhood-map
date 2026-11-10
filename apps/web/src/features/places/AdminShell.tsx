'use client';
import { useEffect, useState } from 'react';
import { fetchMe, IS_STATIC, login, setToken } from '@/lib/api/client';

const NAV = [
  { href: '/admin/places', label: 'Places' },
  { href: '/admin/map-editor', label: 'Map editor' },
  { href: '/admin/assets', label: 'Assets' },
];

/** Admin chrome + authentication gate (JWT stored in localStorage). */
export function AdminShell({ active, children }: { active: string; children: React.ReactNode }) {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchMe().then(setUser); }, []);

  const header = (
    <header className="header">
      <a className="brand" href="/map/chon-thanh" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="logo">◆</span><strong>Admin</strong>
      </a>
      {user && (
        <nav className="admin-nav">
          {NAV.map((n) => <a key={n.href} href={n.href} className={active === n.href ? 'on' : ''}>{n.label}</a>)}
        </nav>
      )}
      <div className="header-right">
        <a className="btn ghost" href="/map/chon-thanh">View map</a>
        {user && <button className="btn ghost" onClick={() => { setToken(null); setUser(null); }}>Log out</button>}
      </div>
    </header>
  );

  if (IS_STATIC) {
    return <div className="admin">{header}<main className="admin-main"><p className="notice">The static demo is read-only. Run the API to use admin tools.</p></main></div>;
  }
  if (user === undefined) return <div className="admin">{header}<main className="admin-main muted">Loading…</main></div>;
  if (!user) {
    return (
      <div className="admin">
        {header}
        <main className="admin-main" style={{ maxWidth: 420 }}>
          <form
            className="card form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try { const r = await login(email, password); setUser(r.user); } catch (err) { setError((err as Error).message); }
            }}
          >
            <h2 style={{ margin: 0 }}>Admin sign in</h2>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
            <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            {error && <p className="error">{error}</p>}
            <button className="btn" type="submit">Sign in</button>
          </form>
        </main>
      </div>
    );
  }
  return <div className="admin">{header}{children}</div>;
}
