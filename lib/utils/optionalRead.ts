export function createOptionalReader() {
  const failures: string[] = [];
  return {
    failures,
    async read<T, F>(label: string, operation: Promise<T>, fallback: F): Promise<T | F> {
      try {
        return await operation;
      } catch {
        failures.push(label);
        // Do not log response bodies, URLs or credentials from provider errors.
        console.warn(`[OPTIONAL_READ] ${label} unavailable`);
        return fallback;
      }
    }
  };
}
