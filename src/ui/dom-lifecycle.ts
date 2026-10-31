const cleanups = new WeakMap<Element, () => void>();
export function onDispose(element: Element, cleanup: () => void): void { cleanups.set(element, cleanup); }
export function disposeTree(element: Element): void {
  if (element.closest("[data-live-message]")) return;
  for (const child of element.querySelectorAll("*")) { if (child.closest("[data-live-message]")) continue; cleanups.get(child)?.(); cleanups.delete(child); }
  cleanups.get(element)?.(); cleanups.delete(element);
}
