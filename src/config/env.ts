// Loads ./.env into process.env before config is read (ES imports are hoisted, so this must be its own module).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: rely on the real environment */
}
