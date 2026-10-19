<p align="center"><img src="web/public/favicon.svg" width="96" alt="Communal Cache"></p>

# Communal Cache

Share things among your community 🧑‍🤝‍🧑

Communal Cache is a small app for a close community to share household items.
Join a cache and you'll be able to loan and borrow items with your friends, neighbors or whatever other group you are sharing items amongst.
All communication happens outside of the app and handoff happens in person.

[Visit communalcache.com](https://communalcache.com)

## Why

I was making some wintermelon tea at a friend's place and asked to use their brown sugar. Their bag hadn't been touched in ages. 
I realized I also had a mostly-full bag sitting in my cupboard at home. Ideally we would've been able to coordinate what we had ahead of time 
and avoided each having a bag of brown sugar that is mostly relegated to clump together over months and years.

### Why cats

I love cats :3

## Privacy

Privacy is a big concern, especially in this day and age. This app was intentionally designed to require as little information as possible. Currently the only things that are stored are emails and optionally a contact method that is only displayed when a request is approved.
There are NO addresses, names, or other identifying information stored. If you have any concerns please reach out to me and I will be happy to address them.

## Architecture

One Worker serves the app and API, with one database for all app data.
Photos stay private; background notifications use email or web push.

```mermaid
flowchart TB
    Browser["Browser: React PWA"] --> Worker["Cloudflare Worker: API, static assets, Better Auth"]
    Worker --> D1["D1: all app data"]
    Worker --> R2["R2: private photos"]
    Worker --> Background["Queue + Cron: notifications and retries"]
    Background --> Delivery["Resend email / Web Push"]
```

## Run locally

Requires Node.js 22.12 or newer. Install dependencies and copy the local settings:

```bash
npm install --silent
npm --prefix web install --silent
cp .dev.vars.example .dev.vars
```

In `.dev.vars`, set `BETTER_AUTH_SECRET` to a fresh local-only secret of at least
32 characters. Keep both app URLs set to `http://localhost:8787`; never commit
secrets. Email sign-in and bot checks need provider settings—see the
[local setup guide](docs/deploy.md). For a provider-free UI walkthrough, run
`npm run ui:fixture` and open `http://127.0.0.1:4173/login` instead.

Build the web app, apply migrations to the local database, and start the Worker:

```bash
npm --prefix web run build --silent
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev
```

Open `http://localhost:8787`. Run the tests with `npm test -- --silent`.
Tests use local Cloudflare bindings and mock external providers; don't use production credentials.

## Docs

- [Plan](docs/plan.md) — product scope and architecture decisions.
- [Build guide](docs/build-guide.md) — implementation status and validation checks.
- [Database](docs/database.md) — schema, migrations and local database tests.
- [Deploy](docs/deploy.md) — setup, deployment and operations.
- [AGENTS.md](AGENTS.md) — contributor and agent rules.

## License

Copyright (C) 2026 Ryan Zhou. Licensed under the [GNU AGPL v3.0](LICENSE): if you run a modified copy as a service, you must share its source.
