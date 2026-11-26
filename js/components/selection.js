// Native buttons supply Enter/Space activation. Keep their visual and accessible state together.
export function bindToggleButton(button, onChange) {
  button?.addEventListener('click', () => {
    const pressed = button.ariaPressed !== 'true';
    button.ariaPressed = String(pressed);
    onChange(pressed);
  });
}

export function syncSelectAll(button, selectedCount, total) {
  button.disabled = total === 0;
  button.ariaPressed = selectedCount === 0 ? 'false' : selectedCount === total ? 'true' : 'mixed';
}

// Toggle a row in place so focus, links, and move handles survive changes to the selection.
export function bindFundRowSelection(body, selected, onChange) {
  function toggle(row) {
    if (!row?.dataset.fundDrag) return;
    const code = row.dataset.fundDrag;
    const next = !selected.has(code);
    if (next) selected.add(code);
    else selected.delete(code);
    row.setAttribute('aria-selected', String(next));
    onChange();
  }
  body.addEventListener('click', event => {
    if (!event.target.closest('a, button, input, select, textarea, label')) toggle(event.target.closest('tr[aria-selected]'));
  });
  body.addEventListener('keydown', event => {
    if (!event.target.matches('tr[aria-selected]') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) toggle(event.target);
  });
}
