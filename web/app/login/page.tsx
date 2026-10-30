import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to HostX to manage your deployments, build logs and environment variables.',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
