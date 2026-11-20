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

const controlSelector = 'input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],[role="switch"],.d-switch';
function isCheckable(element: Element): boolean {
  return element.matches(controlSelector + ',button');
}
function declarationControls(root: ParentNode, visibleOnly = true): HTMLElement[] {
  // Delight's switch owns the click handler; its native input can be hidden.
  return [...new Set([...root.querySelectorAll<HTMLElement>(controlSelector)]
    .map(control => control.closest<HTMLElement>('.d-switch') ?? control))].filter(control => !visibleOnly || declarationVisible(control));
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
    const direct = labelElement && declarationControls(labelElement, false);
    if (direct?.length === 1) { found.add(direct[0]!); continue; }
    if (direct && direct.length > 1) continue;
    let ancestor: HTMLElement | null = label.parentElement;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 5; depth++, ancestor = ancestor.parentElement) {
      const controls = declarationControls(ancestor);
      if (controls.length === 1) { found.add(controls[0]!); break; }
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export function checkedState(control: HTMLElement): boolean | undefined {
  if (control.matches('.d-switch')) return control.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked;
  // Video Channels controls belong to its iframe realm, even after Wujie
  // moves their DOM into a shadow root. instanceof against the host fails.
  if (control.matches('input[type="checkbox"],input[type="radio"]')) return (control as HTMLInputElement).checked;
  const aria = control.getAttribute('aria-checked');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  return control.classList.contains('semi-checkbox-checked') || control.classList.contains('is-checked') || undefined;
}

export function declarationDisabled(control: HTMLElement): boolean {
  return control.matches(':disabled,[aria-disabled="true"],.d-switch.disabled') || !!control.querySelector('input:disabled');
}

/** Check a declaration only when it is currently unchecked. */
export function ensureChecked(control: HTMLElement): boolean {
  if (checkedState(control) === true) return true;
  if (declarationDisabled(control)) return false;
  control.click();
  const after = checkedState(control);
  // Some framework toggles update on the next render tick. An unknown state
  // is still a successful click, while an explicit false state is a failure.
  return after !== false;
}

type DeclarationWait = <T>(read: () => T | undefined | false, label: string, deferred?: boolean) => Promise<T>;
function declarationTrigger(label: HTMLElement): HTMLElement {
  const delightSelect = label.closest<HTMLElement>('.d-select-wrapper');
  if (delightSelect) return delightSelect;
  // Kuaishou's author label is a sibling of an Ant Select, not its trigger.
  if (!exactText(label, ['作者声明'])) return label;
  let row: HTMLElement | null = label;
  for (let depth = 0; row && row !== document.body && depth < 3; depth++, row = row.parentElement) {
    const selects = [...row.querySelectorAll<HTMLElement>('.ant-select-selector')].filter(declarationVisible);
    if (selects.length === 1) return selects[0]!;
    if (selects.length > 1) break;
  }
  return label;
}
function aiControl(label: HTMLElement): HTMLElement | undefined {
  const control = label.closest<HTMLElement>(controlSelector);
  if (control) return control;
  const wrapper = label.closest('label');
  const controls = wrapper && declarationControls(wrapper, false);
  return controls?.length === 1 ? controls[0] : undefined;
}
/** Select an AI label and require selected-field/checked-state evidence after rendering. */
export async function selectAiDeclaration(entries: readonly string[], options: readonly string[], edit: (action: () => void) => void, wait: DeclarationWait): Promise<string> {
  const selected = () => [...document.querySelectorAll<HTMLElement>('*')]
    .filter(text => declarationVisible(text) && exactText(text, options))
    .some(text => {
      const control = aiControl(text);
      if (control) return checkedState(control) === true;
      return !text.closest('[role="option"],[role="menuitem"],[role="listbox"],[role="menu"],[role="dialog"],.ant-select-dropdown,.ant-dropdown,.declaration-drop-down,.d-select-dropdown');
    });
  if (selected()) return '已选择 AI 生成声明；';
  let option = findDeclarationText(document, options);
  if (!option) {
    const entry = findDeclarationText(document, entries);
    if (!entry) return '';
    const trigger = declarationTrigger(entry);
    const open = (trigger: HTMLElement) => edit(() => {
      if (trigger.matches('.d-select-wrapper')) {
        // Delight needs a fresh focusin to open a closed menu.
        if (document.activeElement === trigger) trigger.blur();
        trigger.focus({preventScroll:true});
        return;
      }
      if (trigger.matches('.ant-select-selector')) {
        trigger.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
        trigger.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, button:0}));
      }
      trigger.click();
    });
    open(trigger);
    let refocusAfter = trigger.matches('.d-select-wrapper') ? Date.now() + 600 : undefined;
    option = await wait(() => {
      const item = findDeclarationText(document, options);
      if (item) return item;
      if (refocusAfter !== undefined && Date.now() >= refocusAfter) {
        // The original declaration dialog can leave focus elsewhere while it closes.
        refocusAfter = undefined;
        const select = findDeclarationText(document, entries)?.closest<HTMLElement>('.d-select-wrapper');
        if (select) open(select);
      }
    }, '找到 AI 生成声明选项');
  }
  const control = aiControl(option);
  edit(() => control ? ensureChecked(control) : option.click());
  await wait(selected, '核验 AI 生成声明', true);
  return '已选择 AI 生成声明；';
}

