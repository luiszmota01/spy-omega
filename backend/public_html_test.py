import re
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Query

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
TIMEOUT_SECONDS = 8

app = FastAPI(title="Spy Omega — Public HTML Probe", version="0.1.0")


class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.title_parts = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            value = attrs.get("content")
            if key and value:
                self.meta[key] = value
        elif tag.lower() == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title and data.strip():
            self.title_parts.append(data.strip())


def normalize_username(value: str) -> str:
    return str(value or "").strip().lstrip("@").strip().lower()


@app.get("/")
def root():
    return {"ok": True, "service": "spy-omega-public-html-test", "authenticated": False}


@app.get("/health")
def health():
    return {"ok": True, "method": "direct_public_html", "authenticated": False}


@app.get("/api/instagram/profile")
def profile(username: str = Query(..., min_length=1, max_length=30)):
    username = normalize_username(username)
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Usuário do Instagram inválido")

    url = "https://www.instagram.com/" + username + "/"
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
    )

    started = time.monotonic()
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            body = response.read(2_000_000).decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code == 429:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "instagram_rate_limited",
                    "message": "O Instagram limitou a consulta direta. Nenhuma nova tentativa automática foi feita.",
                },
            )
        raise HTTPException(
            status_code=502,
            detail={"error": "instagram_http_error", "upstream_status": exc.code},
        )
    except (TimeoutError, URLError) as exc:
        reason = "timeout" if isinstance(exc, TimeoutError) or "timed out" in str(exc).lower() else "connection_error"
        raise HTTPException(
            status_code=504 if reason == "timeout" else 502,
            detail={"error": reason, "message": "A página pública não respondeu dentro do limite do teste."},
        )
    except Exception as exc:
        print("public_html_probe_failed:", type(exc).__name__)
        raise HTTPException(status_code=502, detail={"error": "public_html_probe_failed"})

    parser = MetaParser()
    parser.feed(body)
    description = parser.meta.get("og:description", "")
    title = parser.meta.get("og:title", "") or " ".join(parser.title_parts)
    image = parser.meta.get("og:image", "")
    final_url = parser.meta.get("og:url", "")

    # Instagram may return a login shell or consent page rather than profile metadata.
    looks_like_profile = bool(title and (username.lower() in title.lower() or description))
    if not looks_like_profile or ("login" in title.lower() and not description):
        raise HTTPException(
            status_code=502,
            detail={
                "error": "profile_metadata_unavailable",
                "message": "O Instagram respondeu, mas não entregou metadados públicos suficientes.",
                "upstream_status": status,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            },
        )

    return {
        "profile": {
            "username": username,
            "fullName": title,
            "biography": description,
            "profilePic": image,
            "profileUrl": final_url or url,
            "followers": None,
            "following": None,
            "posts": None,
        },
        "diagnostics": {
            "method": "direct_public_html",
            "authenticated": False,
            "upstream_status": status,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "note": "Counts are left null unless reliably available in public page metadata.",
        },
    }
