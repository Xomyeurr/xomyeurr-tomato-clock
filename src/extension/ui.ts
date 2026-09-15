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
