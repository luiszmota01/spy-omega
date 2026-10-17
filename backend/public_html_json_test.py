import json
import re
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from typing import Any

from fastapi import FastAPI, HTTPException, Query

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
TIMEOUT_SECONDS = 8
MAX_HTML_BYTES = 6_000_000
MAX_SCRIPT_CHARS = 2_000_000

app = FastAPI(title="Spy Omega — public HTML JSON resilience probe", version="0.1.0")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.scripts: list[tuple[str, str, str]] = []
        self._script_type = ""
        self._script_id = ""
        self._script_parts: list[str] = []
        self._in_script = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag = tag.lower()
        if tag == "meta":
            key = (attrs_dict.get("property") or attrs_dict.get("name") or "").lower()
            value = attrs_dict.get("content")
            if key and value:
                self.meta[key] = value
        elif tag == "script":
            self._in_script = True
            self._script_type = (attrs_dict.get("type") or "").lower()
            self._script_id = attrs_dict.get("id") or ""
            self._script_parts = []

    def handle_data(self, data):
        if self._in_script and sum(map(len, self._script_parts)) < MAX_SCRIPT_CHARS:
            self._script_parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self._in_script:
            self.scripts.append((self._script_type, self._script_id, "".join(self._script_parts)))
            self._in_script = False
            self._script_type = ""
            self._script_id = ""
            self._script_parts = []


def normalize_username(value: str) -> str:
    return str(value or "").strip().lstrip("@").strip().lower()


def walk_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_dicts(child)


def parse_json_candidates(scripts: list[tuple[str, str, str]]) -> list[Any]:
    candidates: list[Any] = []
    decoder = json.JSONDecoder()
    for script_type, script_id, source in scripts:
        if not source:
            continue
        stripped = source.strip()
        # Parse explicit JSON script payloads and JSON-only framework state.
        if "ld+json" in script_type or script_id in {"__NEXT_DATA__", "__NUXT_DATA__"} or stripped.startswith(("{", "[")):
            try:
                candidates.append(json.loads(stripped))
            except (json.JSONDecodeError, RecursionError):
                pass

        # Parse known public page-state assignments only; no additional requests.
        patterns = (
            r"window\._sharedData\s*=\s*(\{.*?\})\s*;",
            r"window\.__additionalDataLoaded\([^,]+,\s*(\{.*?\})\s*\)\s*;",
        )
        for pattern in patterns:
            for match in re.finditer(pattern, source, flags=re.DOTALL):
                try:
                    candidates.append(json.loads(match.group(1)))
                except (json.JSONDecodeError, RecursionError):
                    continue

        # Some pages place the profile payload in a JSON object without a named assignment.
        # Scan a bounded number of object starts, keeping the test predictable.
        if len(source) <= MAX_SCRIPT_CHARS:
            scans = 0
            for index, char in enumerate(source):
                if char != "{":
                    continue
                scans += 1
                if scans > 250:
                    break
                try:
                    parsed, _ = decoder.raw_decode(source[index:])
                    if isinstance(parsed, (dict, list)):
                        candidates.append(parsed)
                except (json.JSONDecodeError, RecursionError):
                    continue
    return candidates


