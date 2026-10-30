import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Create your free account',
  description: 'Create a free HostX account and deploy your MERN app — React, Node/Express and MongoDB Atlas — from GitHub in minutes. No credit card required.',
  path: '/register',
});

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
