# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pulldasher is a self-hosted GitHub pull request dashboard. It tracks PRs across repositories and displays them organized by status columns (CI Blocked, Deploy Blocked, Ready, Dev Block, CR, QA). Built with Node.js/Express backend and React/TypeScript frontend, connected via Socket.IO for real-time updates.

## Commands

- `npm start` — Run the server (Node.js backend serving the app)
- `npm run build` — Production webpack build (also runs automatically via `postinstall`)
- `npm run lint` — ESLint across the whole project
- `npm run frontend:start` — Frontend dev server with mock data at localhost:8080
- `npm run frontend:watch` — Watch mode for frontend webpack dev build
- `./bin/migrate` — Run database migrations from `migrations/`

## Architecture

**ES Modules**: The project uses `"type": "module"` — all backend files use `import`/`export` syntax.

**Backend** (Express + Socket.IO):
- `app.js` — Server setup, Express routes, Socket.IO configuration
- `controllers/githubHooks.js` — GitHub webhook handler (validates secret, dispatches to refresh logic)
- `lib/git-manager.js` — Octokit wrapper for all GitHub API calls
- `lib/db-manager.js` — MySQL CRUD operations for all models
- `lib/pull-manager.js` — In-memory pull state; broadcasts changes via Socket.IO
- `lib/refresh.js` — Orchestrates pull/issue refresh from GitHub API with queuing
- `lib/authentication.js` — Passport.js GitHub OAuth + optional org/team membership checks
- `lib/socket-auth.js` — Token-based Socket.IO authentication
- `models/` — Domain objects (Pull, Signature, Comment, Review, Status, Label, Issue) with corresponding `db_*.js` database wrappers

**Frontend** (React 17 + Chakra UI + TypeScript):
- `frontend/src/index.tsx` — Entry point
- `frontend/src/pull.ts` — Pull class with status computation methods (isCrDone, isQaDone, isReady, isCiBlocked, etc.)
- `frontend/src/pulldasher/` — Main dashboard: layout, pulls context (React Context API), Socket.IO sync, filtering, sorting
- `frontend/src/pull-card/` — Individual PR card components (signatures, commit statuses, flags)
- `frontend/src/types.ts` — TypeScript types and enums (PullState, StatusState, SignatureType, etc.)

**Data flow**: GitHub webhooks → `githubHooks.js` → `git-manager.js` (parse) → `db-manager.js` (persist) → `pull-manager.js` (broadcast via Socket.IO) → React context updates UI.

**Configuration**: Copy `config.example.js` to `config.js`. Key settings: GitHub OAuth/App credentials, MySQL connection, webhook secret, repo list, body/comment tag regex patterns for CR/QA signoffs.

## Signoff System

PR descriptions can set requirements (`cr_req N`, `qa_req N`). Comments/reviews matching tag patterns (configurable regex in `config.js`) count as CR or QA signoffs, or set dev_block/deploy_block flags. This drives which column a PR appears in on the dashboard.

## Frontend Development

TypeScript files (`.ts`/`.tsx`) use `@typescript-eslint`. React uses the modern JSX runtime (no `import React` needed). Webpack handles both JS/TS via Babel and ts-loader. The `frontend:start` script uses `frontend/dummy-pulls.json` for mock data without needing a backend.

## Database

MySQL with migrations in `migrations/` (numbered SQL files). Run `./bin/migrate` to apply. Key tables: `pulldasher_pulls`, `pulldasher_signatures`, `pulldasher_reviews`, `pulldasher_comments`, `pulldasher_commit_statuses`, `pulldasher_labels`, `pulldasher_issues`.
