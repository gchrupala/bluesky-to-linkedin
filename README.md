# bluesky-to-linkedin

A GitHub Actions workflow that checks a Bluesky account every 30 minutes and reposts new posts to a personal LinkedIn profile.

It uses the public Bluesky API, which needs no login, and the [crosspost](https://github.com/humanwhocodes/crosspost) library for LinkedIn.

## What gets reposted

- Your own posts. Replies to other people, and reposts of other people's posts, are skipped.
- A thread, where you continued a post by replying to yourself, becomes one LinkedIn post. If it is longer than the LinkedIn limit of 3,000 characters, the LinkedIn post ends with a link to the thread on Bluesky.
- Text, with full link URLs and hashtags.
- Images, with their alt text, up to 20 per post.
- Link cards, quoted posts and videos become a link at the end of the post.
- Mentions become plain text, since LinkedIn mentions need a LinkedIn ID.

## Settings

These optional repository variables are set in the same place as `BLUESKY_HANDLE` (see [Setup](#2-configure-the-repository)):

- `MAX_AGE_HOURS` (default 72): posts older than this are not reposted.
- `MIN_AGE_MINUTES` (default 15): a post is reposted only once it is this old, so that a thread is complete by then. Parts of a thread added later are not reposted.

## Setup

### 1. Get a LinkedIn access token

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/apps) and create an app. LinkedIn requires the app to be linked to a LinkedIn Page that you administer.
2. On the **Products** tab, add **Share on LinkedIn** and **Sign in with LinkedIn using OpenID Connect**. Both are approved straight away.
3. In the [token generator](https://www.linkedin.com/developers/tools/oauth/token-generator), choose your app, tick the scopes `openid`, `profile` and `w_member_social`, and copy the token.

The token is valid for 60 days. See [Renewing the token](#renewing-the-token).

### 2. Configure the repository

Under **Settings → Secrets and variables → Actions**:

- Add a **secret** `LINKEDIN_ACCESS_TOKEN` with the token.
- Add a **variable** `BLUESKY_HANDLE` with your handle, e.g. `alice.bsky.social`.

### 3. Run it once by hand

On the **Actions** tab, open **Repost Bluesky to LinkedIn** and click **Run workflow**. The first run posts nothing. It writes the posts already on your Bluesky account to `state.json`, so that only later posts are reposted.

After that the workflow runs on its own. To see what it would post without posting, run it by hand with **Dry run** ticked.

## Renewing the token

LinkedIn does not give self-serve apps a way to renew tokens automatically. When the token expires, the workflow fails and GitHub emails you. Generate a new token as in step 1.3 and replace the secret. Posts from the last 72 hours are then reposted on the next run.

## Notes

- `state.json` records which posts have been handled. The workflow commits it after each run in which it changed.
- GitHub turns off scheduled workflows in public repositories after 60 days without commits. This only happens if you don't post on Bluesky for 60 days. Turn it back on from the **Actions** tab.
- In a private repository, each run uses about one minute of the GitHub Actions allowance, about 1,440 minutes a month. To use fewer, change the schedule in `.github/workflows/crosspost.yml`.
- Posting to a LinkedIn Page instead of a profile needs LinkedIn's Community Management API. LinkedIn approves access to it case by case, and this workflow does not support it.

## Development

```sh
npm install
npm test
BLUESKY_HANDLE=alice.bsky.social DRY_RUN=true npm start
```
