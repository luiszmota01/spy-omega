// Isolated test endpoint: fetches one fresh Apify-returned avatar URL.
// This file exists only on test/apify-profile-photo; it is not a production integration.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const imageUrl = "https://scontent-mad1-1.cdninstagram.com/v/t51.2885-19/573323465_1219825463302212_7278921664109726296_n.png?stp=dst-jpg_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xNTAuY2FuYXJ5In0&_nc_ht=scontent-mad1-1.cdninstagram.com&_nc_cat=1&_nc_oc=Q6cZ2gGUagUXka9_zn7U_Im_30ie2Fi880xkr3d9bm5xtkNOvIOgA6W2Dahsaw_wj3DUyqs&_nc_ohc=b_KO3oTOfGAQ7kNvwFTP4sR&_nc_gid=7V2QGNdW6nOI4KP4351o5Q&edm=AL4D0a4BAAAA&ccb=7-5&ig_cache_key=YW5vbnltb3VzX3Byb2ZpbGVfcGlj.3-ccb7-5&oh=00_AQMbGFvqrPp8KEE7kOynSjeWLV-NECcL0LdqFSwjPsC0mA&oe=6AD98EAA&_nc_sid=9e8221";

  try {
    const upstream = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: "Image source rejected the request", upstreamStatus: upstream.status });
    }
    const type = upstream.headers.get("content-type") || "";
    if (!type.startsWith("image/")) {
      return res.status(502).json({ error: "Upstream did not return an image", contentType: type });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
      return res.status(502).json({ error: "Image size outside test limits" });
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Image-Test", "apify-upstream-fetch-ok");
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(502).json({ error: "Could not fetch the Apify image URL", reason: error?.name || "fetch_error" });
  }
}