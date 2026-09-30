const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const username = clean(req.query?.username);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(400).json({ error: "Usuário do Instagram inválido" });
  }

  const upstream = String(process.env.RENDER_INSTAGRAM_API || "").replace(/\/$/, "");
  if (!upstream) return res.status(503).json({ error: "Instagram API não configurada." });

  try {
    const profileUrl = new URL(upstream + "/api/instagram/profile");
    profileUrl.searchParams.set("username", username);

    const profileResponse = await fetch(profileUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(50000),
    });
    const profileData = await profileResponse.json().catch(() => ({}));

    if (!profileResponse.ok || !profileData?.profile?.profilePic) {
      return res.status(profileResponse.ok ? 404 : profileResponse.status).json({
        error: "Foto de perfil não encontrada.",
      });
    }

    const imageResponse = await fetch(profileData.profile.profilePic, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://www.instagram.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!imageResponse.ok) {
      return res.status(502).json({ error: "O CDN do Instagram recusou a foto." });
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({ error: "O Instagram não retornou uma imagem." });
    }

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return res.status(502).json({ error: "Imagem de perfil inválida." });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("instagram_avatar_proxy_failed", error);
    return res.status(502).json({ error: "Não foi possível carregar a foto de perfil." });
  }
}
