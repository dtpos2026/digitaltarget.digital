// Category names as the POS shows them (v1.126.0).
//
// Many restaurants write a category as "Chicken Karahi (چکن کڑاہی)" — the English name and the Urdu one in brackets, in ONE field.
// Printed on one line that wraps in the middle of the brackets (a tall, ragged button, and in a narrow side panel four or five lines).
// The design shows one clear name per category. So the English (or first) name leads and the Urdu follows on its own, smaller line;
// the full text is still the button's tooltip, and nothing about the saved name changes.
export interface CategoryLabel { primary: string; secondary?: string }

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** "Chicken Karahi (چکن کڑاہی)" → { primary: "Chicken Karahi", secondary: "چکن کڑاہی" }. Any other name is returned as it is. */
export function splitCategoryName(name: string): CategoryLabel {
  const text = (name ?? '').trim();
  const m = /^(.*?)\s*[(（]([^()（）]*)[)）]\s*$/.exec(text);
  if (m) {
    const lead = m[1].trim(), inside = m[2].trim();
    // only a bracket that holds Urdu / Arabic script is a second name; "(half)" or "(2 pcs)" stays part of the name
    if (lead && inside && ARABIC_SCRIPT.test(inside) && !ARABIC_SCRIPT.test(lead)) return { primary: lead, secondary: inside };
  }
  return { primary: text };
}
