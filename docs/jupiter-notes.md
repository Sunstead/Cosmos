# Jupiter follow-ups

Changes that belong in the Jupiter repo (`InventorPWB/Jupiter`), not here,
from the September 2026 audit. None of them blocks a Cosmos release.

## ntfy is infrastructure, not a service

Cosmos groups containers into services by the `cosmos.service` label, and a
container without one still becomes a service under its own name. The one
value it treats as infrastructure is `system`: hidden from Services, the
Overview (quick launch, service health, the constellation) and the command
palette, and given no automatic uptime check.

So on the ntfy container, in Jupiter's compose file:

```yaml
labels:
  cosmos.service: system   # was: ntfy
  # and remove cosmos.service.url / cosmos.service.description
```

Removing the label altogether would not work: ntfy would come back as a
service called "ntfy".

Losing the automatic uptime check is mostly moot (if ntfy is down, its own
alert can't reach you), but to keep an eye on it in the app, add a custom HTTP
check on the Uptime page for ntfy's `/v1/health` (for example
`https://ntfy.jupiter.sunstead.net/v1/health`).

Updates are unaffected: they group by image repository, not by this label.

## Stray notifications on deploys

Fixed in the agent (the release after 0.8.0); nothing to change in Jupiter.
The agent ignored SIGTERM for as long as any Cosmos window had a stream open,
so Docker killed it, and the next start sent "The agent stopped unexpectedly"
to ntfy. It now stops in well under a second.

Two things worth checking once that release is deployed, if phone
notifications still arrive during a push:

- If some arrive with no text at all, check that ntfy's message cache is on a
  persistent volume (`cache-file:` in `server.yml`). With the in-memory cache,
  messages published just before ntfy is recreated are gone, and a phone that
  fetches a message after being told about it (the iOS app always does, via
  `upstream-base-url`) gets nothing to show.
- The ntfy channel in Cosmos should use the `https://` address. An `http://`
  one that redirects used to show "Delivered" while nothing was sent; it now
  fails with "it moved to ...; use that address".

## Your Authentik avatar in the sidebar (optional)

The sidebar's account menu shows initials unless the access token carries a
`picture` claim, which Authentik's default mappings don't include. To show
the Authentik avatar, add a scope mapping (Customization > Property Mappings >
Scope Mapping) with scope name `profile` and this expression, then select it
on the Cosmos provider alongside the default `profile` mapping:

```python
return {"picture": request.user.avatar}
```

The app only uses `https://` URLs, so with Authentik's initials avatars (a
`data:` URL) it keeps showing its own initials.
