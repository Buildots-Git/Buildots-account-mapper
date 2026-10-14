import React from 'react';
import { useStore, effectiveTheme } from './store.js';

export default function ThemeToggle() {
  const { theme, setTheme } = useStore();
  useStore((st) => st._sys); // re-render when the computer's setting changes
  const dark = effectiveTheme(theme) === 'dark';
  return <button className="btn ghost themebtn" title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle light/dark mode" onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? '☀' : '☾'}</button>;
}
