## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Configure the variables from `.env.example` in `.env.local`. Keep `INSFORGE_API_KEY` server-only; never give it a `NEXT_PUBLIC_` prefix or commit its value.

The admin account identified by `ADMIN_EMAIL` can open `/admin` to manually grant or revoke plan access after confirming payment. A grant adds one calendar month. Basic is KES 200/month (25 generated documents and 5 uploads); Advanced is KES 900/month (50 longer, detailed Word documents, 15 uploads, and a five-person community including its owner). Users pay via M-Pesa Send Money to 0117581499 (Akai Loputo). The app locks generation and uploads until the administrator confirms payment and activates a plan; payments are not automatically processed or verified. Configure the same admin email as `NEXT_PUBLIC_ADMIN_EMAIL` to show the admin link in the app sidebar.

The admin dashboard reports app-observed Gemini request and token usage, document/upload balances, request instructions, and generated document titles. These are usage figures recorded by this app, not Google account-level quota or billing balances. Communities are available to active Advanced plan owners; invites are email-bound and verified accounts are required. Community documents are private unless explicitly shared into that community.

Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin in production so community invitation links use the intended host. For production, set the other environment variables in the hosting provider as well. Apply database schema updates through InsForge migrations before deploying code that depends on them.
