// Loads ./.env into process.env before config is read (ES imports are hoisted, so this must be its own module).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: rely on the real environment */
}

// An empty value (e.g. "HOSTX_WEB_ORIGIN=" left blank from the template) means "not set": use the default.
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('HOSTX_') && value !== undefined && value.trim() === '') delete process.env[key];
}
