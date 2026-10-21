# Scale Flow CRM 2.0

This project was built with [Lovable](https://lovable.dev).

Standalone frontend-only CRM demo. The original production CRM is untouched.

## Antigravity handoff
- [Architecture](docs/ARCHITECTURE.md)
- [Feature inventory and routes](docs/FEATURE_INVENTORY.md)
- [Data/action contracts](docs/DATA_CONTRACTS.md)
- [Independent backend checklist](docs/INTEGRATION_TODO.md)
- [Phase 2.5 audit, results and remaining gaps](docs/PHASE_2_5_AUDIT.md)
- [Premium redesign, page changes and verification report](docs/PREMIUM_REDESIGN.md)

Run the business tests with `bunx vitest run`. Demo records/preferences persist only in this browser; real authentication, AI, notifications and database persistence are not implemented.

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
