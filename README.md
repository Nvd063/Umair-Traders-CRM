# Umair Traders — Billing CRM

Netlify-ready Vite + Firebase web application.

## Setup

1. Install Node.js 20.19+ (or compatible version) and run `npm install`.
2. Copy `.env.example` to `.env` and fill in the Firebase Web App config values.
3. Firebase Console → Authentication → Sign-in method → enable Email/Password.
4. Authentication → Users → Add user (no public signup UI exists).
5. Firestore → Create database in **production mode**.
6. Firestore → Rules: paste `firestore.rules` and publish.
7. In Firestore create collection `authorizedUsers` and a document with **document ID equal to the Firebase Authentication user's UID**. Add a field `role` (string) with value `admin`. This step is essential: without it, access is denied.
8. Run `npm run dev` for local testing.
9. Run `npm run build`; deploy `dist` to Netlify or connect repository and use `netlify.toml`.
10. Netlify → Site configuration → Environment variables: set all `VITE_FIREBASE_*` values, then redeploy. Add your Netlify domain in Firebase Authentication → Settings → Authorized domains if required by your authentication flow.

## Notes

- Do not upload `.env` or service account private keys to a public repository. Firebase web config is not a secret, but all Firestore data must be protected by rules.
- `authorizedUsers` documents are provisioned manually by the Firebase project administrator; users cannot grant themselves access.
- Invoice numbers use a Firestore transaction, `counters/invoices`.
- Logo and stamp images are under `public/assets/`; compact letterhead and stamp are implemented in CSS.
- PDF export renders A4 via html2canvas/jsPDF. For large multi-page invoices, test print pagination before production. A future upgrade should use page-aware pagination rather than splitting rows across pages.
- Firestore Spark free tier has usage limits; review quotas as usage grows.
- This is a functional initial release. Before client handover, validate tax treatment, numbering policy, authorization roles, backups, and invoice legal requirements.
