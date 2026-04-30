import { useState, useEffect } from 'react';

interface Props {
  navLinks: { label: string; href: string }[];
}

export default function MobileMenu({ navLinks }: Props) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex flex-col gap-[5px] p-2 bg-transparent border-0 cursor-pointer z-[60] relative"
        aria-label="Toggle menu"
      >
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-transform ${open ? 'rotate-45 translate-y-[6px]' : ''}`} />
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-opacity ${open ? 'opacity-0' : ''}`} />
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-transform ${open ? '-rotate-45 -translate-y-[6px]' : ''}`} />
      </button>

      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/60 transition-opacity z-[45] ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 w-full h-screen bg-[#FFF8E7] z-50 transition-transform duration-300 overflow-y-auto ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between h-[72px] px-6" style={{ borderBottom: '3px solid #1A1A1A' }}>
          <a href="/" className="flex items-center gap-3 no-underline">
            <img src="/bgc-logo.png" alt="BGC" className="h-10 w-10 rounded-full object-cover" />
            <span className="font-heading font-bold text-lg">Board Game Company</span>
          </a>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 bg-transparent border-0 cursor-pointer">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="flex flex-col gap-2 p-6 list-none m-0">
          {navLinks.map((link) => {
            const active = link.href === path;
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  className={`block py-4 px-4 rounded-xl font-heading font-semibold text-xl no-underline text-[#1A1A1A] ${active ? 'bg-[#FAFAF5]' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
          <li className="mt-4">
            <a href="/register" className="btn btn-primary w-full text-center no-underline" onClick={() => setOpen(false)}>
              Register Now
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
