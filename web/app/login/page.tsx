import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Sign in',
    description: `Sign in to ${await getSiteName()} to manage your deployments, build logs and environment variables.`,
    robots: { index: false, follow: true },
  };
}

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
