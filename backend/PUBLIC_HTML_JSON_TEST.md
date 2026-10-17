# Spy Omega — public HTML + embedded JSON resilience probe

This is an isolated, unauthenticated experiment. It does not modify the production backend and must not be merged without review.

## Render test service

- Repository: `luiszmota01/spy-omega`
- Branch: `test/public-html-json-resilience`
- Root directory: `backend`
- Build command: `pip install -r requirements-public-html-json-test.txt`
- Start command: `uvicorn public_html_json_test:app --host 0.0.0.0 --port $PORT`
- Do not configure Instagram credentials or session variables.

## Test

1. Open `/health`.
2. Query `/api/instagram/profile?username=instagram`.
3. Query one ordinary public personal profile that you are authorized to inspect.
4. Record which fields were returned and the diagnostic source.

The endpoint makes one request to the public profile page, parses JSON already embedded in the HTML, and falls back to Open Graph metadata. It has a bounded timeout, no automatic retries, and stops on HTTP 429. It does not attempt to access private content.

## Decision criteria

Compare field completeness, latency, and success on both a known professional profile and a regular public personal profile. If it returns incomplete data or rate limits, record that result; do not repeatedly retry or promote this probe to production.
