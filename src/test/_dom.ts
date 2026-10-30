// Minimal DOM helpers for component tests — react-dom + act, no extra library.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export function mount(el: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(el); });
  return {
    rerender: (next: ReactElement) => act(() => { root.render(next); }),
    unmount: () => { act(() => { root.unmount(); }); host.remove(); },
  };
}

/** Find an element by its visible text, searching the whole body (dialogs are portalled). */
export function byText(text: string, tag = 'button'): HTMLElement | null {
  return (Array.from(document.body.querySelectorAll(tag)) as HTMLElement[])
    .find(e => (e.textContent || '').trim().startsWith(text)) ?? null;
}
export const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;

export function click(el: HTMLElement | null) {
  if (!el) throw new Error('click: element not found');
  act(() => { el.click(); });
}

export function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('typeInto: input not found');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

export function press(el: HTMLElement | null, key: string) {
  if (!el) throw new Error('press: element not found');
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}
