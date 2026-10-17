const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();
const avatarPath = (username) => `/api/instagram/avatar?username=${encodeURIComponent(username)}`;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const upstream = String(process.env.RENDER_INSTAGRAM_API || "").replace(/\/$/, "");
  if (!upstream) {
    return res.status(503).json({
      error: "Instagram API não configurada.",
      code: "RENDER_INSTAGRAM_API_NOT_CONFIGURED",
    });
  }

  const rawUsers = String(req.query?.users || "");
  const users = rawUsers.split(",").map(clean).filter((u) => /^[a-z0-9._]{1,30}$/.test(u)).slice(0, 10);
  const exclude = clean(req.query?.exclude);
  const filtered = users.filter((u) => u !== exclude);

  if (!filtered.length) return res.status(200).json({ posts: [], suggestions: [] });

  try {
    const url = new URL(upstream + "/api/instagram/feed");
    url.searchParams.set("users", filtered.join(","));
    if (exclude) url.searchParams.set("exclude", exclude);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(50000),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        error: data?.detail || data?.error || "Falha ao carregar o feed.",
      });
    }

    const posts = Array.isArray(data?.posts)
      ? data.posts.map((post) => ({
          ...post,
          profilePic: post?.username ? avatarPath(clean(post.username)) : post?.profilePic,
        }))
      : [];
    const suggestions = Array.isArray(data?.suggestions)
      ? data.suggestions.map((profile) => ({
          ...profile,
          profilePic: profile?.username ? avatarPath(clean(profile.username)) : profile?.profilePic,
        }))
      : [];

    return res.status(200).json({ posts, suggestions });
  } catch (error) {
    console.error("instagram_feed_proxy_failed", error);
    return res.status(502).json({ error: "Não foi possível conectar ao backend do Instagram." });
  }
}
