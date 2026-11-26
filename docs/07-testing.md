# 07 — Testing

## Test Runner

**Vitest** — configured via `vite.config.js` (or `vitest.config.js`).

## Running Tests

```powershell
# Set PATH first (see 02-environment-config.md)
$env:PATH = "C:\Users\khaled\AppData\Roaming\fnm\node-versions\v26.13.0\installation;$env:PATH"

npm test
```

## Current Status

- **12 tests total — all passing** as of the last verified run
- Tests cover core business logic (calculations, formatters, DB helpers)

## Build Verification

Always run a production build after any significant change to catch Vite/TypeScript/import errors that the dev server might miss:

```powershell
npm run build
```

A successful build outputs to `dist/` and should show no errors in the console.

## Checklist Before Committing

- [ ] `npm run build` — passes with no errors
- [ ] `npm test` — all 12 tests pass
- [ ] Dev server (`npm run dev`) — app loads at `http://localhost:5173/mobile-shop/`
- [ ] Login works with PIN `1234`
- [ ] Only **one** admin appears in the login dropdown
- [ ] No console errors on first load
