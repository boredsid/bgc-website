import { useEffect, useState } from 'react';

function readAdminEmailFromCookie(): string | null {
  const meta = document.querySelector('meta[name="admin-email"]');
  return meta?.getAttribute('content') || null;
}

export default function TopBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(readAdminEmailFromCookie());
  }, []);

  return (
    <header className="h-14 bg-background border-b flex items-center justify-between px-6">
      <div className="font-medium">Admin</div>
      <div className="flex items-center gap-3 text-sm">
        {email && <span className="text-muted-foreground">{email}</span>}
        <a
          href="/cdn-cgi/access/logout"
          className="text-sm hover:underline"
        >
          Sign out
        </a>
      </div>
    </header>
  );
}
