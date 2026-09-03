type LogMeta = Record<string, string | number | boolean | null | undefined>;

function formatMeta(meta?: LogMeta) {
  if (!meta) {
    return "";
  }

  const cleaned = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  );

  return Object.keys(cleaned).length > 0 ? ` ${JSON.stringify(cleaned)}` : "";
}

export const logger = {
  info(scope: string, message: string, meta?: LogMeta) {
    console.info(`[${scope}] ${message}${formatMeta(meta)}`);
  },
  warn(scope: string, message: string, meta?: LogMeta) {
    console.warn(`[${scope}] ${message}${formatMeta(meta)}`);
  },
  error(scope: string, message: string, meta?: LogMeta) {
    console.error(`[${scope}] ${message}${formatMeta(meta)}`);
  }
};
