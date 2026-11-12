// Research pictures: one optional image per symbol, kept in the repository as images/<SYMBOL>.png
// (or .jpg) and published with it. The file name is the whole lookup: nothing lists the folder, so
// the ticker must match exactly, capitals included.
//
// Where to look, in order:
//  1. beside the app, which is where the folder is on the published site (the app is served from
//     the repository's top folder, next to images/), and one level up, for a build served from v2/;
//  2. the published site itself, so a copy of the app served from anywhere else (a local preview,
//     another device on the network) still finds the pictures.
// A build for a different repository sets VITE_PICTURES_URL to its own folder.
const PUBLISHED: string = import.meta.env.VITE_PICTURES_URL || 'https://imjnoenter.github.io/PortApp/images/';
const BASES = ['images/', '../images/', PUBLISHED];
const TYPES = ['png', 'jpg'];

/** Every address a symbol's picture could be at, most likely first. */
export const pictureUrls = (sym: string): string[] =>
  BASES.flatMap(base => TYPES.map(type => `${base}${encodeURIComponent(sym)}.${type}`));
