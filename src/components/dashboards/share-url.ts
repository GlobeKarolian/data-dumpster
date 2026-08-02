/** Turn either the API's absolute URL or a reloaded relative URL into one copyable link. */
export function absoluteShareUrl(value: string, origin: string): string {
  try {
    return new URL(value, origin).toString();
  } catch {
    return value;
  }
}

