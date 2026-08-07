// Tiny DOM lookup shared by the shell modules. The app's chrome is static
// HTML; a missing id is a programming error, so this throws instead of null.

export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}
