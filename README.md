## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Configure the variables from `.env.example` in `.env.local`. Keep `INSFORGE_API_KEY` server-only; never give it a `NEXT_PUBLIC_` prefix or commit its value.

Firebase browser configuration belongs in the `NEXT_PUBLIC_FIREBASE_*` entries in `.env.local` and the hosting environment. `lib/firebase.ts` initializes the Firebase app once, and `components/firebase-analytics.tsx` loads Analytics only in supported browsers. Firebase web config is client-visible; do not put private service-account credentials in these variables.

The admin account identified by `ADMIN_EMAIL` can open `/admin` to review M-Pesa payment requests. The user selects Basic (KES 200/month) or Advanced (KES 900/month), sends that exact amount via M-Pesa Send Money to 0117581499 (Akai Loputo), then enters the transaction code from their M-Pesa confirmation message. The admin checks the code and amount against the payment received using M-Pesa on a phone or laptop. Payments are not automatically processed or verified: after checking, the admin either activates the requested plan directly or generates a one-time access code and sends it to the user manually. Codes are bound to the requesting account, expire after 30 days, and can only be redeemed once. Applying the transaction code in the app does not charge a user or automatically grant access. Apply `migrations/20261006082400_manual-payment-activation.sql` before deploying this workflow. Admins can also continue to grant or revoke access from the user list. Configure the same admin email as `NEXT_PUBLIC_ADMIN_EMAIL` to show the admin link in the app sidebar.

The admin dashboard also requires `ADMIN_PAGE_PASSWORD` (at least 12 characters) after the verified admin account signs in. Set `ADMIN_SESSION_SECRET` to a separate random secret of at least 32 bytes; for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Three incorrect password attempts from the same IP within 15 minutes block that IP for 24 hours. Attempt records store only a keyed hash of the IP. A successful password opens an HTTP-only, same-site session for 8 hours. Apply `migrations/20261006084001_admin-password-ip-lockout.sql` before deploying the password gate. Configure the hosting proxy to overwrite trusted client IP headers (`x-real-ip` or the rightmost `x-forwarded-for` value); lockout depends on accurate IP forwarding.

The admin dashboard reports app-observed Gemini request and token usage, document/upload balances, request instructions, and generated document titles. These are usage figures recorded by this app, not Google account-level quota or billing balances. Communities are available to active Advanced plan owners; invites are email-bound and verified accounts are required. Community documents are private unless explicitly shared into that community.

Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin in production so community invitation links use the intended host. For production, set the other environment variables in the hosting provider as well. Apply database schema updates through InsForge migrations before deploying code that depends on them.
