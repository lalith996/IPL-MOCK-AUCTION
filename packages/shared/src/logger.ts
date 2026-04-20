export interface LogContext {
  trace_id?: string;
  auction_id?: string;
  agent_id?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
}

export function createNoopLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
}
