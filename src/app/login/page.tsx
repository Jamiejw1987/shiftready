import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { step?: string; error?: string } }) {
  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        {searchParams.error === 'link' && <p className="err">That link has expired or was already used. Ask an admin to resend your invite, or use Forgotten password.</p>}
        <LoginForm startAt2fa={searchParams.step === '2fa'} accessError={searchParams.error === 'access'} />
      </div>
    </main>
  );
}
