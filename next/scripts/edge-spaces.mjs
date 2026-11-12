// Find (and with --fix, repair) spaces the compiler silently drops.
//
// Svelte removes whitespace at the very start and end of every element and every block. So in
//   Share of {label}<span class="muted"> {n} holdings</span>
// the space before {n} never reaches the page, and it reads "Share of the holdings43 holdings".
// The same happens to `{#if x} text{/if}` and to `text {/if}`.
//
// A space that sits BETWEEN two things is kept, so the repair moves the space outside the element
// when the element has a neighbour on that side, and otherwise writes it as {' '}, which is an
// expression and is never trimmed.
//
//   node scripts/edge-spaces.mjs          list them (exit code 1 if any)
//   node scripts/edge-spaces.mjs --fix    repair them in place
import { parse } from 'svelte/compiler';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const fix = process.argv.includes('--fix');
const files = [];
(function walk(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.svelte')) files.push(p); } })('src');

let found = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const edits = [];   // { at, del, ins }
  const lineOf = pos => src.slice(0, pos).split('\n').length;
  const note = (pos, what) => { found++; if (!fix) console.log(`${relative('.', file)}:${lineOf(pos)}  ${what}: ${JSON.stringify(src.slice(Math.max(0, pos - 30), pos + 30))}`); };

  // `owner` is the element whose content this fragment is, or null for a block's branch.
  // `siblings`/`index` locate that element among its own neighbours.
  function fragment(frag, owner, siblings, index) {
    const nodes = frag.nodes;
    if (nodes.length) {
      const first = nodes[0], last = nodes[nodes.length - 1];
      const solo = nodes.length === 1 && first.type === 'Text' && first.raw.trim() === '';
      if (!solo && first.type === 'Text') {
        const m = /^[ \t]+/.exec(first.raw);
        if (m && !/^[ \t]*\r?\n/.test(first.raw)) {
          note(first.start, 'leading');
          const outside = owner && index > 0 && !/\s/.test(src[owner.start - 1]);
          edits.push({ at: first.start, del: m[0].length, ins: outside || (owner && index > 0) ? '' : "{' '}" });
          if (outside) edits.push({ at: owner.start, del: 0, ins: ' ' });
        }
      }
      if (!solo && last.type === 'Text') {
        const m = /[ \t]+$/.exec(last.raw);
        if (m && !/\r?\n[ \t]*$/.test(last.raw)) {
          note(last.end - m[0].length, 'trailing');
          const outside = owner && index < siblings.length - 1 && !/\s/.test(src[owner.end]);
          edits.push({ at: last.end - m[0].length, del: m[0].length, ins: outside || (owner && index < siblings.length - 1) ? '' : "{' '}" });
          if (outside) edits.push({ at: owner.end, del: 0, ins: ' ' });
        }
      }
    }
    nodes.forEach((n, i) => visit(n, nodes, i));
  }
  function visit(node, siblings, index) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'RegularElement' && (node.name === 'pre' || node.name === 'textarea' || node.name === 'style' || node.name === 'script')) return;
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === 'object' && v.type === 'Fragment') {
        // Only an element's own content can have its space moved outside; a block branch cannot.
        const isElement = node.type === 'RegularElement' || node.type === 'Component' || node.type === 'SvelteElement';
        fragment(v, isElement && key === 'fragment' ? node : null, siblings, index);
      } else if (key === 'alternate' && v && v.type === 'Fragment') fragment(v, null, siblings, index);
    }
  }
  const ast = parse(src, { modern: true, filename: file });
  ast.fragment.nodes.forEach((n, i) => visit(n, ast.fragment.nodes, i));

  if (fix && edits.length) {
    let out = src;
    for (const e of edits.sort((a, b) => b.at - a.at || b.del - a.del)) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
    writeFileSync(file, out);
    console.log(`${relative('.', file)}: ${edits.filter(e => e.del).length} repaired`);
  }
}
if (!fix) console.log(found ? `\n${found} dropped spaces. Run with --fix to repair.` : 'No dropped spaces.');
process.exit(found && !fix ? 1 : 0);
