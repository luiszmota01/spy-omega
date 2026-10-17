const clean = (value) => String(value || "").trim().replace(/^@+/, "").toLowerCase();
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isAllowedImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host.endsWith(".fbcdn.net") || host.endsWith(".cdninstagram.com"));
  } catch {
    return false;
  }
}

async function downloadImage(url, timeoutMs = 15000) {
  if (!isAllowedImageUrl(url)) return null;
  const response = await fetch(url, {
    headers: { Accept: IMAGE_ACCEPT, Referer: "https://www.instagram.com/", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { buffer, contentType };
}

async function getApifyImage(username, token) {
  const actorUrl = new URL("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items");
  actorUrl.searchParams.set("token", token);
  actorUrl.searchParams.set("format", "json");
  actorUrl.searchParams.set("clean", "true");
  actorUrl.searchParams.set("limit", "1");
  actorUrl.searchParams.set("timeout", "45");

  const response = await fetch(actorUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ usernames: [username], includeAboutSection: false }),
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok) throw new Error("APIFY_REQUEST_FAILED");

  const items = await response.json();
  const profile = Array.isArray(items)
    ? items.find((item) => clean(item?.username) === username) || items[0]
    : null;
  const imageUrl = profile?.profilePicUrlHD || profile?.profilePicUrl;
  if (!imageUrl) throw new Error("APIFY_IMAGE_NOT_FOUND");
  const image = await downloadImage(imageUrl);
  if (!image) throw new Error("APIFY_IMAGE_DOWNLOAD_FAILED");
  return image;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const username = clean(req.query?.username);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(400).json({ error: "Usuário do Instagram inválido" });
  }

  const token = String(process.env.APIFY_TOKEN || "").trim();
  if (!token) {
    return res.status(503).json({ error: "APIFY_TOKEN não está configurado no ambiente Preview da Vercel." });
  }

  try {
    const image = await getApifyImage(username, token);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Content-Length", String(image.buffer.length));
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("X-Avatar-Source", "apify");
    return res.status(200).send(image.buffer);
  } catch (error) {
    console.error("apify_avatar_failed", { name: error?.name || "Error" });
    return res.status(error?.name === "TimeoutError" ? 504 : 502).json({
      error: error?.name === "TimeoutError" ? "A consulta da foto expirou. Tente novamente." : "Não foi possível consultar a foto pela Apify.",
    });
  }
}
