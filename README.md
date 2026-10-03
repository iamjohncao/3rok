# 3rok

3rok takes chip-test data, asks Grok for a flight algorithm that keeps those chips alive longer, and saves that work so you can edit it and fly it on a globe.

The saved container is a **case**. The flight algorithm is a CCSDS OEM 3.0 file. Grok proposes it and a separate evaluator decides whether to keep it. Grok's weights never change.

Live app: https://3rok.vercel.app (`3rok1.vercel.app` is a different project).

## Read first

| File | What it is |
|---|---|
| [docs/product-spec.md](docs/product-spec.md) | What 3rok is |
| [docs/mvp-phase-plan.md](docs/mvp-phase-plan.md) | The build order, phase by phase, with done-when gates |
| [docs/universal-data-input-guidelines.md](docs/universal-data-input-guidelines.md) | The nine record types and their fields |
| [docs/flight-algorithm-oem.md](docs/flight-algorithm-oem.md) | The OEM profile |
| [docs/grok-flight-mcp.md](docs/grok-flight-mcp.md) | The xAI request and the three MCP tools |
| [docs/flowchart.md](docs/flowchart.md) | The platform flowchart |

## Run it

Needs Node 22 (22.12 or newer). The project pins `22.x`, which is what Vercel builds with.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # contract and design-gate tests
npm run typecheck
npm run build
```

Copy `.env.example` to `.env.local` when a phase needs a key. Phases 0 and 1 need none.

## Layout

| Path | What |
|---|---|
| `app/` | Next.js App Router: `/cases`, `/cases/[id]`, `/test`, `/account` |
| `components/ui/` | Local ports of the design-system components, reusing `bundle.css` |
| `lib/case.ts` | The only case shape. Every lane reads it |
| `fixtures/` | `minimal.oem`, the shape example |
| `3rok-design-system/` | Tokens, fonts and component CSS. Not edited |
| `starmind-physics/` | Python physics package behind `score_candidate`. Not moved |
| `.cursor/rules/` | Design-system rules for AI editors |

## Hosting

- **Vercel** builds from this repo. A push to `main` deploys to production. Every other branch and pull request gets a preview deployment.
- **Supabase** holds accounts and saved cases from Phase 3 on.
- Secrets live in Vercel's environment variables and never in the repo. See `.env.example`.

## License

See [LICENSE](LICENSE).
