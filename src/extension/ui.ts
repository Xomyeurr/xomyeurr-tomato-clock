type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | EventListener | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'className') {
      el.className = String(value);
    } else if (key === 'value') {
      (el as HTMLInputElement).value = String(value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export function weightSelect(selected: number | null, inheritLabel?: string): HTMLSelectElement {
  const select = h('select');
  if (inheritLabel) select.append(h('option', { value: '' }, inheritLabel));
  for (let weight = 1; weight <= 5; weight++) select.append(h('option', { value: String(weight) }, String(weight)));
  select.value = selected === null ? '' : String(selected);
  return select;
}

export function field(text: string, control: HTMLElement): HTMLLabelElement {
  return h('label', {}, text, control);
}

/** Preserve typed drafts and open sections when storage or the clock refreshes a view. */
export function preserveDrafts(root: HTMLElement): () => void {
  const values = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[id], select[id], textarea[id]'))
    .map(el => ({ id: el.id, value: el.value, checked: el instanceof HTMLInputElement ? el.checked : false }));
  const open = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[id]')).map(el => ({ id: el.id, open: el.open }));
  const activeId = root.contains(document.activeElement) ? document.activeElement?.id : null;
  return () => {
    for (const saved of values) {
      const el = document.getElementById(saved.id);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (el instanceof HTMLSelectElement && !Array.from(el.options).some(o => o.value === saved.value)) continue;
        el.value = saved.value;
        if (el instanceof HTMLInputElement) el.checked = saved.checked;
      }
    }
    for (const saved of open) { const el = document.getElementById(saved.id); if (el instanceof HTMLDetailsElement) el.open = saved.open; }
    if (activeId) document.getElementById(activeId)?.focus();
  };
}
