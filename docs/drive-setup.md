# Google Drive setup

One-time setup for syncing the library through Google Drive. The app talks
to Drive with the `drive.file` scope, which means it can only see files it
created — the library folder it makes and nothing else in the Drive. The
OAuth client belongs to the owner; the app just carries its id.

## Create the OAuth client

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services → Library**: enable the *Google Drive API*.
3. **APIs & Services → OAuth consent screen**: configure as *External*, add
   yourself as a user, and **publish the app** — tokens issued to apps left
   in "testing" expire after seven days, which breaks the promise that a
   device stays signed in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type *Web application*. Add every origin the app is served from (e.g.
   `https://reader.example.com`, and `http://localhost:4242` for dev) under
   **both** *Authorized JavaScript origins* and, with a trailing `/`,
   *Authorized redirect URIs*.
5. Copy the client id (ends in `.apps.googleusercontent.com`).

## Connect a device

Open the app with `?lib=drive`. The first visit asks for the client id
(stored on the device from then on), then bounces through Google's consent
screen and back. The library lives in a Drive folder named `reader-42`,
created on first write; every device pointed at the same account converges
on it. Tokens last about an hour — expiry repeats the redirect, and the
offline write queue makes the round trip lossless.

To disconnect a device, clear the site's storage (the token and client id
live in localStorage; cached books in IndexedDB and the Cache API).
