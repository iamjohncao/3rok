# design/

## melos-design-system.zip

Uploaded by the repository owner on 2026-10-24 as the core design file. It is committed here exactly as uploaded: 99 files, 14.9 MB unpacked, one top-level folder `melos-design-system/`.

**What it is.** A complete design system for **Melos**, a different product: it turns a student's Spotify into concert plans, launching at UC Berkeley. It holds design tokens (`tokens/`), React components and a built bundle (`components/`: ArtistCard, ConcertCard, MatchCard, ChatBubble, SpotifyConnectButton, SchoolPicker, Wordmark, and others), brand, voice and theming guides (`docs/`), page mockups (`mockups/`), and the Bricolage Grotesque and Figtree fonts under the SIL Open Font License (`assets/fonts/`).

**What it is not.** It is not the design system this app uses. 3rok's app is built on [`3rok-design-system/`](../3rok-design-system), with Barlow and IBM Plex Mono, a dark theme, and the thermal tokens the globes read. Nothing in this repository imports the zip, and no test reads it.

**Using it.** To read it, unzip it into a new folder outside the repository. Replacing `3rok-design-system/` with it would change the app's fonts, colours and components, the rules in `CLAUDE.md` and `.cursor/rules/3rok-design-system.mdc`, and the checks in `tests/design-gates.test.ts`, so that is a decision to take on its own.
