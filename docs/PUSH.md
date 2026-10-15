# Push notifications

The rules table has stored a `push` channel since the notifications step and the
sender ignored it, by decision, until 2026-09-09. This is that step.

## What it needs from you

A VAPID key pair in `.env`. Generate one:

```
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Until both are set, Settings >
Notifications says push is not configured and the sender skips it. Nothing else
changes: email and the alert centre are unaffected, and a rule set to push alone
is still recorded.

Changing the keys invalidates every subscribed device, which then has to press
the button again.

## How it works

`public/sw.js` is the service worker. It caches nothing and intercepts no
fetches, so it cannot serve a stale page: offline support is a separate decision
nobody has taken. It exists because a notification cannot be delivered to a page
that is closed, and a service worker is the only thing a browser will wake.

Settings > Notifications has a Devices card. Pressing the button asks the
browser for permission, registers the worker, subscribes, and posts the
browser's own keys to a server action. One row per browser: the same person on a
laptop and a phone is two subscriptions that expire independently.

The sender pushes once per send, not once per item, for the same reason the
digest is one email. The push leads with the most urgent item and counts the
rest, because a lock screen notification listing six things is one nobody reads.

## What it will not do

Push only fires when a rule that raised something asks for it. A notification
with no rule behind it is raised by a job rather than chosen by the owner, and
pushing those would make the one channel nobody can ignore the one channel
nobody chose.

Quiet hours still apply: `pending()` gates the whole send, so a push cannot
arrive at 3am that an email would not have.

A subscription the push service reports as gone (404 or 410) is deleted on the
next send rather than retried forever. Any other failure is counted and left
alone, because a push service having a bad minute is not a reason to lose a
device.

## Why enabling failed

Diagnosed 2026-09-14 (v1.1 Phase 1), in the plan's order, on a Mac against
production.

(a) Uncookied, `GET /sw.js` answers `307 -> /login` (curl, 02:32 UTC): the
auth proxy matcher excludes `icons/` and the manifest but not `sw.js`. This is
not what broke enabling. Signed in, the same fetch is `200` then `304`
(Vercel runtime log, 03:06 UTC), so the worker registers and the matcher is
left alone. A browser fetching the script for an update with an expired
session gets the 307 and keeps the worker it has, which is the right outcome.

Before that, the first press on the desktop toasted "The browser refused.
Notifications are blocked for this site.": `Notification.requestPermission()`
returned `denied` because Chrome held a Block for the site from an earlier
dismissed prompt. Site settings > Notifications > Allow cleared it. That is a
per-browser setting, not something the app can change.

(b) The second press toasted `Failed to execute 'atob' on 'Window': The
string to be decoded is not correctly encoded.` That is
`urlBase64ToUint8Array(vapidPublicKey)` in `Devices.tsx`, so the value of
`VAPID_PUBLIC_KEY` in Vercel Production is not base64url. A key from
`web-push` is 87 characters of `A-Z a-z 0-9 - _` and nothing else; a pasted
quote, a trailing newline or a space breaks `atob`. This is the cause on both
devices at once: every browser reads the same key.

Fix, done 2026-09-14: Vercel does not reveal a sensitive variable once saved,
so the pair was generated again with `web-push`, both values set again in
Production with `vercel env rm` and `vercel env add` (no quotes, the public key
87 characters, the private 43), and the site redeployed. The next press
toasted "This device will get push now." Rotating the pair invalidates any
device that had subscribed, which was none. Do the phone next: it needs the
app installed to the home screen first (below).

(c) and (d) were not needed.

## On an iPhone

Safari only offers push to an installed PWA, so the app has to be added to the
home screen first. The card says so rather than showing a button that cannot
work.
