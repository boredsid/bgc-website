import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhoneCell } from './PhoneCell';

describe('PhoneCell', () => {
  it('formats Indian phone numbers as +91 XXXXX XXXXX', () => {
    render(<PhoneCell phone="9876543210" />);
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('preserves a number that already has the +91 prefix', () => {
    render(<PhoneCell phone="+919876543210" />);
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('links to WhatsApp using the digits-only form', () => {
    render(<PhoneCell phone="9876543210" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://wa.me/919876543210');
  });

  it('has an aria-label describing the action', () => {
    render(<PhoneCell phone="9876543210" />);
    expect(screen.getByRole('link').getAttribute('aria-label')).toMatch(/whatsapp/i);
  });
});
