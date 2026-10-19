import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = {
  title: 'Create your free account',
  description: 'Create a free HostX account and deploy your React frontend and Node.js backend from a GitHub link in minutes. No credit card required.',
  alternates: { canonical: '/register' },
  openGraph: { type: 'website', title: 'Create your free account · HostX', description: 'Create a free HostX account and deploy your React frontend and Node.js backend from a GitHub link in minutes.', url: '/register' },
  twitter: { card: 'summary_large_image', title: 'Create your free account · HostX' },
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
