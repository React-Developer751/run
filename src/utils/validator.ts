import path from 'node:path';
import { HttpError } from './http.js';
import type { ProjectKind } from '../services/store.service.js';

const GITHUB_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

// Keys that could hijack the build/runtime environment of the host or container.
const BLOCKED_ENV_KEYS = new Set(['PATH', 'HOME', 'SHELL', 'NODE_OPTIONS', 'PORT', 'NODE_ENV']);
const BLOCKED_ENV_PREFIXES = ['LD_', 'DYLD_', 'HOSTX_'];

const RESERVED_SLUGS = new Set(['www', 'api', 'admin', 'app', 'dashboard', 'hostx', 'mail', 'static']);

const bad = (message: string): never => {
  throw new HttpError(400, message);
};

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') return bad(`${field} must be a string`);
  return value.trim();
}

export function validateRepoUrl(value: unknown): { url: string; repoName: string } {
  const raw = asString(value, 'repoUrl');
  const match = GITHUB_RE.exec(raw);
  if (!match) return bad('Enter a valid public GitHub URL, e.g. https://github.com/user/repo');
  const [, owner, repo] = match;
  return { url: `https://github.com/${owner}/${repo}.git`, repoName: repo as string };
}

export function validateBranch(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const branch = asString(value, 'branch');
  if (!BRANCH_RE.test(branch) || branch.includes('..')) return bad('Invalid branch name');
  return branch;
}

/** Returns a normalised, repo-relative folder ("." for the root). Rejects traversal. */
export function validateRootDir(value: unknown): string {
  if (value === undefined || value === null || value === '') return '.';
  const raw = asString(value, 'rootDir');
  if (raw.includes('\0') || path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) return bad('Invalid root directory');
  const normalised = path.posix.normalize(raw.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (normalised === '' || normalised === '.') return '.';
  if (normalised.startsWith('..') || normalised.split('/').includes('..')) return bad('Invalid root directory');
  if (!/^[A-Za-z0-9._@/ -]+$/.test(normalised)) return bad('Root directory contains unsupported characters');
  return normalised;
}

export function validateEnv(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return bad('env must be an object of KEY: value');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) return bad('A maximum of 50 environment variables is allowed');

  const out: Record<string, string> = {};
  for (const [key, val] of entries) {
    if (!ENV_KEY_RE.test(key)) return bad(`Invalid environment variable name: ${key}`);
    const upper = key.toUpperCase();
    if (BLOCKED_ENV_KEYS.has(upper) || BLOCKED_ENV_PREFIXES.some((p) => upper.startsWith(p))) {
      return bad(`${key} is reserved and cannot be set`);
    }
    if (typeof val !== 'string') return bad(`Value of ${key} must be a string`);
    if (val.length > 4096 || /[\r\n\0]/.test(val)) return bad(`Value of ${key} is invalid (max 4096 chars, single line)`);
    out[key] = val;
  }
  return out;
}

export function validateProjectName(value: unknown, fallback: string): string {
  const raw = value === undefined || value === null || value === '' ? fallback : asString(value, 'name');
  if (raw.length < 2 || raw.length > 40) return bad('Project name must be 2-40 characters');
  return raw;
}

export function validateEmail(value: unknown): string {
  const email = asString(value, 'email').toLowerCase();
  if (email.length > 120 || !EMAIL_RE.test(email)) return bad('Enter a valid email address');
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') return bad('password must be a string');
  if (value.length < 8) return bad('Password must be at least 8 characters');
  if (value.length > 200) return bad('Password is too long');
  return value;
}

export function validatePersonName(value: unknown): string {
  const name = asString(value, 'name');
  if (name.length < 2 || name.length > 60) return bad('Name must be 2-60 characters');
  return name;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : `app-${slug || 'x'}`;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Shell command typed by the user. null = not provided. Single line only so it can never smuggle extra Dockerfile lines. */
export function validateCommand(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const command = asString(value, field);
  if (command.length > 300 || /[\r\n\0]/.test(command)) return bad(`${field} must be a single line (max 300 characters)`);
  return command;
}

export function validateKind(value: unknown): ProjectKind | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'static' || value === 'node') return value;
  return bad('type must be "static" or "node"');
}

export function validateOutputDir(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const dir = validateRootDir(value);
  if (!/^[A-Za-z0-9._/-]+$/.test(dir)) return bad('Output directory may only contain letters, numbers, . _ - and /');
  return dir;
}
