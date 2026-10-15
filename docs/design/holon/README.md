# Holon mockups (Phase 0)

Static HTML under this folder, built from the app's real screen contracts and synthetic data. They settle shell, type, density, controls and the drawer before any app code changes; `holon.css` is the draft of the Phase 1 token block in `app/globals.css`.

Open `index.html` in a browser. Below 768 px the rail becomes the tab bar. The theme control in the rail sets `data-theme` on `html`; System removes it and the page follows the device.

The font and the ribbon are read from `holon-cobalt-sand/` (gitignored, unpacked from the brand zip beside this repo's root). Phase 1 copies both into `app/fonts/` and `public/brand/`.

Screenshots: `node e2e/.scratch/mockups.mjs` writes both widths and both themes for every page to `e2e/.scratch/mockups/`.
