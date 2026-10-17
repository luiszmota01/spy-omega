// Isolated Apify avatar test endpoint.
// Requires APIFY_TOKEN in the Vercel Preview environment.
// This endpoint is intentionally separate from the production Instagram routes.
const clean = (value) => String(value || "").trim().replace(/^@+/, "").toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const username = clean(req.query?.username);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(400).json({ error: "Informe um usuário válido do Instagram.", code: "INVALID_USERNAME" });
  }

  const token = String(process.env.APIFY_TOKEN || "").trim();
  if (!token) {
    return res.status(503).json({
      error: "Falta configurar APIFY_TOKEN no ambiente Preview da Vercel.",
      code: "APIFY_TOKEN_NOT_CONFIGURED"
    });
  }

  try {
    const actorUrl = new URL("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items");
    actorUrl.searchParams.set("token", token);
    actorUrl.searchParams.set("format", "json");
    actorUrl.searchParams.set("clean", "true");
    actorUrl.searchParams.set("limit", "1");
    actorUrl.searchParams.set("timeout", "45");

    const actorResponse = await fetch(actorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ usernames: [username], includeAboutSection: false }),
      signal: AbortSignal.timeout(55000)
    });

    if (!actorResponse.ok) {
      const status = actorResponse.status;
      return res.status(status === 401 || status === 403 ? 502 : status === 408 ? 504 : 502).json({
        error: status === 401 || status === 403
          ? "A Apify recusou a autenticação. Confira APIFY_TOKEN."
          : status === 408
            ? "A Apify demorou demais para consultar o perfil."
            : "A Apify não conseguiu consultar esse perfil.",
        code: "APIFY_REQUEST_FAILED",
        upstreamStatus: status
      });
    }

    const items = await actorResponse.json();
    const profile = Array.isArray(items)
      ? items.find((item) => clean(item?.username) === username) || items[0]
      : null;
    const imageUrl = profile?.profilePicUrlHD || profile?.profilePicUrl;

    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(404).json({ error: "A Apify não retornou foto para esse perfil.", code: "PROFILE_IMAGE_NOT_FOUND" });
    }

    let parsedImageUrl;
    try {
      parsedImageUrl = new URL(imageUrl);
    } catch {
      return res.status(502).json({ error: "A Apify retornou uma URL de imagem inválida.", code: "INVALID_IMAGE_URL" });
    }

    const host = parsedImageUrl.hostname.toLowerCase();
    if (parsedImageUrl.protocol !== "https:" || !(host.endsWith(".fbcdn.net") || host.endsWith(".cdninstagram.com"))) {
      return res.status(502).json({ error: "A origem da imagem retornada não é permitida.", code: "UNTRUSTED_IMAGE_HOST" });
    }

    const imageResponse = await fetch(parsedImageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://www.instagram.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!imageResponse.ok) {
      return res.status(502).json({
        error: "A URL temporária da foto foi recusada pelo CDN do Instagram.",
        code: "IMAGE_CDN_REJECTED",
        upstreamStatus: imageResponse.status
      });
    }

    const contentType = imageResponse.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({ error: "O CDN não retornou um arquivo de imagem.", code: "NOT_AN_IMAGE" });
    }

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return res.status(502).json({ error: "O tamanho da imagem está fora do limite permitido.", code: "IMAGE_SIZE_INVALID" });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Avatar-Source", "apify");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("apify_avatar_test_failed", { name: error?.name || "Error" });
    return res.status(error?.name === "TimeoutError" ? 504 : 502).json({
      error: error?.name === "TimeoutError" ? "A consulta da foto expirou. Tente novamente." : "Não foi possível consultar a foto pela Apify.",
      code: error?.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "APIFY_AVATAR_FETCH_FAILED"
    });
  }
}