def get_count(obj: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = obj.get(key)
        if isinstance(value, dict) and isinstance(value.get("count"), (int, float)):
            return int(value["count"])
        if isinstance(value, (int, float)):
            return int(value)
    return None


def find_profile(candidates: list[Any], username: str) -> dict[str, Any] | None:
    matches = []
    for candidate in candidates:
        for obj in walk_dicts(candidate):
            if normalize_username(str(obj.get("username") or "")) == username:
                matches.append(obj)
    if not matches:
        return None

    # Prefer the matching object with the greatest number of profile-like fields.
    def score(obj):
        fields = ("full_name", "fullName", "biography", "profile_pic_url", "profile_pic_url_hd",
                  "edge_followed_by", "edge_follow", "edge_owner_to_timeline_media",
                  "followers", "followers_count", "following_count", "media_count")
        return sum(1 for key in fields if key in obj)

    obj = max(matches, key=score)
    return {
        "username": username,
        "fullName": obj.get("full_name") or obj.get("fullName") or obj.get("name") or "",
        "biography": obj.get("biography") or obj.get("description") or "",
        "profilePic": obj.get("profile_pic_url_hd") or obj.get("profile_pic_url") or obj.get("profilePicUrl") or "",
        "followers": get_count(obj, ("edge_followed_by", "followers", "followers_count")),
        "following": get_count(obj, ("edge_follow", "following", "following_count")),
        "posts": get_count(obj, ("edge_owner_to_timeline_media", "media_count", "posts_count")),
        "isPrivate": obj.get("is_private") if isinstance(obj.get("is_private"), bool) else None,
        "isVerified": obj.get("is_verified") if isinstance(obj.get("is_verified"), bool) else None,
    }


def fetch_page(username: str):
    url = f"https://www.instagram.com/{username}/"
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
    })
    started = time.monotonic()
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            body = response.read(MAX_HTML_BYTES + 1)
    except HTTPError as exc:
        if exc.code == 429:
            raise HTTPException(status_code=429, detail={
                "error": "instagram_rate_limited",
                "message": "O Instagram limitou a consulta. O teste não fará novas tentativas automáticas.",
                "upstream_status": 429,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            })
        raise HTTPException(status_code=502, detail={
            "error": "instagram_upstream_http_error",
            "upstream_status": exc.code,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        })
    except (TimeoutError, URLError) as exc:
        raise HTTPException(status_code=504, detail={
            "error": "instagram_upstream_timeout_or_network_error",
            "message": "A consulta pública não terminou dentro do limite.",
            "exception_type": type(exc).__name__,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        })

    if len(body) > MAX_HTML_BYTES:
        body = body[:MAX_HTML_BYTES]
    html = body.decode("utf-8", errors="replace")
    parser = PageParser()
    parser.feed(html)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    return status, parser, elapsed_ms


@app.get("/")
def root():
    return {"ok": True, "service": "spy-omega-public-html-json-test", "authenticated": False}


@app.get("/health")
def health():
    return {
        "ok": True,
        "method": "public_html_embedded_json",
        "authenticated": False,
        "automatic_retries": False,
    }


@app.get("/api/instagram/profile")
def profile(username: str = Query(..., min_length=1, max_length=30)):
    username = normalize_username(username)
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Usuário do Instagram inválido")

    status, parser, elapsed_ms = fetch_page(username)
    candidates = parse_json_candidates(parser.scripts)
    data = find_profile(candidates, username)
    source = "embedded_json"

    if not data:
        # Open Graph is used only as a last fallback, not as evidence of complete metadata.
        title = parser.meta.get("og:title", "")
        description = parser.meta.get("og:description", "")
        image_url = parser.meta.get("og:image", "")
        if title or description or image_url:
            data = {
                "username": username,
                "fullName": title.split(" (", 1)[0].strip() if title else "",
                "biography": description,
                "profilePic": image_url,
                "followers": None,
                "following": None,
                "posts": None,
                "isPrivate": None,
                "isVerified": None,
            }
            source = "open_graph_fallback"

    if not data or not any(data.get(key) not in (None, "") for key in ("fullName", "biography", "profilePic", "followers", "following", "posts")):
        raise HTTPException(status_code=422, detail={
            "error": "profile_metadata_unavailable",
            "message": "A página respondeu, mas não forneceu metadados de perfil suficientes.",
            "upstream_status": status,
            "elapsed_ms": elapsed_ms,
            "scripts_seen": len(parser.scripts),
            "json_candidates": len(candidates),
        })

    return {
        "profile": data,
        "diagnostics": {
            "method": source,
            "authenticated": False,
            "upstream_status": status,
            "elapsed_ms": elapsed_ms,
            "scripts_seen": len(parser.scripts),
            "json_candidates": len(candidates),
            "note": "Consulta única à página pública; sem login, sem sessão e sem tentativas automáticas.",
        },
    }
