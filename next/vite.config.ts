import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The build lands in ../v2 and every URL in it is relative, so it runs from any folder. The site
// itself is the repository's top folder: "npm run release" builds and then copies v2/ up there
// (scripts/release.mjs). Building straight into the top folder would make "vite preview" serve the
// whole repository, including files that must never leave this machine.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { outDir: '../v2', emptyOutDir: true, target: 'es2022' },
});
