import { test } from "node:test";
import assert from "node:assert/strict";
import { convertText, convertThread, escapeLittle } from "./convert.js";

// Facet indices count UTF-8 bytes, so build them from the text.
function facet(text, segment, feature) {
  const start = Buffer.from(text.slice(0, text.indexOf(segment))).length;
  return {
    index: { byteStart: start, byteEnd: start + Buffer.from(segment).length },
    features: [feature],
  };
}

const author = { handle: "alice.bsky.social" };
const uri = "at://did:plc:abc/app.bsky.feed.post/3kxyz";

test("escapes reserved characters", () => {
  assert.equal(escapeLittle("a (b) #c @d_e"), "a \\(b\\) \\#c \\@d\\_e");
});

test("expands shortened links and converts hashtags", () => {
  const text = "Zażółć 🎉 see example.com/very-lo... #NLProc";
  const record = {
    text,
    facets: [
      facet(text, "#NLProc", { $type: "app.bsky.richtext.facet#tag", tag: "NLProc" }),
      facet(text, "example.com/very-lo...", {
        $type: "app.bsky.richtext.facet#link",
        uri: "https://example.com/very-long-path",
      }),
    ],
  };
  assert.equal(
    convertText(record),
    "Zażółć 🎉 see https://example.com/very-long-path {hashtag|\\#|NLProc}",
  );
});

test("adds images, link cards and quoted posts", () => {
  const post = {
    uri,
    author,
    record: { text: "Look" },
    embed: {
      $type: "app.bsky.embed.recordWithMedia#view",
      media: {
        $type: "app.bsky.embed.images#view",
        images: [{ fullsize: "https://cdn.example/1.jpg", alt: "A cat" }],
      },
      record: {
        record: {
          $type: "app.bsky.embed.record#viewRecord",
          uri: "at://did:plc:def/app.bsky.feed.post/3kabc",
          author: { handle: "bob.bsky.social" },
        },
      },
    },
  };
  assert.deepEqual(convertThread([post]), {
    text: "Look\n\nhttps://bsky.app/profile/bob.bsky.social/post/3kabc",
    images: [{ url: "https://cdn.example/1.jpg", alt: "A cat" }],
  });

  const card = {
    uri,
    author,
    record: { text: "" },
    embed: {
      $type: "app.bsky.embed.external#view",
      external: { uri: "https://example.org/a_b" },
    },
  };
  assert.equal(convertThread([card]).text, "https://example.org/a\\_b");
});

test("image-only posts get a link to the Bluesky post", () => {
  const post = {
    uri,
    author,
    record: { text: "" },
    embed: { $type: "app.bsky.embed.images#view", images: [{ fullsize: "x", alt: "" }] },
  };
  assert.equal(convertThread([post]).text, "https://bsky.app/profile/alice.bsky.social/post/3kxyz");
});

test("joins a thread into one post", () => {
  const thread = ["3ka", "3kb", "3kc"].map((rkey, i) => ({
    uri: `at://did:plc:abc/app.bsky.feed.post/${rkey}`,
    author,
    record: { text: i === 1 ? "" : `Part ${i + 1}` },
    embed:
      i === 1
        ? { $type: "app.bsky.embed.images#view", images: [{ fullsize: "y", alt: "B" }] }
        : undefined,
  }));
  assert.deepEqual(convertThread(thread), {
    text: "Part 1\n\nPart 3",
    images: [{ url: "y", alt: "B" }],
  });
});

test("cuts a thread that is too long for LinkedIn", () => {
  const thread = Array.from({ length: 15 }, (_, i) => ({
    uri: `at://did:plc:abc/app.bsky.feed.post/3k${i}`,
    author,
    record: { text: String(i).padEnd(290, "x") },
  }));
  const { text } = convertThread(thread);
  assert.ok(text.length <= 3000);
  assert.ok(text.includes("\n\n9xxx"));
  assert.ok(!text.includes("10xxx"));
  assert.ok(
    text.endsWith("Continued on Bluesky: https://bsky.app/profile/alice.bsky.social/post/3k0"),
  );
});
