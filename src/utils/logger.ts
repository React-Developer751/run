const stamp = () => new Date().toISOString();

export const logger = {
  info: (message: string, ...rest: unknown[]) => console.log(`${stamp()} [info]`, message, ...rest),
  warn: (message: string, ...rest: unknown[]) => console.warn(`${stamp()} [warn]`, message, ...rest),
  error: (message: string, ...rest: unknown[]) => console.error(`${stamp()} [error]`, message, ...rest),
};
