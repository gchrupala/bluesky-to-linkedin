// Reposts new Bluesky posts to LinkedIn. Meant to run on a schedule.
//
// Environment variables:
//   BLUESKY_HANDLE         Bluesky account to read, e.g. alice.bsky.social
//   LINKEDIN_ACCESS_TOKEN  LinkedIn token with the w_member_social scope
//   MAX_AGE_HOURS          Skip posts older than this (default 72)
//   MIN_AGE_MINUTES        Wait until a post is this old before reposting it,
//                          so that a thread is complete (default 15)
//   DRY_RUN                If "true", print what would be posted and post nothing
//
// A thread is reposted as one post. state.json records which Bluesky posts
// have been handled. On the first run it is created from the current feed and
// nothing is posted.

import { readFile, writeFile } from "node:fs/promises";
import { LinkedInStrategy } from "@humanwhocodes/crosspost";
import { convertThread } from "./convert.js";

const FEED_URL = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const THREAD_URL = "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread";
const STATE_FILE = new URL("./state.json", import.meta.url);
const SEEN_LIMIT = 200;

const handle = requireEnv("BLUESKY_HANDLE");
const maxAgeHours = Number(process.env.MAX_AGE_HOURS || 72);
const minAgeMinutes = Number(process.env.MIN_AGE_MINUTES || 15);
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

// The account's own top-level posts, oldest first. Replies and reposts of
// other people's posts are left out.
async function fetchPosts() {
  const url = new URL(FEED_URL);
  url.searchParams.set("actor", handle);
  url.searchParams.set("filter", "posts_no_replies");
  url.searchParams.set("limit", "30");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bluesky: ${response.status} ${await response.text()}`);
  }
  const { feed } = await response.json();
  return feed
    .filter((item) => !item.reason)
    .map((item) => item.post)
    .sort((a, b) => Date.parse(a.indexedAt) - Date.parse(b.indexedAt));
}

// The post followed by the replies with which its author continued it.
async function fetchThread(post) {
  const url = new URL(THREAD_URL);
  url.searchParams.set("uri", post.uri);
  url.searchParams.set("depth", "100");
  url.searchParams.set("parentHeight", "0");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bluesky: ${response.status} ${await response.text()}`);
  }
  const posts = [];
  let node = (await response.json()).thread;
  while (node?.post) {
    posts.push(node.post);
    node = (node.replies ?? [])
      .filter((reply) => reply.post?.author.did === post.author.did)
      .sort((a, b) => Date.parse(a.post.indexedAt) - Date.parse(b.post.indexedAt))[0];
  }
  return posts;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveState(seen) {
  const state = { seen: [...seen].slice(-SEEN_LIMIT) };
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image download: ${response.status} ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const posts = await fetchPosts();
  const state = await loadState();
  if (!state) {
    if (dryRun) {
      console.log("No state.json yet. A real run would only record the existing posts.");
      return;
    }
    await saveState(posts.map((post) => post.uri));
    console.log(`First run: marked ${posts.length} existing posts as handled.`);
    return;
  }

  const seen = new Set(state.seen);
  const oldest = Date.now() - maxAgeHours * 3600 * 1000;
  const newest = Date.now() - minAgeMinutes * 60 * 1000;
  const linkedin = dryRun
    ? null
    : new LinkedInStrategy({ accessToken: requireEnv("LINKEDIN_ACCESS_TOKEN") });

  for (const post of posts) {
    if (seen.has(post.uri)) {
      continue;
    }
    const time = Date.parse(post.indexedAt);
    if (time > newest) {
      console.log(`Waiting with ${post.uri} in case it becomes a thread`);
      continue;
    }
    if (time < oldest) {
      console.log(`Skipping old post ${post.uri}`);
    } else {
      const thread = await fetchThread(post);
      const { text, images } = convertThread(thread);
      if (dryRun) {
        console.log(
          `Would post ${post.uri} (${thread.length} post(s), ${images.length} image(s)):\n${text}\n`,
        );
        continue;
      }
      const imageData = await Promise.all(
        images.map(async (image) => ({ data: await download(image.url), alt: image.alt })),
      );
      try {
        const response = await linkedin.post(text, { images: imageData });
        console.log(`Posted ${post.uri} as ${linkedin.getUrlFromResponse(response)}`);
      } catch (error) {
        if (!/duplicate/i.test(error.message)) {
          throw error;
        }
        console.log(`LinkedIn already has ${post.uri}`);
      }
    }
    seen.add(post.uri);
    // Save after each post, so a later failure does not cause reposts.
    if (!dryRun) {
      await saveState(seen);
    }
  }
}

await main();
