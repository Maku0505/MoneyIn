# MoneyIn

A web app for splitting shared expenses with friends — built to run as a static site on GitHub Pages. Track group expenses, compute who-owes-whom balances, get suggested settlements, and scan receipts with AI.

This is a static-site sibling to a Flutter app called DivAid: same core ideas (groups, expenses, balances, settlements), adapted for a serverless, GitHub-Pages-friendly stack since there's no backend to run Cloud Functions on.

## What's different from a server-backed app

GitHub Pages only serves static files — there's no server to run privileged code. That means:

- **Balance computation happens in the browser**, computed live from each group's expense list, instead of via a Cloud Function trigger.
- **Receipt scanning calls Google Gemini directly from the browser.** Your API key will be visible in the page's network requests and source. See the warning in `js/firebase-config.js` — restrict the key's permissions in Google AI Studio before using this beyond personal/low-traffic use.
- **No real wallet or payments.** "Settle up" records a debt as cleared (an expense of type `Payment`), the same way DivAid's "mark as paid outside the app" works — no money actually moves. There's no Stripe integration here.
- **No push notifications.** In-app notifications still work (stored in Firestore), but there's no Cloud Messaging since that also requires a server component.
- **Friend/group notifications are written directly by the client** that triggers them (e.g., the sender writes a notification doc into the receiver's subcollection), instead of via a Firestore trigger. The included security rules allow this.

## Setup

### 1. Firebase project

You said you already have a Firebase project ready. You need:

- **Authentication** → enable **Email/Password** and **Google** sign-in providers.
- **Firestore Database** → create it in production mode.
- Copy your **Firebase config** from Project Settings → General → Your apps → SDK setup and configuration (Web app — create one if you haven't).

Paste that config into `js/firebase-config.js`, replacing the `YOUR_...` placeholders.

### 2. Firestore security rules

Copy the contents of `firestore.rules` into **Firestore Database → Rules** in the Firebase console (or deploy via the Firebase CLI if you use one). These rules:

- Let any signed-in user read other users' basic profiles (needed to look someone up by email).
- Scope groups and expenses to group members only.
- Allow writing a notification into someone else's `notifications` subcollection — necessary since there's no server to do this on their behalf.

### 3. Gemini API key (for receipt scanning)

1. Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Paste it into `GEMINI_API_KEY` in `js/firebase-config.js`.
3. **Restrict the key** in AI Studio / Google Cloud Console to the Generative Language API, and consider an HTTP referrer restriction limited to your GitHub Pages domain (`https://yourusername.github.io/*`) so it's harder for others to reuse if they find it in your page source.

If you'd rather not expose a key publicly, skip this step — the rest of the app works fine without it; the "Scan a receipt" button will just show a friendly error.

### 4. Deploy to GitHub Pages

```bash
# from inside the moneyin/ folder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Then in your repo: **Settings → Pages → Source: Deploy from a branch → Branch: main, folder: / (root)**.

Your app will be live at `https://<your-username>.github.io/<your-repo>/`.

> Add that exact URL (and `http://localhost:PORT` if you test locally) to **Firebase Console → Authentication → Settings → Authorized domains**, or sign-in will fail.

### 5. Local testing

Since this uses ES modules (`type="module"`), you can't just open `index.html` directly from disk (`file://` URLs block module imports). Serve it locally instead:

```bash
cd moneyin
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
moneyin/
├── index.html              All views, sheets, and modals (single page app)
├── css/
│   ├── base.css             Design tokens, resets, type
│   ├── components.css        Buttons, fields, ledger rows, chips, sheets
│   └── layout.css             App shell, topbar, view containers
├── js/
│   ├── firebase-config.js      Your Firebase + Gemini config (edit this)
│   ├── auth.js                  Sign up / sign in / Google / password reset
│   ├── data.js                   Firestore reads & writes (users, groups, expenses…)
│   ├── settlement.js              Balance computation + debt-simplification algorithm
│   ├── receipt-scan.js             Gemini vision call for receipt parsing
│   ├── ui.js                        Toasts, sheets, ledger-row rendering helpers
│   └── app.js                        Orchestration: wires everything together
└── firestore.rules           Paste into Firebase Console → Firestore → Rules
```

## Data model

Same shape as DivAid's Firestore structure:

- `users/{uid}` — profile, friends[], starredFriends[], starredGroups[]
- `groups/{groupId}` — name, type, members[]
  - `groups/{groupId}/expenses/{expenseId}` — paidBy map, splitBetween map; settlements are expenses with `type: "Payment"`
- `friend_requests/{id}` — pending contact requests
- `group_invites/{id}` — pending group invitations
- `users/{uid}/notifications/{id}` — in-app notifications

Balances are never stored — they're computed client-side from the expense list each time a group is opened, the same derived-data principle DivAid uses server-side.

## Known limitations (by design, for a static-hosted app)

- No real payments/wallet — settling just marks a debt as cleared.
- No push notifications — only in-app.
- No multi-currency support (single currency, EUR by default — change the `€` symbols in `ui.js`/`index.html` if you want a different one).
- Gemini API key is exposed client-side; restrict it as described above.
