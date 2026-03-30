# IWSDK Starter Template

This folder is a source template used by `scripts/generate-starters.cjs` to produce 8 runnable variants:

- `starter-<vr|ar>-<manual|metaspatial>-<ts|js>`

Do not run this template directly. The generator will:

- Copy a variant-specific `src/index.ts` (see `src/index-*.ts`).
- Install the matching Vite config from `configs/`.
- Keep only the required metaspatial folder (renamed to `metaspatial`).
- Prune unused assets and dev dependencies.

UI is defined in `ui/welcome.uikitml`; the Vite UIKitML plugin compiles it to `public/ui/welcome.json` during build in generated variants.

## Multiplayer Development

This repo now includes a basic shared-room multiplayer implementation for:

- avatar pose sync
- shared model transform sync
- shared arrow transform sync
- per-object ownership so one user can hold the model and arrow at the same time

### Run locally

Start the WebSocket relay in one terminal:

```bash
npm run dev:server
```

Start the Vite client in another terminal:

```bash
npm run dev:client
```

The browser client connects to `/multiplayer`, and Vite proxies that secure WebSocket path to the local relay on port `8787`.

### Current behavior

- One shared room for all connected users
- Client-driven transform sync with server-tracked per-object ownership
- Remote avatars render head and both hands, while body and head halo are derived from the remote head pose
- Disconnecting a peer releases any object ownership held by that peer

### Current limitations

- No authentication or persistence
- No room ids yet
- Object ownership is optimistic and client-driven, not fully server-authoritative
- Grab detection relies on pointer events plus transform changes, so it is intentionally lightweight rather than deeply integrated with IWSDK internals
