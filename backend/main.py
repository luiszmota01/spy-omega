import os
import re
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from instagrapi import Client

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
CACHE_TTL_SECONDS = 60

app = FastAPI(title="Spy Omega Instagram API", version="1.0.0")

origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

_client: Client | None = None
_client_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def normalize_username(value: str) -> str:
    return str(value or "").strip().lstrip("@").strip().lower()


def make_client() -> Client:
    sessionid = os.getenv("IG_SESSIONID", "").strip()
    username = os.getenv("IG_USERNAME", "").strip()
    password = os.getenv("IG_PASSWORD", "").strip()

    cl = Client(
        request_timeout=15,
        public_request_retries_count=1,
        public_transport="curl",
        public_transport_impersonate="chrome136",
    )

    if sessionid:
        try:
            cl.login_by_sessionid(sessionid)
            return cl
        except Exception as exc:
            print(f"session login failed: {type(exc).__name__}: {exc}")

    if username and password:
        cl.login(username, password)
        return cl

    return cl


def get_client() -> Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = make_client()
        return _client


def serialize_user(user: Any) -> dict[str, Any]:
    return {
        "username": str(getattr(user, "username", "") or ""),
        "fullName": str(getattr(user, "full_name", "") or ""),
        "profilePic": str(getattr(user, "profile_pic_url", "") or ""),
        "followers": int(getattr(user, "follower_count", 0) or 0),
        "following": int(getattr(user, "following_count", 0) or 0),
        "posts": int(getattr(user, "media_count", 0) or 0),
        "biography": str(getattr(user, "biography", "") or ""),
        "isVerified": bool(getattr(user, "is_verified", False)),
        "isPrivate": bool(getattr(user, "is_private", False)),
        "isBusiness": bool(getattr(user, "is_business", False)),
        "related": [],
    }


def lookup_profile(username: str) -> dict[str, Any]:
    now = time.time()
    cached = _cache.get(username)
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    cl = get_client()
    errors: list[str] = []
    user = None

    has_private_auth = bool(
        getattr(cl, "authorization_data", None) or getattr(cl, "sessionid", None)
    )

    if has_private_auth:
        try:
            user = cl.user_info_by_username_v1(username)
        except Exception as exc:
            errors.append(f"user_info_by_username_v1: {type(exc).__name__}: {exc}")

    if user is None:
        try:
            user = cl.user_info_by_username(username, use_cache=False)
        except Exception as exc:
            errors.append(f"user_info_by_username: {type(exc).__name__}: {exc}")

    if user is None:
        try:
            user = cl.user_info_by_username_v2_gql(username)
        except Exception as exc:
            errors.append(f"user_info_by_username_v2_gql: {type(exc).__name__}: {exc}")

    if user is None:
        raise RuntimeError(" | ".join(errors) or "Instagram profile lookup failed")

    profile = serialize_user(user)
    if profile["username"].lower() != username:
        raise RuntimeError("Instagram returned a different username")

    _cache[username] = (now, profile)
    return profile


def serialize_media(media: Any, profile: dict[str, Any]) -> dict[str, Any]:
    resources = getattr(media, "resources", None) or []
    media_url = str(getattr(media, "thumbnail_url", "") or getattr(media, "url", "") or "")
    if resources:
        candidate = resources[-1]
        media_url = str(getattr(candidate, "thumbnail_url", "") or getattr(candidate, "url", "") or media_url)

    return {
        "id": str(getattr(media, "pk", "") or ""),
        "username": profile["username"],
        "fullName": profile["fullName"] or profile["username"],
        "profilePic": profile["profilePic"],
        "caption": str(getattr(media, "caption_text", "") or ""),
        "mediaType": str(getattr(media, "media_type", "") or ""),
        "mediaUrl": media_url,
        "thumbnailUrl": str(getattr(media, "thumbnail_url", "") or media_url),
        "permalink": f"https://www.instagram.com/p/{getattr(media, 'code', '')}/" if getattr(media, "code", "") else "",
        "timestamp": getattr(media, "taken_at", None).isoformat() if getattr(media, "taken_at", None) else "",
    }


def get_feed_for_user(username: str, amount: int = 4) -> list[dict[str, Any]]:
    profile = lookup_profile(username)
    if profile["isPrivate"]:
        return []

    cl = get_client()
    user_id = str(getattr(cl.user_info_by_username(username), "pk", "") or "")
    if not user_id:
        return []

    media = cl.user_medias(user_id, amount)
    return [serialize_media(item, profile) for item in media]


@app.get("/")
def root():
    return {"ok": True, "service": "spy-omega-instagram"}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/instagram/diagnostic")
def diagnostic():
    sessionid = bool(os.getenv("IG_SESSIONID", "").strip())
    username = bool(os.getenv("IG_USERNAME", "").strip())
    password = bool(os.getenv("IG_PASSWORD", "").strip())
    try:
        cl = get_client()
        private_auth = bool(
            getattr(cl, "authorization_data", None) or getattr(cl, "sessionid", None)
        )
        return {
            "ok": True,
            "sessionConfigured": sessionid,
            "usernameConfigured": username,
            "passwordConfigured": password,
            "privateAuthActive": private_auth,
        }
    except Exception as exc:
        return {
            "ok": False,
            "sessionConfigured": sessionid,
            "usernameConfigured": username,
            "passwordConfigured": password,
            "error": f"{type(exc).__name__}: {exc}",
        }


@app.get("/api/instagram/profile")
def profile(username: str = Query(..., min_length=1, max_length=30)):
    username = normalize_username(username)
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Usuário do Instagram inválido")

    try:
        return {"profile": lookup_profile(username)}
    except Exception as exc:
        print(f"instagram_profile_lookup_failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Não foi possível consultar o Instagram agora.",
        )


@app.get("/api/instagram/feed")
def feed(
    users: str = Query("", max_length=1000),
    exclude: str = Query("", max_length=30),
):
    requested = []
    for raw in users.split(","):
        username = normalize_username(raw)
        if username and USERNAME_RE.fullmatch(username):
            requested.append(username)

    excluded = normalize_username(exclude)
    requested = [u for u in dict.fromkeys(requested) if u != excluded][:10]

    posts: list[dict[str, Any]] = []
    suggestions: list[dict[str, Any]] = []

    for username in requested:
        try:
            posts.extend(get_feed_for_user(username, amount=4))
        except Exception as exc:
            print(f"instagram_feed_lookup_failed[{username}]: {type(exc).__name__}: {exc}")

    posts.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
    return {"posts": posts[:12], "suggestions": suggestions}
