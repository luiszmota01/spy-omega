const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();
const avatarPath = (imageUrl) => imageUrl ? `/api/instagram/avatar?url=${encodeURIComponent(String(imageUrl))}` : "";
const validUsername = (username) => /^[a-z0-9._]{1,30}$/.test(username);

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function mediaUrl(post) {
  const candidates = [
    post?.displayUrl, post?.display_url, post?.thumbnailUrl, post?.thumbnail_url,
    post?.imageUrl, post?.image_url, post?.videoUrl, post?.video_url,
  ];
  if (Array.isArray(post?.images) && post.images.length) candidates.unshift(post.images[0]?.url, post.images[0]);
  if (Array.isArray(post?.childPosts) && post.childPosts.length) candidates.unshift(post.childPosts[0]?.displayUrl);
  return String(firstValue(...candidates, "") || "");
}

function normalizePost(post, username, profile) {
  const url = mediaUrl(post);
  const code = String(firstValue(post?.shortCode, post?.shortcode, post?.code, "") || "");
  const id = String(firstValue(post?.id, post?.pk, code, "") || "");
  const date = firstValue(post?.timestamp, post?.takenAt, post?.taken_at, post?.date, "");
  const isVideo = Boolean(firstValue(post?.isVideo, post?.is_video, post?.videoUrl, post?.video_url, false));
  const profilePicture = firstValue(profile?.profilePicUrlHD, profile?.profilePicUrl, profile?.profile_pic_url, profile?.profilePictureUrl, "");
  return {
    id,
    username,
    fullName: String(firstValue(profile?.fullName, profile?.full_name, profile?.name, username) || username),
    profilePic: avatarPath(profilePicture) || `/api/instagram/avatar?username=${encodeURIComponent(username)}`,
    caption: String(firstValue(post?.caption, post?.captionText, post?.caption_text, "") || ""),
    mediaType: isVideo ? "video" : "image",
    mediaUrl: url,
    thumbnailUrl: String(firstValue(post?.thumbnailUrl, post?.thumbnail_url, post?.displayUrl, post?.display_url, url) || url),
    permalink: String(firstValue(post?.url, post?.permalink, code ? `https://www.instagram.com/p/${code}/` : "") || ""),
    timestamp: date ? (typeof date === "string" ? date : new Date(date).toISOString()) : "",
  };
}

async function fetchProfiles(usernames) {
  const token = String(process.env.APIFY_TOKEN || "").trim();
  if (!token) {
    const error = new Error("APIFY_TOKEN não está configurado no ambiente Preview da Vercel.");
    error.statusCode = 503;
    throw error;
  }

  const actorUrl = new URL("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items");
  actorUrl.searchParams.set("token", token);
  actorUrl.searchParams.set("format", "json");
  actorUrl.searchParams.set("clean", "true");
  actorUrl.searchParams.set("timeout", "45");

  const response = await fetch(actorUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ usernames, includeAboutSection: false }),
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok) {
    const error = new Error("A Apify não conseguiu carregar os dados do feed.");
    error.statusCode = response.status === 408 ? 504 : 502;
    throw error;
  }
  const items = await response.json();
  return Array.isArray(items) ? items : [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawUsers = String(req.query?.users || "");
  const users = rawUsers.split(",").map(clean).filter(validUsername);
  const exclude = clean(req.query?.exclude);
  const filtered = [...new Set(users.filter((username) => username !== exclude))].slice(0, 10);
  if (!filtered.length) return res.status(200).json({ posts: [], suggestions: [] });

  try {
    const items = await fetchProfiles(filtered);
    const byUsername = new Map(items.map((item) => [clean(item?.username || item?.userName), item]));
    const posts = [];
    const suggestions = [];

    for (const username of filtered) {
      const profile = byUsername.get(username);
      if (!profile) continue;

      const related = Array.isArray(profile.relatedProfiles) ? profile.relatedProfiles : [];
      for (const item of related) {
        const relatedUsername = clean(item?.username || item?.userName);
        const relatedPicture = firstValue(item?.profilePicUrlHD, item?.profilePicUrl, item?.profile_pic_url, item?.profilePictureUrl, "");
        if (relatedUsername && relatedUsername !== exclude) {
          suggestions.push({
            ...item,
            username: relatedUsername,
            profilePic: avatarPath(relatedPicture) || `/api/instagram/avatar?username=${encodeURIComponent(relatedUsername)}`,
          });
        }
      }

      const media = firstValue(profile.latestPosts, profile.latest_posts, profile.posts, profile.recentPosts, []);
      if (Array.isArray(media)) {
        for (const post of media) {
          const normalized = normalizePost(post, username, profile);
          if (normalized.mediaUrl) posts.push(normalized);
        }
      }
    }

    posts.sort((a, b) => {
      const ta = Date.parse(a.timestamp) || 0;
      const tb = Date.parse(b.timestamp) || 0;
      return tb - ta;
    });

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ posts: posts.slice(0, 12), suggestions: suggestions.slice(0, 20) });
  } catch (error) {
    console.error("apify_feed_lookup_failed", { name: error?.name || "Error" });
    return res.status(Number(error?.statusCode) || (error?.name === "TimeoutError" ? 504 : 502)).json({
      error: error?.message || "Não foi possível carregar o feed pela Apify.",
    });
  }
}
