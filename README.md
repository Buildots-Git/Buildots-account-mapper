# Account Mapper

A Miro-style stakeholder map for Salesforce accounts. It builds an org chart from contact titles, lets you edit it by hand,
shows Salesforce data on every card, and can read an existing Miro board (or a picture of one) to import offices,
colours and reporting lines. Tracked in Jira as **BAO-1243**.

## Run it

Prerequisites: Node 20+, and the Salesforce CLI (`sf`) logged in to the org: `sf org login web --alias prod`.

```bash
npm install
npm run dev          # API on :8787, app on http://localhost:5173
```

First visit asks you to create the first account (it becomes the admin). Salesforce access is **read-only** unless you set
`ALLOW_WRITE=1` in `.env` (copy `.env.example`). With no `sf` login the app falls back to a small demo account.

Useful: `npm run build` (production bundle), `npm run test:auth` (33 checks of the sign-in logic against a throwaway server).

## How it fits together

```
server/            Node + Express API (no database: JSON files under data/)
  index.js         routes; every /api route needs a signed-in user
  auth.js          username/password (scrypt), sessions, lockout, CSRF header, user management
  salesforce.js    all Salesforce access goes through the `sf` CLI (it owns login + token refresh)
  ocr.js           reads a picture of an org chart on this machine: OCR + card boxes + lines/arrows + colours
  vision.js        optional: same job with Claude vision (needs an Anthropic API key)
  miro.js          reads a board through Miro's API (needs a Miro token)
  enrich.js        ZoomInfo / Lusha lookups with each user's own credentials (creds.js stores them encrypted)
  access.js        who may push changes back to Salesforce (+ audit log)
  paths.js         everything is stored under data/ (override with DATA_DIR)
src/               React + React Flow
  store.js         the single zustand store: board state, undo, persistence, sign-in
  Board.jsx        canvas: tidy-tree layout, drag/drop to re-parent, free-form notes/text/comment pins
  ContactNode.jsx  the contact card (CardBody is reused as the live preview in Customize cards)
  Panels.jsx       side panels: card editor, Customize cards, Enrich, Miro/reference, account info, comments
  importReview.js  matching picture/Miro cards to contacts + the review screen's apply logic (ReviewModal.jsx)
  hierarchy.js     title -> seniority -> reporting-line inference; status colours; Miro colour mapping
  Home.jsx         homepage tiles (recent boards, search)
```

Boards (positions, edits, comments, notes, card layout) are stored per account in `data/boards/<accountId>.json`.
Edits live on the board; nothing is written to Salesforce unless an allowed user chooses **Push** and `ALLOW_WRITE=1`.

## Rules for working on it

- **Never commit or share `data/`.** It contains customer boards, the user database, session tokens and the audit log.
  `.gitignore` excludes it. Do not paste tokens or API keys into code, issues or chat.
- The server listens on `127.0.0.1` only. Before exposing it to other machines, put it behind HTTPS (see `.env.example`).
- Salesforce calls run as whoever is logged in to `sf` on the server machine, so everyone using one server shares that
  login's permissions. Per-user Salesforce sign-in is the planned fix.
- Run the sign-in tests after touching `server/auth.js` or the route protection.

## Known gaps / ideas (see BAO-1243)

- Multi-user hosting: shared board storage, HTTPS, per-user Salesforce OAuth, Google sign-in for @buildots.com.
- Account load takes ~10-15 s (each query is a CLI call). A direct API connection would remove that.
- Picture reading: names cut off at the picture's edge can't be recovered; only arrows are read as reporting lines.
- Store each account's Miro link in Salesforce so nobody pastes it by hand.
