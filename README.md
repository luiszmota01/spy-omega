# Spy Omega

## Instagram backend

The frontend uses Vercel as a thin proxy and a separate FastAPI service for Instagram lookups.

```
Browser -> Vercel /api/instagram -> Render -> instagrapi -> Instagram
```

Set the Render service variables `IG_SESSIONID` (preferred), or `IG_USERNAME` + `IG_PASSWORD` as a fallback. Do not commit credentials.

Set `RENDER_INSTAGRAM_API` in Vercel to the Render service base URL, for example `https://your-service.onrender.com`.

The backend only returns profile/feed data available to the authorized session or public web flow. Private profiles do not have their media exposed by the feed endpoint.

The Instagram library is unofficial and public web behavior can change; failures, rate limits, or login requirements can still occur.


<!-- deployment sync -->
