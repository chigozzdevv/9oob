# Deployment examples

Run these commands from the repository root.

Deploy the Next.js app on Vercel with **Root Directory** set to `packages/nextjs`
and source files outside that directory included. The bundled Vercel configuration
builds the shared workspaces first. Set `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`,
`NOOB_SERVER_URL` and the server-only `NOOB_SERVER_API_KEY` in Vercel.

Run the execution API on a persistent server. [`deploy/compose.yaml`](compose.yaml)
includes the backend and authenticated MongoDB with a persistent volume. Copy
[`deploy/.env.example`](.env.example) to `deploy/.env`, configure the keys,
database passwords and public demo origin, then run:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build --wait
```

Route your HTTPS reverse proxy to `9oob-backend:3001` on the `9oob-edge` Docker network.
Use the same `NOOB_SERVER_API_KEY` on Vercel and the backend; it is never exposed to
the browser. The API starts its settlement worker automatically. Keep its database
volume when updating containers so pending executions can resume.
