import React from 'react';
import { usePreferences, type TextSize, type ThemeChoice } from '../state/preferences';
import { Icon } from './Icon';
import { useDisclosure } from './useDisclosure';

const themes: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follows your computer, including Increase contrast' },
  { value: 'light', label: 'Light', hint: 'Paper · forest green (default)' },
  { value: 'dark', label: 'Dark', hint: 'Forest green on deep green-grey' },
  { value: 'contrast', label: 'High contrast', hint: 'Black and white with thicker outlines' }
];
const sizes: { value: TextSize; label: string }[] = [
  { value: 'normal', label: 'Default' }, { value: 'large', label: 'Large (112%)' }, { value: 'larger', label: 'Larger (125%)' }
];

export function AppearanceMenu() {
  const prefs = usePreferences();
  const pop = useDisclosure();
  return (
    <div className="anchor">
      <button type="button" className="btn btn-secondary btn-icon" {...pop.triggerProps} aria-controls="appearance-popover" aria-label="Appearance: theme and text size" title="Appearance" onClick={pop.toggle}><Icon name="palette" /></button>
      {pop.open && (
        <div id="appearance-popover" className="popover right up" role="dialog" aria-label="Appearance" ref={pop.panelRef}>
          <fieldset className="radio-group">
            <legend>Theme</legend>
            {themes.map(t => <label key={t.value} className="radio">
              <input type="radio" name="theme" value={t.value} checked={prefs.theme === t.value} onChange={() => prefs.setTheme(t.value)} aria-labelledby={`theme-${t.value}-name`} aria-describedby={t.hint || t.value === 'system' ? `theme-${t.value}-hint` : undefined} />
              <span className="stack-sm" style={{ gap: 0 }}>
                <span id={`theme-${t.value}-name`}>{t.label}</span>
                {(t.hint || t.value === 'system') && <span id={`theme-${t.value}-hint`} className="small muted">{t.hint}{t.value === 'system' ? ` (currently ${prefs.resolvedTheme === 'contrast' ? 'high contrast' : prefs.resolvedTheme})` : ''}</span>}
              </span>
            </label>)}
          </fieldset>
          <fieldset className="radio-group">
            <legend>Text size</legend>
            {sizes.map(s => <label key={s.value} className="radio">
              <input type="radio" name="text-size" value={s.value} checked={prefs.textSize === s.value} onChange={() => prefs.setTextSize(s.value)} />{s.label}
            </label>)}
          </fieldset>
          <p className="small muted">Shortcuts: <kbd>Ctrl K</kbd> (<kbd>⌘ K</kbd> on Mac) jumps to the chat box. <kbd>Esc</kbd> closes menus and the chat overlay.</p>
        </div>
      )}
    </div>
  );
}
