// Turns a Bluesky post (as returned by app.bsky.feed.getAuthorFeed) into
// the text and images of a LinkedIn post.

// The LinkedIn Posts API reads the post text in its "little text" format,
// where these characters must be escaped with a backslash. Unescaped, they
// can make LinkedIn cut the post short.
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

export function escapeLittle(text) {
  return text.replace(RESERVED, (c) => "\\" + c);
}

export function postUrl(post) {
  const rkey = post.uri.split("/").pop();
  return `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
}

// Bluesky shortens link text (e.g. "example.com/some-lo...") and keeps the
// full URL in a facet. Facet positions are UTF-8 byte offsets.
export function convertText(record) {
  const bytes = Buffer.from(record.text ?? "", "utf8");
  const facets = [...(record.facets ?? [])].sort(
    (a, b) => a.index.byteStart - b.index.byteStart,
  );
  let out = "";
  let pos = 0;
  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < pos || byteEnd <= byteStart || byteEnd > bytes.length) {
      continue;
    }
    out += escapeLittle(bytes.subarray(pos, byteStart).toString("utf8"));
    out += convertFacet(
      bytes.subarray(byteStart, byteEnd).toString("utf8"),
      facet.features ?? [],
    );
    pos = byteEnd;
  }
  return out + escapeLittle(bytes.subarray(pos).toString("utf8"));
}

function convertFacet(segment, features) {
  const link = features.find((f) => f.$type === "app.bsky.richtext.facet#link");
  if (link) {
    return escapeLittle(link.uri);
  }
  const tag = features.find((f) => f.$type === "app.bsky.richtext.facet#tag");
  const sign = segment[0];
  if (tag && (sign === "#" || sign === "＃")) {
    return `{hashtag|\\${sign}|${escapeLittle(tag.tag)}}`;
  }
  // Mentions stay plain text: LinkedIn mentions need a LinkedIn ID.
  return escapeLittle(segment);
}

function linksInText(record) {
  return (record.facets ?? []).flatMap((facet) =>
    (facet.features ?? [])
      .filter((f) => f.$type === "app.bsky.richtext.facet#link")
      .map((f) => f.uri),
  );
}

// Returns { text, images }, where images is a list of { url, alt }.
// text is empty for a post with only images.
function convertPost(post) {
  const record = post.record;
  const embed = post.embed;
  const media =
    embed?.$type === "app.bsky.embed.recordWithMedia#view" ? embed.media : embed;
  const quoted =
    embed?.$type === "app.bsky.embed.record#view"
      ? embed.record
      : embed?.$type === "app.bsky.embed.recordWithMedia#view"
        ? embed.record?.record
        : undefined;

  const extraLinks = [];
  let images = [];
  switch (media?.$type) {
    case "app.bsky.embed.images#view":
      images = media.images.map((image) => ({ url: image.fullsize, alt: image.alt }));
      break;
    case "app.bsky.embed.external#view":
      if (!linksInText(record).includes(media.external.uri)) {
        extraLinks.push(media.external.uri);
      }
      break;
    case "app.bsky.embed.video#view":
      // Videos are not uploaded; link to the Bluesky post instead.
      extraLinks.push(postUrl(post));
      break;
  }
  // A quoted post that was deleted, is blocked or was detached by its author
  // has another $type and is left out.
  const quote =
    quoted?.$type === "app.bsky.embed.record#viewRecord" ? convertQuote(quoted) : "";

  const parts = [convertText(record), ...extraLinks.map(escapeLittle), quote];
  return { text: joinParts(parts), images };
}

// Copies the text of a quoted post, with its author and a link to it.
// Images, videos and link cards in the quoted post are left out: the link
// leads to them.
function convertQuote(quoted) {
  const { handle, displayName } = quoted.author;
  const name = displayName?.trim() ? `${displayName.trim()} (@${handle})` : `@${handle}`;
  const text = convertText(quoted.value ?? {});
  return [
    escapeLittle(`Quoting ${name}:`),
    ...(text.trim() ? [`"${text}"`] : []),
    escapeLittle(postUrl(quoted)),
  ].join("\n");
}

function joinParts(parts) {
  return parts.filter((part) => part.trim() !== "").join("\n\n");
}

// Counted on the escaped text, which is never shorter than what LinkedIn shows.
const MAX_LENGTH = 3000;
const MAX_IMAGES = 20;

// Joins a thread (a post and the replies with which its author continued
// it) into one LinkedIn post. If the thread does not fit, the post ends with
// a link to the thread on Bluesky.
export function convertThread(posts) {
  const converted = posts.map(convertPost);
  const more = escapeLittle(`Continued on Bluesky: ${postUrl(posts[0])}`);
  const parts = [];
  const images = [];
  for (const [i, { text, images: postImages }] of converted.entries()) {
    const isLast = i === converted.length - 1;
    const withPost = joinParts([...parts, text, isLast ? "" : more]);
    if ([...withPost].length > MAX_LENGTH) {
      parts.push(more);
      break;
    }
    parts.push(text);
    images.push(...postImages);
  }
  // LinkedIn needs some text, also for a post with only images.
  const text = joinParts(parts) || escapeLittle(postUrl(posts[0]));
  return { text, images: images.slice(0, MAX_IMAGES) };
}
