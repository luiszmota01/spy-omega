# Spy Omega — direct public HTML probe (isolated test)

This is a separate experiment. It does not replace or modify the production backend.

## Render test service

- Service name: `spy-omega-public-html-test`
- Repository: `luiszmota01/spy-omega`
- Branch: `test/public-html-probe`
- Root directory: `backend`
- Build command: `pip install -r requirements-public-html-test.txt`
- Start command: `uvicorn public_html_test:app --host 0.0.0.0 --port $PORT`

No Instagram credentials or environment variables are required.

## Test

1. Open `/health`.
2. Open `/api/instagram/profile?username=instagram`.
3. The request has an 8-second timeout and does not automatically retry.
4. If Instagram rate-limits the service or withholds metadata, the endpoint returns a bounded error instead of waiting indefinitely.

This probe only checks public HTML metadata. It may return incomplete profile details and does not yet implement feed extraction. Do not merge into production unless results are reviewed and validated.
