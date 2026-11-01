// A screen: its documentation and its render function live together, so the document cannot drift from the picture.
export const STATES = {
  list:   { empty: 'Illustration, "No {name} yet" and the primary action; filters stay visible.', loading: 'Skeleton rows (6) in the table; toolbar and filters are interactive.', error: 'Inline banner above the table with the reason and Retry; the last loaded rows stay visible.' },
  form:   { empty: 'Fields show placeholders; required fields are marked; Save is disabled until valid.', loading: 'Save shows a spinner and locks the form; fields keep their values.', error: 'Field errors under the field (red border + message); a summary banner if the save itself failed.' },
  dash:   { empty: 'Each card shows "No data for this period" with the period selector still usable.', loading: 'Skeleton cards and chart placeholders, same layout (no jump).', error: 'The failing card shows an inline Retry; the others stay.' },
  detail: { empty: 'Select-something state in the empty pane.', loading: 'Skeleton blocks in the pane.', error: 'Banner with Retry inside the pane.' },
  phone:  { empty: 'Centered illustration, one sentence, one action.', loading: 'Skeletons in the shape of the content; pull-to-refresh spinner.', error: 'Offline / failed banner at the top with Retry; cached content stays.' },
};
export function S(id, name, o, render, renderDesktop) {
  const st = STATES[o.kind || 'list'];
  return { id, name, kind: 'list', resp: 'Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.', ...o,
    empty: o.empty || st.empty.replace('{name}', name.toLowerCase()), loading: o.loading || st.loading, error: o.error || st.error, render, ...(renderDesktop ? { renderDesktop } : {}) };
}
