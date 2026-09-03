# WebMCP Challenge entry

One page. Two tools. No model call by us.

A YouTube link goes in; the visitor's own agent does the thinking; the page draws
and speaks the result. The agent's reasoning runs on the visitor's plan, not ours —
we hold no model key on the page and store nothing.

## The two tools

The page registers both through `navigator.modelContext.registerTool`, so an agent
in the same tab can call them directly.

| tool | in | out |
|---|---|---|
| `get_transcript` | a YouTube URL | caption text with timestamps, as structured data |
| `render_explainer` | an array of slides (title, lines, timestamp) | slides drawn on the page and read aloud |

`get_transcript` hands the agent the raw material. The agent decides what matters and
writes the slide script. `render_explainer` puts that back on the page and reads it
aloud with the browser's own `speechSynthesis`.

## Why WebMCP fits

The judging question is what people and agents accomplish *together*. Here the split is
literal: the page can fetch and it can render, and it does neither of the two things an
agent is good at — deciding what is worth keeping, and writing it down. A human watches
it happen in their own tab and can press play.

## Live

**https://meridianxm.com/tldw**

## Running it

Open that page in a browser that speaks WebMCP:

- the ChatGPT desktop app's built-in browser — a free account is enough, tested tonight
- Chrome with `chrome://flags/#enable-webmcp-testing` enabled

Both are measured, not assumed: tools register on **stable Chrome 152** with that flag, read back
from the live page as `'modelContext' in document === true` with both tools listed.

⚠ An earlier version of this file said the flag was *not* sufficient. That was a true reading of a
broken page, not of Chrome: we had bound to `navigator.modelContext`, the old name, so nothing was
there to find. The spec name is `document.modelContext` and the page now registers on it, with
`navigator` kept only as a fallback for the one shipping Chromium that exposed it there.

Then ask your agent to summarise a YouTube link. It will find both tools registered on
the page. In Chrome, the DevTools **Application** panel lists them and can run them by hand.

Without an agent the page still explains itself, and a human can paste a link and read the
captions directly.

### If the transcript comes back `not_measured`

**The fetch order is free-first.** The server tries `yt-dlp` under an 8-second cap and only calls
the paid transcript API when that is refused or times out — a credit is spent on videos YouTube
declines to serve us, not on every video. Nothing is cached: each request fetches afresh, so no
caption text is stored anywhere.

That is not a failure and not "no captions" — it is the fetch declining to happen. YouTube
refuses caption requests from datacentre IPs for many videos, so our server-side fetch is a
first try, not the only path. The tool tells your agent the fallback in its own response: open
the video, use **Show transcript** under the description, read it on your own session, and call
`render_explainer` with what you decided matters. That keeps the fetch per-user rather than
routing every viewer's video through one server.

## Licence

MIT — see [LICENSE](LICENSE).
