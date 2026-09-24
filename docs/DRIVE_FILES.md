# Project files and backups in Google Drive — setup

Every project in the portal has a **Files and photos** list and, for owners and
managers, **Backups**. The files and backups are kept in Google Drive, in a
shared drive you control. This page sets that up once. It takes about ten
minutes.

## How it works

- The website never talks to Google Drive. The Cloud Functions do, signed in as
  the Firebase project's own **service account**. There is **no key file**: the
  functions get their Google identity from where they run, so there is nothing
  to download, commit or leak. Do not create a service-account key for this.
- Each project gets a folder named `<project name> (<project id>)` inside the
  shared drive, with a `Files` and a `Backups` folder inside it.
- Team members never need a Google account or Drive access. They see a
  project's files only through the portal, and only for projects they belong to.
- Firestore keeps the list of files (who added what, when). Only the functions
  can write that list.

## What you need

- A **Google Workspace** account with **shared drives** (Business Starter or
  higher). A service account has no storage of its own, so the files must go in
  a shared drive. A folder in someone's personal "My Drive" will not work.
- The Firebase project on the **Blaze** plan (already needed for the other
  functions).

## Steps

1. **Turn on the Drive API.** Open
   <https://console.cloud.google.com/apis/library/drive.googleapis.com>, pick the
   Firebase project (for example `duck-hse-portal`) at the top, and click
   **Enable**.

2. **Find the functions' account.** It is
   `<your-project-id>@appspot.gserviceaccount.com`, for example
   `duck-hse-portal@appspot.gserviceaccount.com`. You can check it in Google Cloud
   Console → **IAM & Admin → Service accounts** ("App Engine default service
   account").

3. **Make it a member of the shared drive.** In Google Drive, open the shared
   drive → **Manage members** → add that email address as **Content manager**
   (it needs to create folders, add files and move old backups to the trash).
   If Drive says the address is outside your organisation and cannot be added,
   ask your Workspace admin to allow people outside the organisation to be
   members of shared drives (Admin console → Apps → Google Workspace → Drive
   and Docs → Sharing settings).

4. **Copy the shared drive's ID.** Open the shared drive in the browser. The
   address looks like `https://drive.google.com/drive/folders/0AB...xyz`; the ID
   is the last part. You can also use a folder inside the shared drive.

5. **Put the ID in the functions settings.** In `functions/.env` (copy
   `functions/.env.example` if you have not made it yet):

   ```
   DRIVE_ROOT_FOLDER_ID=0AB...xyz
   DRIVE_PROJECT_QUOTA_MB=2048
   ```

   `DRIVE_PROJECT_QUOTA_MB` is the file space each project may use (2 GB unless
   you change it). These are settings, not secrets; `functions/.env` is not
   committed to the repository.

6. **Deploy the functions and rules:**

   ```
   firebase deploy --only functions,firestore:rules
   ```

   The nightly backup is a scheduled function. The first time, the Firebase CLI
   may ask to turn on Cloud Scheduler; answer yes.

7. **Check it.** Sign in, open a project, click **+ Add files** and add a small
   PDF. It should appear in the list, and in Drive under
   `<project name> (<id>)/Files`. As an owner, click **Back up now**; a `.json`
   file appears under `Backups`.

## Limits and housekeeping

- **7 MB per file.** Files go through a Cloud Function, whose requests are capped
  at 10 MB. Photos over 2 MB are made smaller on the phone or computer before
  upload. For a bigger document, save a compressed PDF.
- **Allowed types:** PDF; photos (JPG, PNG, WebP, GIF, HEIC); Word, Excel,
  PowerPoint and OpenDocument files; Outlook `.msg` and `.eml` emails; RTF, CSV
  and text; DWG and DXF drawings. Web pages, scripts, programs and archives are
  refused.
- **Deleting a file** moves it to the shared drive's trash, where a drive manager
  can still recover it for 30 days.
- **Backups** run every night at 02:00 UAE time for each project that changed.
  Each project keeps its 30 newest nightly backups, 20 manual ones and 10 made
  just before a restore; older ones go to the trash automatically.
- **Restore items** puts a project's tracked items back as they were in a
  backup. It does not change the team, files or activity log, and it makes a
  backup of the current state first so it can be undone.
- Keep the shared drive's membership small: anyone who is a member can see every
  customer's project files in Drive directly.

## If something goes wrong

The message in the app says what to check first. For more detail, open Firebase
Console → **Functions → Logs**.

| What you see | Likely cause |
|---|---|
| "File storage is not set up yet" | `DRIVE_ROOT_FOLDER_ID` is empty, or the functions were not deployed after setting it. |
| "Google Drive could not be reached", and the log shows 403 or "insufficient permissions" | The functions' account is not a member of the shared drive, or is only a Viewer or Commenter. |
| The same, and the log shows 404 "File not found" | The ID in `DRIVE_ROOT_FOLDER_ID` is wrong, or the account cannot see that drive. |
| The same, and the log shows "storage quota" | The ID points to a folder in someone's My Drive. Use a shared drive. |
| The same, and the log shows the Drive API "has not been used or is disabled" | Step 1 was skipped. |
| "This project has used … of its … of file space" | The project reached `DRIVE_PROJECT_QUOTA_MB`. Delete old files or raise the limit. |
