// Some prompts embed runtime constants (default/cap values). Those live in the
// .txt as {{TOKEN}} and are filled here at the use site.
export function fillPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
