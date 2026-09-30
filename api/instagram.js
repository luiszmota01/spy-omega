const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();

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

    const result = data?.profile ? { ...data, profile: { ...data.profile, profilePic: `/api/instagram/avatar?username=${encodeURIComponent(data.profile.username || username)}` } } : data;
    return res.status(200).json(result);
  } catch (error) {
    console.error("instagram_proxy_failed", error);
    return res.status(502).json({ error: "Não foi possível conectar ao backend do Instagram." });
  }
}
