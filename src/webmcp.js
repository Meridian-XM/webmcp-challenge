/* WebMCP wiring: registers this page's two tools with the visiting agent.
 *
 * Contract notes that are easy to get wrong, so they are stated here rather than learned:
 *  - execute RETURNS a result object. Errors are RETURNED as structured results too,
 *    never thrown: a thrown error reaches the agent as a transport failure and it cannot
 *    tell "this video has no captions" from "your tool is broken".
 *  - Every result carries an explicit `status`. There are THREE, not two. A caption fetch
 *    that comes back empty is NOT a success with no text and NOT a failure - it is
 *    `not_measured`, and it says so. We learned this the expensive way: the upstream
 *    endpoint answers HTTP 200 with a zero-byte body, so a status-code check reports a
 *    silent pass and the page would render an explainer of nothing.
 */

const TOOLS_ENDPOINT = window.WFY_ENDPOINT || "/api";

function ok(data)            { return { status: "ok", ...data }; }
function failed(reason)      { return { status: "failed", reason }; }
function notMeasured(reason) { return { status: "not_measured", reason }; }

async function postJSON(path, body) {
  let res;
  try {
    res = await fetch(`${TOOLS_ENDPOINT}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // The request never completed. That is not evidence about the subject.
    return { _transport: notMeasured(`request did not complete: ${e && e.message}`) };
  }
  if (!res.ok) return { _transport: failed(`upstream returned HTTP ${res.status}`) };
  try {
    return { _json: await res.json() };
  } catch (e) {
    return { _transport: notMeasured("upstream returned a body that is not JSON") };
  }
}

const getTranscript = {
  name: "get_transcript",
  description:
    "Fetch the caption text of a YouTube video as timestamped segments. Returns the raw " +
    "material only - it does not summarise, rank or interpret. You decide what matters. " +
    "IF THIS RETURNS status:not_measured, the fetch failed from OUR server, not from you, " +
    "and the video is usually still readable from where you are: open the video in your own " +
    "browser, use Show transcript under the description, read it there, then call " +
    "render_explainer with what matters.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "A YouTube watch or share URL." },
    },
    required: ["url"],
  },
  async execute({ url }) {
    if (!url || typeof url !== "string") return failed("no url supplied");
    // The page builds its timestamp links from this: when an agent fetches, the visitor never
    // typed in the box, so without it every timestamp renders as dead plain text.
    if (typeof window !== "undefined") window.WFY_lastUrl = url;

    const r = await postJSON("/transcript", { url });
    if (r._transport) return r._transport;

    const segments = (r._json && r._json.segments) || [];
    // THE THREE-STATE POINT. An empty list is not an empty video: upstream answers 200
    // with nothing when it declines us, and those two are identical from here.
    if (segments.length === 0) {
      return notMeasured(
        "no caption segments came back. This does NOT establish the video has no " +
        "captions - the caption source answers 200 with an empty body when it declines " +
        "an automated fetch. Treat as unmeasured, not as an empty transcript. " +
        "NEXT STEP FOR YOU: open the video in your own browser, use Show transcript under " +
        "the description, read it there, then call render_explainer with the slides you " +
        "decided matter. That keeps the fetch on the visitor's own connection, which is " +
        "usually not the one that was refused."
      );
    }
    return ok({
      segments,
      count: segments.length,
      note: "Timestamps are seconds from the start of the video.",
      // ⛔ THE NEXT STEP IS PART OF THE RESULT, NOT AN ASSUMPTION. Measured: an agent fetched
      // through this tool, wrote its summary in its own chat, and never touched the page - the
      // visitor watched nothing happen. A tool that returns raw material must say what the
      // material is FOR, in the result, where the agent is actually reading.
      next_step: "Now decide what matters and CALL render_explainer with the slides - the page "
        + "shows and reads them aloud to the person in front of it. Do not answer in chat only: "
        + "the chat is yours, the page is theirs. Give every slide `at` in seconds so the "
        + "timestamp becomes a link into the video, and pass `url` so those links resolve.",
    });
  },
};

const renderExplainer = {
  name: "render_explainer",
  description:
    "ALWAYS CALL THIS AFTER get_transcript to display the explainer on the page - the transcript " +
    "call is only the raw material and answering in chat alone leaves the visitor's screen empty. " +
    "Draw slides on this page and read them aloud in the visitor's browser. Send what you " +
    "decided was worth keeping; each slide is a title, a few lines, and the timestamp it came from. " +
    "ALWAYS SET `at`, IN SECONDS FROM THE START OF THE VIDEO, ON EVERY SLIDE: the page turns it " +
    "into a link that opens the video at that exact moment, so a slide without `at` loses the one " +
    "thing the viewer needs to check you against the source.",
  inputSchema: {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            lines: { type: "array", items: { type: "string" } },
            at: { type: "number", description:
              "Seconds into the video. Required in practice: the page renders it as a link that " +
              "opens the video at that moment." },
          },
          required: ["title"],
        },
      },
      speak: { type: "boolean", description: "Read the slides aloud. Default true." },
      url: { type: "string", description:
        "The video URL these slides came from. Pass it so each slide's timestamp becomes a link " +
        "that opens the video at that moment; without it the timestamps are plain text." },
    },
    required: ["slides"],
  },
  async execute({ slides, speak = true, url }) {
    if (!Array.isArray(slides)) return failed("slides must be an array");
    if (slides.length === 0) return failed("no slides supplied - nothing to draw");

    let drawn = 0;
    try {
      drawn = window.WFY_render(slides, url || window.WFY_lastUrl);
    } catch (e) {
      return failed(`the page could not draw the slides: ${e && e.message}`);
    }

    // Speech is a bonus, never the verdict: a browser with no speechSynthesis, or one
    // that refuses without a user gesture, must not turn a drawn explainer into a failure.
    let spoken = "not attempted";
    if (speak) {
      if (!("speechSynthesis" in window)) {
        spoken = "unavailable in this browser";
      } else {
        try {
          window.WFY_speak(slides);
          spoken = "started";
        } catch (e) {
          spoken = `refused by the browser: ${e && e.message}`;
        }
      }
    }
    return ok({ drawn, spoken, note: "The visitor can see this on the page now." });
  },
};

// ⛔ THE SPEC SAYS `document.modelContext`. We shipped `navigator.modelContext` — the OLD name —
// and it cost us a live test: Chrome 152 had the ModelContext interface present with no navigator
// binding, so the page reported "no agent" and ChatGPT's tools-list came back empty. Read off the
// WebMCP explainer at github.com/webmachinelearning/webmcp. `navigator` is kept as a FALLBACK
// because at least one shipping Chromium (149) exposed it there, and dropping it would break the
// browsers that work today in order to fix the ones that do not.
function findModelContext() {
  if (typeof document !== "undefined" && document.modelContext) {
    return { mc: document.modelContext, where: "document.modelContext" };
  }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return { mc: navigator.modelContext, where: "navigator.modelContext (legacy binding)" };
  }
  return { mc: null, where: null };
}

export function registerWebMCPTools() {
  const { mc, where } = findModelContext();
  if (!mc) {
    // Not an error. Most visitors are humans in an ordinary browser.
    return { registered: 0, reason: "no modelContext on document or navigator in this browser" };
  }
  const tools = [getTranscript, renderExplainer];
  try {
    for (const t of tools) mc.registerTool(t);
  } catch (e) {
    // registerTool rejects with NotAllowedError under Permissions-Policy: tools=().
    return { registered: 0, reason: `registerTool refused: ${e && e.name}: ${e && e.message}`, where };
  }
  return { registered: tools.length, where };
}

// An agent may attach modelContext AFTER load, so a register-once-at-load misses it. Retry a few
// times, cheaply, and stop as soon as it takes.
export function registerWithRetry(onResult, tries = 12, gapMs = 500) {
  let n = 0;
  const attempt = () => {
    const r = registerWebMCPTools();
    if (r.registered > 0 || ++n >= tries) return onResult && onResult(r);
    setTimeout(attempt, gapMs);
  };
  attempt();
}

if (typeof window !== "undefined") {
  window.WFY_registerTools = registerWebMCPTools;
  window.WFY_registerWithRetry = registerWithRetry;
}
