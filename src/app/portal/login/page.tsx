import { Logo } from '@/components/Logo';
import { LinkForm } from './LinkForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in | ShiftReady for clients' };

export default function PortalLogin({ searchParams }: { searchParams: { error?: string; out?: string } }) {
  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        {searchParams.error === 'access' && <p className="err">This account doesn’t have access any more. Please speak to Staff Selection.</p>}
        {searchParams.error === 'link' && <p className="err">That link has expired or was already used. Enter your email for a new one.</p>}
        {searchParams.out && <p className="okmsg">You’ve signed out.</p>}
        <LinkForm />
      </div>
    </main>
  );
}
