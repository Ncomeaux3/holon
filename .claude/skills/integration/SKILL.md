---
name: integration
description: Add or change one external provider (bank, fitness, email, model, vault). Use when a module needs a new account connected or an existing provider's auth or client changes.
---
Work on POS integration: $ARGUMENTS

1. Read docs/ARCHITECTURE.md sections "Integration contract" and "Auth and secrets". Read integrations/$ARGUMENTS/ if it exists.
2. If the provider is new, run /research $ARGUMENTS first. Confirm auth type (token, oauth2, webhook), pricing, rate limits, and the exact API you will call. Log the decision.
3. In plan mode, propose:
   - integrations/$ARGUMENTS/manifest.ts: id, label, auth block, fields, test(), refresh() if oauth2, webhook() if webhook.
   - integrations/$ARGUMENTS/client.ts: the smallest wrapper that the manifest and modules need.
   - integrations/$ARGUMENTS/manifest.test.ts: manifest shape plus test() against a recorded fixture, no live calls in CI.
   - The connections.md row.
   - Which module manifests gain `requires: ['$ARGUMENTS']`.
4. Credentials always come from core.connections through getCredentials(). Never read a provider secret from .env. OAuth client id and secret are the only exception and they are app level.
5. Stop and wait for approval. Do not scaffold in the same session.
