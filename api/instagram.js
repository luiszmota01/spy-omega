const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();
const avatarPath = (username) => `/api/instagram/avatar?username=${encodeURIComponent(username)}`;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const username = clean(req.query?.username);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(400).json({ error: "Usuário do Instagram inválido" });
  }

  const upstream = String(process.env.RENDER_INSTAGRAM_API || "").replace(/\/$/, "");
  if (!upstream) {
    return res.status(503).json({
      error: "Instagram API não configurada.",
      code: "RENDER_INSTAGRAM_API_NOT_CONFIGURED",
    });
  }

  try {
    const url = new URL(upstream + "/api/instagram/profile");
    url.searchParams.set("username", username);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(50000),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        error: data?.detail || data?.error || "Falha ao consultar o Instagram.",
      });
    }

    if (!data?.profile) return res.status(200).json(data);

    const profile = {
      ...data.profile,
      profilePic: avatarPath(clean(data.profile.username || username)),
      related: Array.isArray(data.profile.related)
        ? data.profile.related.map((item) => ({
            ...item,
            profilePic: item?.username ? avatarPath(clean(item.username)) : item?.profilePic,
          }))
        : data.profile.related,
    };

    // Cache successful profile lookups at Vercel's edge so repeat searches return quickly.
    // The short TTL keeps profile details reasonably fresh; stale responses can be served while refreshing.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ...data, profile });
  } catch (error) {
    console.error("instagram_proxy_failed", error);
    return res.status(502).json({ error: "Não foi possível conectar ao backend do Instagram." });
  }
}
