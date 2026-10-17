# Isolated Instaloader public-access test

This is a standalone test service and must not replace the production backend.

## Render staging configuration
- Repository: `luiszmota01/spy-omega`
- Branch: `test/instaloader-public-probe`
- Root directory: `backend`
- Build command: `pip install -r requirements-instaloader-test.txt`
- Start command: `uvicorn instaloader_test:app --host 0.0.0.0 --port $PORT`
- Environment: no Instagram username, password, or session ID is needed or used.

## Tests
1. `GET /health`
2. `GET /api/instagram/profile?username=PUBLIC_PERSONAL_USERNAME`
3. `GET /api/instagram/profile?username=PUBLIC_CREATOR_USERNAME`
4. `GET /api/instagram/feed?username=PUBLIC_PERSONAL_USERNAME&limit=4`

Use public profiles you are authorized to inspect. Do not hammer the endpoints; Instagram can rate-limit anonymous requests. If the service returns 429, a challenge, or repeated 502 responses, stop and record the result rather than retrying aggressively.

The probe has its own module and dependency file. It does not alter `backend/main.py`, the production requirements file, or the production branch.
