# Instagram session strategy validation (staging only)

## Safety boundary
- This branch is a test candidate; it is not the production `main` branch.
- `IG_SESSION_STRATEGY` defaults to `legacy`, preserving the current session-ID flow.
- Do not merge or promote until the tests below pass on a separate Render staging service.
- Never add `IG_SESSIONID`, `IG_USERNAME`, `IG_PASSWORD`, saved settings, or cookies to GitHub.
- Keep the dependency version aligned with production during this test so we isolate session-strategy changes rather than mixing in a library upgrade.

## Staging configuration
1. Create a separate Render web service from branch `test/stable-instagram-session`; do not change the existing service.
2. Set `IG_SESSION_STRATEGY=validated`.
3. Configure `IG_USERNAME` and `IG_PASSWORD` only if the owner intentionally chooses to test credential-based login. Keep `IG_SESSIONID` as the existing fallback.
4. Attach a Render persistent disk to the staging service, mounted at `/var/data`, if the Render plan/service supports it.
5. Set `IG_SETTINGS_PATH=/var/data/spy_omega_instagram_settings.json`. Do not use the default `/tmp/spy_omega_instagram_settings.json` for a persistence test: `/tmp` is ephemeral and can be cleared on restart/redeploy.
6. If a persistent disk is unavailable, do not claim that settings persist across restarts. Run only a clearly labeled ephemeral-login test, or pause and choose a secure persistent store before evaluating restart resilience.
7. Keep the staging service private/unadvertised and do not point the production domain at it.

## Acceptance checks
- Install dependencies successfully with the same pinned `instagrapi` version used by production.
- Confirm `/health` and `/api/instagram/diagnostic` respond without exposing credentials.
- Query one known public creator profile and one known ordinary personal public profile.
- Repeat each lookup a small number of times; check response correctness and whether session recovery works without manually replacing `IG_SESSIONID`.
- Restart the staging service and repeat tests to verify settings persist on the mounted disk.
- Check logs for status/error classes while ensuring secrets, cookies, and full exception text are not logged.
- Exercise an invalid username and a temporarily unavailable profile; if rate limiting occurs, stop instead of retrying aggressively.
- Verify the existing feed path and production service remain unchanged.

## Known limits / decision gate
- This code adds an opt-in credential-backed saved-session strategy; it does not guarantee that Instagram will allow every public profile lookup.
- Saved settings can help reuse authentication, but do not guarantee that Instagram will not invalidate a session or require a challenge, checkpoint, or 2FA.
- Persistent storage is required to test settings surviving service replacement/redeploy. Never put session JSON in GitHub or logs.
- If Instagram presents a challenge, checkpoint, 2FA prompt, or rate limit, stop automated retries and resolve it manually.
- Promote only after staging results are recorded and the production owner explicitly approves.
