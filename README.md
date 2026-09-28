# Spy Omega — Vercel ready

O ZIP original é um export compilado do Next.js 14. Este pacote preserva a interface e adiciona endpoints Vercel.

Já preparado:
- `/` e `/upsell`
- `/api/instagram?username=...` para dados públicos básicos
- `/api/instagram/feed`
- `/api/payment/create`
- `/api/payment/webhook`

Variáveis:
- `AMPLOPAY_PUBLIC_KEY`
- `AMPLOPAY_SECRET_KEY`
- `GATEWAY_WEBHOOK_TOKEN`

A integração AmploPay não inventa o payload da cobrança: falta confirmar o contrato exato da conta/API antes de enviar dinheiro ou gerar Pix real.
