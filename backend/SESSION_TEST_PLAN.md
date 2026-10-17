# Instagram session strategy validation (staging only)

## Safety boundary
- This branch is a test candidate; it is not the production `main` branch.
- `IG_SESSION_STRATEGY` defaults to `legacy`, preserving the current session-ID flow.
- Do not merge or promote until the tests below pass on a separate Render staging service.
- Never add `IG_SESSIONID`, `IG_USERNAME`, `IG_PASSWORD`, saved settings, or cookies to GitHub.

## Staging configuration
1. Create a separate Render web service from branch `test/stable-instagram-session`; do not change the existing service.
2. Set `IG_SESSION_STRATEGY=validated`.
3. Configure `IG_USERNAME` and `IG_PASSWORD` only if the owner has intentionally supplied credentials for this test. Keep `IG_SESSIONID` as the existing fallback.
4. Optionally set `IG_SETTINGS_PATH` to a writable path. The default `/tmp/spy_omega_instagram_settings.json` is ephemeral; it is not durable storage and may disappear on restart/redeploy.
5. Keep the staging service private/unadvertised and do not point the production domain at it.

## Acceptance checks
- Install dependencies successfully with the pinned `instagrapi` version.
- Confirm `/health` and `/api/instagram/diagnostic` respond without exposing credentials.
- Query a known public creator profile and a known ordinary personal public profile.
- Repeat each lookup several times; check response correctness and whether session refresh happens without manually replacing `IG_SESSIONID`.
- Restart the staging service and repeat tests.
- Check logs for status/error classes while ensuring secrets, cookies, and full exception text are not logged.
- Exercise an invalid username, a temporarily unavailable profile, and rate limiting if it occurs naturally. Do not hammer Instagram or loop retries.
- Verify the existing feed path and production service remain unchanged.

## Known limits / decision gate
- This code only adds an opt-in credential-backed saved-session strategy; it does not guarantee that Instagram will allow every public profile lookup.
- The settings file on Render's ephemeral filesystem does not survive all redeploys. Durable cross-deploy session persistence requires an explicitly configured secure persistent store and must be designed separately; do not put session JSON in GitHub or logs.
- If Instagram presents a challenge, checkpoint, 2FA prompt, or rate limit, stop automated retries and resolve it manually.
- Promote only after staging results are recorded and the production owner explicitly approves.
