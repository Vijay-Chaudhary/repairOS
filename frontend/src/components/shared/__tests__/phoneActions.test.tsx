import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhoneActions } from '../PhoneActions';

describe('PhoneActions', () => {
  it('renders a tel: link to the normalized number', () => {
    render(<PhoneActions phone="+919110000001" />);
    const tel = screen.getByRole('link', { name: /call/i });
    expect(tel).toHaveAttribute('href', 'tel:+919110000001');
  });

  it('normalizes a bare 10-digit number for tel: and wa.me', () => {
    render(<PhoneActions phone="9110000001" />);
    expect(screen.getByRole('link', { name: /call/i })).toHaveAttribute('href', 'tel:+919110000001');
    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute('href', 'https://wa.me/919110000001');
  });

  it('renders a wa.me link by default', () => {
    render(<PhoneActions phone="+919110000001" />);
    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute('href', 'https://wa.me/919110000001');
  });

  it('hides the wa.me link when opted out', () => {
    render(<PhoneActions phone="+919110000001" whatsappOptout />);
    expect(screen.queryByRole('link', { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  it('renders a Log call button only when onLogCall is provided', () => {
    const { rerender } = render(<PhoneActions phone="+919110000001" />);
    expect(screen.queryByRole('button', { name: /log call/i })).not.toBeInTheDocument();

    const onLogCall = vi.fn();
    rerender(<PhoneActions phone="+919110000001" onLogCall={onLogCall} />);
    expect(screen.getByRole('button', { name: /log call/i })).toBeInTheDocument();
  });

  it('calls onLogCall when the Log call button is clicked', async () => {
    const user = userEvent.setup();
    const onLogCall = vi.fn();
    render(<PhoneActions phone="+919110000001" onLogCall={onLogCall} />);
    await user.click(screen.getByRole('button', { name: /log call/i }));
    expect(onLogCall).toHaveBeenCalledTimes(1);
  });
});
