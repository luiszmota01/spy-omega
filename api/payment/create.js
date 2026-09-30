export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const amount = Number(req.body?.amount);
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const phone = String(req.body?.phone || "").trim();
  const document = String(req.body?.document || "").replace(/\D/g, "");

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Valor inválido." });
  }
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Informe seu e-mail." });
  if (name.length < 2) {
    return res.status(400).json({ error: "Informe seu nome." });
  }
  if (!phone) return res.status(400).json({ error: "Informe seu telefone." });
  if (!document) return res.status(400).json({ error: "Informe seu CPF ou CNPJ." });

  const publicKey = process.env.AMPLOPAY_PUBLIC_KEY;
  const secretKey = process.env.AMPLOPAY_SECRET_KEY;
  if (!publicKey || !secretKey) {
    return res.status(503).json({
      error: "Pagamento ainda não configurado.",
      code: "AMPL0PAY_NOT_CONFIGURED",
    });
  }

  const identifier = `spy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const callbackUrl = publicBaseUrl ? `${publicBaseUrl}/api/payment/webhook` : (host ? `${protocol}://${host}/api/payment/webhook` : undefined);

  const payload = {
    identifier,
    amount: Number(amount.toFixed(2)),
    client: {
      name,
      email,
      phone,
      document,
    },
    products: [{ id: amount === 9.9 ? "spy-omega-special" : "spy-omega", name: amount === 9.9 ? "Spy Omega - Oferta Especial" : "Spy Omega", quantity: 1, price: Number(amount.toFixed(2)), physical: false }],
    metadata: { provider: "Spy Omega", orderId: identifier },
    ...(callbackUrl ? { callbackUrl } : {}),
  };

  try {
    const response = await fetch("https://app.amplopay.com/api/v1/gateway/pix/receive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        error: data?.message || data?.error || "A AmploPay recusou a criação do Pix.",
        details: data?.details ?? data,
      });
    }

    const transactionId = data?.transactionId || data?.transaction?.id || null;
    const pixCode = data?.pix?.code || null;
    const pixImage = data?.pix?.image || null;
    const pixExpiresAt = data?.pix?.expiresAt || null;
    const checkoutUrl = data?.order?.url || data?.checkoutUrl || null;

    return res.status(200).json({
      success: true,
      identifier,
      transactionId,
      status: data?.status || null,
      transactionStatus: data?.transactionStatus || null,
      pix: {
        code: pixCode,
        image: pixImage,
        expiresAt: pixExpiresAt,
      },
      checkout_url: checkoutUrl,
    });
  } catch (error) {
    return res.status(502).json({
      error: "Não foi possível conectar à AmploPay.",
    });
  }
}