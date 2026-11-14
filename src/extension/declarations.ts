/** Small, fail-closed helpers for optional platform declarations. */

export function declarationVisible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function exactText(element: Element, texts: readonly string[]): boolean {
  const value = normalized(element.textContent);
  return texts.some(text => value === normalized(text));
}

/** Find the smallest visible element carrying one of the supplied labels. */
export function findDeclarationText(root: ParentNode, texts: readonly string[]): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter(element => declarationVisible(element) && exactText(element, texts))
    .sort((a, b) => a.children.length - b.children.length)[0];
}

function isCheckable(element: Element): boolean {
  return element.matches('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],button');
}

/** Find a checkbox/radio/toggle belonging to a nearby declaration label. */
export function findDeclarationControl(root: ParentNode, texts: readonly string[]): HTMLElement | undefined {
  const labels = [...root.querySelectorAll<HTMLElement>('*')]
    .filter(element => declarationVisible(element) && exactText(element, texts))
    .sort((a, b) => a.children.length - b.children.length);
  const found = new Set<HTMLElement>();
  for (const label of labels) {
    if (isCheckable(label)) { found.add(label); continue; }
    const labelElement = label.closest('label');
    const direct = labelElement?.querySelector<HTMLElement>('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]');
    if (direct) { found.add(direct); continue; }
    let ancestor: HTMLElement | null = label.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
      const controls = [...ancestor.querySelectorAll<HTMLElement>('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]')]
        .filter(declarationVisible);
      if (controls.length === 1) { found.add(controls[0]!); break; }
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export function checkedState(control: HTMLElement): boolean | undefined {
  if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) return control.checked;
  const aria = control.getAttribute('aria-checked');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  return control.classList.contains('semi-checkbox-checked') || control.classList.contains('is-checked') || undefined;
}

/** Check a declaration only when it is currently unchecked. */
export function ensureChecked(control: HTMLElement): boolean {
  if (checkedState(control) === true) return true;
  if (control instanceof HTMLInputElement && control.disabled) return false;
  if (control instanceof HTMLButtonElement && control.disabled) return false;
  control.click();
  const after = checkedState(control);
  // Some framework toggles update on the next render tick. An unknown state
  // is still a successful click, while an explicit false state is a failure.
  return after !== false;
}

