import { useState } from 'react';

interface Props {
  navLinks: { label: string; href: string }[];
}

export default function MobileMenu({ navLinks }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex flex-col gap-1.5 p-2"
        aria-label="Toggle menu"
      >
        <span
          className={`block w-6 h-0.5 bg-secondary transition-transform ${open ? 'rotate-45 translate-y-2' : ''}`}
        />
        <span
          className={`block w-6 h-0.5 bg-secondary transition-opacity ${open ? 'opacity-0' : ''}`}
        />
        <span
          className={`block w-6 h-0.5 bg-secondary transition-transform ${open ? '-rotate-45 -translate-y-2' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-16 left-0 right-0 bg-white border-b border-border shadow-lg">
          <div className="flex flex-col p-4 gap-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-secondary/70 hover:text-primary font-medium text-sm py-2 no-underline"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://instagram.com/boardgamecompany"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-secondary text-white px-4 py-2 rounded-full font-heading font-semibold text-sm text-center no-underline mt-2"
            >
              Join Us
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
