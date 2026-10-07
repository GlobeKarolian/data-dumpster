/** "The Boston Globe × Boston Globe Arts & Lifestyle" for a collab post; the plain name otherwise. */
export function collabLabel(primary: string, collaborators?: ReadonlyArray<{ name: string } | string> | null): string {
  const others = (collaborators ?? []).map((c) => (typeof c === 'string' ? c : c.name));
  return others.length ? [primary, ...others].join(' × ') : primary;
}
