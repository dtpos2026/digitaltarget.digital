// Sidebar labels that follow the app language (src/lib/i18n). Shared by the Classic and the Modern sidebar and by the module
// launcher. v1.109.0: every module in src/lib/permissions.ts has a `nav.<key>` entry (English, Urdu, Arabic — see
// src/lib/i18nNav.ts). Before this the lookup asked for keys no dictionary held, so the sidebar never translated.
import { t as tr } from '@/lib/i18n';

export function navTitle(key: string, fallback: string): string {
  return tr(`nav.${key}`, fallback);
}

/** A group heading in the sidebar (Operations, Reports, …). */
export function navGroupTitle(group: string): string {
  return tr(`navGroup.${group}`, group);
}
