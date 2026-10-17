const clean = (v) => String(v || "").trim().replace(/^@+/, "").toLowerCase();
const avatarPath = (username) => `/api/instagram/avatar?username=${encodeURIComponent(username)}`;
const validUsername = (username) => /^[a-z0-9._]{1,30}$/.test(username);

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeProfile(item, requestedUsername) {
  const username = clean(firstValue(item?.username, item?.userName, item?.ownerUsername, requestedUsername));
  const picture = firstValue(item?.profilePicUrlHD, item?.profilePicUrl, item?.profile_pic_url, item?.profilePictureUrl, "");
  const relatedRaw = firstValue(item?.relatedProfiles, item?.related_profiles, item?.related, []);
  const related = Array.isArray(relatedRaw) ? relatedRaw.map((profile) => {
    const relatedUsername = clean(firstValue(profile?.username, profile?.userName, profile?.ownerUsername));
    return {
      ...profile,
      username: relatedUsername,
      profilePic: relatedUsername ? avatarPath(relatedUsername) : firstValue(profile?.profilePic, profile?.profilePicUrlHD, profile?.profilePicUrl, ""),
    };
  }) : [];

  return {
    username,
    fullName: String(firstValue(item?.fullName, item?.full_name, item?.name, "") || ""),
    profilePic: picture ? avatarPath(username) : "",
    followers: Number(firstValue(item?.followersCount, item?.followers, item?.followerCount, item?.follower_count, 0)) || 0,
    following: Number(firstValue(item?.followsCount, item?.following, item?.followingCount, item?.following_count, 0)) || 0,
    posts: Number(firstValue(item?.postsCount, item?.posts, item?.mediaCount, item?.media_count, 0)) || 0,
    biography: String(firstValue(item?.biography, item?.bio, "") || ""),
    isVerified: Boolean(firstValue(item?.verified, item?.isVerified, item?.is_verified, false)),
    isPrivate: Boolean(firstValue(item?.private, item?.isPrivate, item?.is_private, false)),
    isBusiness: Boolean(firstValue(item?.isBusinessAccount, item?.isBusiness, item?.is_business, false)),
    related,
  };
}

async function fetchApifyProfile(username) {
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
  actorUrl.searchParams.set("limit", "1");
  actorUrl.searchParams.set("timeout", "45");

  const response = await fetch(actorUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ usernames: [username], includeAboutSection: false }),
    signal: AbortSignal.timeout(55000),
  });

  if (!response.ok) {
    const error = new Error("A Apify não conseguiu consultar esse perfil.");
    error.statusCode = response.status === 408 ? 504 : response.status === 401 || response.status === 403 ? 502 : 502;
    throw error;
  }

  const items = await response.json();
  const item = Array.isArray(items)
    ? items.find((candidate) => clean(candidate?.username) === username) || items[0]
    : null;

  if (!item || !clean(firstValue(item?.username, item?.userName, item?.ownerUsername))) {
    const error = new Error("Perfil não encontrado ou não retornado pela Apify.");
    error.statusCode = 404;
    throw error;
  }

  return normalizeProfile(item, username);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const username = clean(req.query?.username);
  if (!validUsername(username)) {
    return res.status(400).json({ error: "Usuário do Instagram inválido" });
  }

  try {
    const profile = await fetchApifyProfile(username);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ profile });
  } catch (error) {
    console.error("apify_profile_lookup_failed", { username, name: error?.name || "Error" });
    const status = Number(error?.statusCode) || (error?.name === "TimeoutError" ? 504 : 502);
    return res.status(status).json({
      error: error?.message || "Não foi possível consultar o perfil pela Apify.",
    });
  }
}
