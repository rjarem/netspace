# AGENTS.md — GrooveRadius (internal name: netspace)

A real-time spatial event platform: a 2D tile map where attendees walk, talk
(spatial audio via LiveKit), and interact. Single Node process (Colyseus) +
LiveKit SFU + Vite/Phaser client. Production: play.turedvirtual.vip via Dokploy.

## Source of truth (read before working)

- `docs/PLAN-AUDITOR.md` — canonical rules: phases, findings H1-H17, signed
  plans and pending disputes. A signed plan is binding; changes need the
  auditor's approval via mini-plan.
- `docs/runbook.md` — operational gotchas (local LiveKit, gate rules, deploy).
- `docs/handoffs/` — per-session history; every cycle closes with a full
  regression run plus a handoff doc.

## How to run and test

- Monorepo (pnpm): `packages/server` (tsx watch / tsc / node dist), `packages/client`
  (vite), `packages/shared`. The server dist IS committed — rebuild and commit
  it together with any src change.
- E2E gates live in `packages/server/scripts/` (pattern: headless chrome via
  CDP or colyseus.js clients, `check()` assertions, exit code = pass count).
  Run the full regression before closing any cycle. Local LiveKit is required
  for audio gates: `docker run -d --name gr-livekit-gate --network host
  livekit/livekit-server --dev`.
- Local dev env: `ADMIN_TOKEN=dev-admin` (server). Never use prod secrets in
  local scripts.

## Conventions

- Commits: `cicloN.M: <what> — gates X/Y PASS` per cycle item; commit the
  regression summary in the final commit of the cycle.
- All client-side persisted keys are `gr-*` (invite, handle, photo, devices).
- JWTs with role=admin are NEVER persisted client-side.
- Every new admin surface ships with its gate; every fix ships with a smoke.

## Never touch (without explicit authorization)

- `packages/client/src/voice.ts` — audio engine; changes require a signed plan.
- Deploy: the codeload tarball pin is updated MANUALLY in Dokploy (world +
  client + BUILD_SHA, 3 occurrences). API redeploys do NOT re-download; always
  pin to the new commit hash and re-run the mint smoke post-deploy.
- Production: no load tests, no probes beyond the signed smokes.
