# 3rok design system

Drop this folder into your project (for example `src/design-system/` or `public/`), and copy `.cursor/rules/3rok-design-system.mdc` to your project's `.cursor/rules/` so Cursor follows the system when it writes UI.

## Use it

1. Import the styles once at the app root:
   - Next/Vite/React: `import './design-system/tokens.css'; import './design-system/components/bundle.css';`
   - Plain HTML: `<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components/bundle.css">`
2. Use the variables and classes: `background: var(--surface-100); color: var(--ink); padding: var(--space-5);` and class names such as `display-xl`, `eyebrow`, `data-md`.
3. Light report theme: set `data-theme="light"` on `<html>`.
4. Components: `components/bundle.js` is a classic script that defines `window.Rok` (needs React 18 loaded first). In a bundled React app, ask Cursor to port each component to a local `.tsx` file using the classes in `bundle.css`; `components/index.d.ts` documents the props.

`tokens.json` is the same token data in machine-readable form (colors by theme, type, spacing, radii, shadow) for Tailwind config or Style Dictionary.
