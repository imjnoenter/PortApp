// The resolved colour scheme: the saved choice, or the system's when that choice is 'auto'.
import { app } from './app.svelte.ts';

const system = matchMedia('(prefers-color-scheme: dark)');
let systemDark = $state(system.matches);
system.addEventListener('change', e => systemDark = e.matches);

export const theme = {
  get dark() { return app.prefs.theme === 'auto' ? systemDark : app.prefs.theme === 'dark'; },
  toggle() { app.prefs.theme = theme.dark ? 'light' : 'dark'; },
};
