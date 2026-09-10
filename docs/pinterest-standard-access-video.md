# Pinterest Standard Access Demo

## Goal

Record a concise 90-second demonstration proving that the application:

- Uses Pinterest OAuth authorization.
- Requests only the scopes needed for board and Pin management.
- Stores credentials server-side and does not expose secrets in the browser.
- Creates a real Sandbox Pin from an Etsy listing.
- Lets the user review the result on Pinterest.

## Before Recording

1. Use a 1920x1080 browser window at 100% zoom.
2. Close unrelated tabs and disable desktop notifications.
3. Sign in to the application and Pinterest before recording.
4. Keep Pinterest set to `Production` initially so the OAuth connection uses the registered production callback.
5. Confirm that the Sandbox token and Sandbox board are already saved.
6. If Pinterest skips its authorization screen, revoke the existing app authorization from Pinterest and reconnect before recording.
7. Never reveal the app secret, access tokens, Etsy credentials, or OpenAI key.

## Recording Plan

### 0:00-0:10 - Product and purpose

Open `https://etsy-pinterest.vercel.app/` and briefly show the public product page and navigation.

Narration:

> This is TheCozyCedar Social Automation, an owner-operated web application that imports Etsy listings and prepares them for controlled publishing to Pinterest and Instagram.

### 0:10-0:35 - Pinterest OAuth

Open Settings, scroll to Pinterest, and click `Reconnect Pinterest`. Show the Pinterest authorization page, the requested permissions, and approve the connection. Show the redirect back to the application's Settings page and the `Production connected` status.

Narration:

> Pinterest is connected through the OAuth 2.0 authorization code flow. The user is redirected to Pinterest, reviews the requested board and Pin permissions, and explicitly authorizes access. The callback exchanges the authorization code server-side. Pinterest credentials are not exposed in the browser.

### 0:35-0:50 - User controls

Show the Pinterest enable switch, environment selector, board selector, queue limits, and board mapping section. Do not edit unrelated service settings.

Narration:

> The authenticated user controls whether Pinterest publishing is enabled, selects the destination boards, and can review queued items before publication. Settings and tokens are stored per user in the database.

### 0:50-1:10 - Live Sandbox action

Select `Sandbox`, save Settings, and click `Publish Sandbox Test Pin`. Show the success message containing the Pin ID. Do not use `Publish Pinterest Now`, because Trial access cannot create production Pins.

Narration:

> For Trial access testing, the application switches to Pinterest's isolated API Sandbox. This action creates one real Sandbox Pin from a pending Etsy listing without consuming or changing the production queue item.

### 1:10-1:30 - Pinterest result

Open the resulting Pin on the Pinterest profile. Show the image, title, destination link, and Sandbox test board. Click `Visit site` only if there is enough time and confirm that it opens the matching Etsy listing.

Narration:

> The Pin is now visible on the authenticated Pinterest account and links to the corresponding Etsy product. This completes the live Pinterest API action initiated by the authorized user.

## Suggested Upgrade Description

> TheCozyCedar Social Automation is an owner-operated publishing tool that imports Etsy listings, maps products to relevant Pinterest boards, and creates scheduled image Pins after explicit Pinterest OAuth authorization. Users can enable or disable Pinterest, choose boards, review the publishing queue, retry failures, and reconnect or revoke access. Access and refresh tokens are stored securely on the server per authenticated user and are never included in client-side code.

## Requested Scopes

- `boards:read`: List boards available to the authenticated user.
- `boards:write`: Create and manage destination boards.
- `pins:read`: Verify Pins and prevent duplicate publication.
- `pins:write`: Create image Pins selected from the publishing queue.

## Submission Checklist

- The Main URL is `https://etsy-pinterest.vercel.app/`.
- The Privacy Policy is `https://etsy-pinterest.vercel.app/privacy`.
- The video includes the Pinterest authorization screen.
- The video includes the redirect back to the application.
- The video includes a successful live Sandbox Pin creation.
- No passwords, app secrets, access tokens, or API keys are visible.
- The video is uploaded directly in the Standard access upgrade form.
