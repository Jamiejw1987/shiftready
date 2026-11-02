import { Logo } from '@/components/Logo';
import { JoinForm } from './JoinForm';

export const metadata = { title: 'Register with Staff Selection UK | ShiftReady' };

export default function JoinPage({ searchParams }: { searchParams: { from?: string } }) {
  return (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">
        <JoinForm from={searchParams.from ?? ''} />
      </div>
    </main>
  );
}
