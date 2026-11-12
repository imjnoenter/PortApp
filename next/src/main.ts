import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from './state/app.svelte.ts';
import { installNudge } from './ui/nudge.ts';

app.start();
installNudge();
// Offline support only makes sense for the built app: in development it would serve stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => {});
mount(App, { target: document.getElementById('app')! });
