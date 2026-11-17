# Signed release APKs — what is ready and what only the owner can do

**Ready (in `dtpos.apk`, built and tried on GitHub Actions since v1.109.0):** one workflow builds Owner, Rider and Order Taker in one run.
With *release* ticked it signs them with the restaurant group’s permanent key; with *publish_release* ticked it puts the three signed
APKs on a GitHub Release page with a direct download link to hand to staff. The exact steps are in `dtpos.apk/docs/BUILD-ALL.md`
(“Jo APK aap staff ko dein — signed release”). Debug builds are signed with a throw-away key, so a newer build cannot be installed over
an older one (“App not installed — conflicts with an existing package”); a release build can.

**Only the owner can do (cannot be done by anyone else, and was not done here):**

1. Make the key **once** on their own computer (`keytool -genkeypair …` — the command is in BUILD-ALL.md). The key file and its two passwords
   are the identity of the apps: whoever holds them can publish updates as the company, and if they are lost no installed app can ever be
   updated again. They are therefore never created on a build machine, never sent in a chat, never committed.
2. Add the four GitHub secrets to the `dtpos.apk` repository: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`.
3. Run the workflow with *release* and *publish_release* ticked, then install from the Release page.
4. Keep an offline backup of the key file (a USB stick in a drawer is enough; two copies is better).

**Order to do it in:** first run the real-phone test sheet (`docs/qa/2026-11-17-phone-test-sheet-v1.115.0.md`) on the debug build, fix what it
finds, and only then make the signed release — an app handed to staff with a permanent key should already have passed the sheet.
