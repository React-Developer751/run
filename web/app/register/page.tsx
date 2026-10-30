import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { pageMetadata } from '@/lib/site';
import { getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Create your free account',
    description: `Create a free ${siteName} account and deploy your MERN app — React, Node/Express and MongoDB Atlas — from GitHub in minutes. No credit card required.`,
    path: '/register',
    name: siteName,
  });
}

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
