import re
import time
from typing import Any

import instaloader
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
CACHE_TTL_SECONDS = 60

app = FastAPI(title="Spy Omega — Instaloader public probe", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

_loader = instaloader.Instaloader(
    quiet=True,
    download_pictures=False,
    download_videos=False,
    download_video_thumbnails=False,
    download_geotags=False,
    download_comments=False,
    save_metadata=False,
    compress_json=False,
)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def normalize_username(value: str) -> str:
    return str(value or "").strip().lstrip("@").strip().lower()


def load_profile(username: str):
    cached = _cache.get(username)
    now = time.time()
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    # Intentionally no login() and no session file: this test probes public access only.
    profile = instaloader.Profile.from_username(_loader.context, username)
    data = {
        "username": profile.username,
        "fullName": profile.full_name or "",
        "profilePic": str(profile.profile_pic_url or ""),
        "followers": int(profile.followers or 0),
        "following": int(profile.followees or 0),
        "posts": int(profile.mediacount or 0),
        "biography": profile.biography or "",
        "isVerified": bool(profile.is_verified),
        "isPrivate": bool(profile.is_private),
        "isBusiness": bool(getattr(profile, "is_business_account", False)),
        "related": [],
    }
    _cache[username] = (now, data)
    return data


@app.get("/")
def root():
    return {"ok": True, "service": "spy-omega-instaloader-test", "authenticated": False}


@app.get("/health")
def health():
    return {"ok": True, "library": "instaloader", "authenticated": False}


@app.get("/api/instagram/profile")
def profile(username: str = Query(..., min_length=1, max_length=30)):
    username = normalize_username(username)
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Usuário do Instagram inválido")
    try:
        return {"profile": load_profile(username)}
    except Exception as exc:
        # Keep response/logs free of URLs, cookies, and full request details.
        print(f"instaloader_profile_failed: {type(exc).__name__}")
        raise HTTPException(
            status_code=502,
            detail="Instaloader não conseguiu consultar esse perfil público agora.",
        )


@app.get("/api/instagram/feed")
def feed(
    username: str = Query(..., min_length=1, max_length=30),
    limit: int = Query(4, ge=1, le=4),
):
    username = normalize_username(username)
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Usuário do Instagram inválido")
    try:
        profile_data = load_profile(username)
        if profile_data["isPrivate"]:
            return {"posts": [], "username": username, "authenticated": False}
        profile_obj = instaloader.Profile.from_username(_loader.context, username)
        posts = []
        for post in profile_obj.get_posts():
            typename = str(getattr(post, "typename", "") or "")
            if typename == "GraphVideo":
                media_type = "2"
                media_url = str(getattr(post, "video_url", "") or getattr(post, "url", "") or "")
            elif typename == "GraphSidecar":
                media_type = "8"
                media_url = str(getattr(post, "url", "") or "")
            else:
                media_type = "1"
                media_url = str(getattr(post, "url", "") or "")
            posts.append({
                "id": str(getattr(post, "mediaid", "") or ""),
                "username": profile_data["username"],
                "fullName": profile_data["fullName"] or username,
                "profilePic": profile_data["profilePic"],
                "caption": str(getattr(post, "caption", "") or ""),
                "mediaType": media_type,
                "mediaUrl": media_url,
                "thumbnailUrl": str(getattr(post, "url", "") or media_url),
                "permalink": ("https://www.instagram.com/p/" + str(getattr(post, "shortcode", "") or "") + "/") if getattr(post, "shortcode", "") else "",
                "timestamp": post.date_utc.isoformat() if getattr(post, "date_utc", None) else "",
            })
            if len(posts) >= limit:
                break
        return {"posts": posts, "username": username, "authenticated": False}
    except Exception as exc:
        print(f"instaloader_feed_failed: {type(exc).__name__}")
        raise HTTPException(
            status_code=502,
            detail="Instaloader não conseguiu consultar as publicações agora.",
        )
