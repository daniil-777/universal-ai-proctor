// The branded address redirects browsers to the full Node/FFmpeg app.
// Uploads, streaming replies and private account cookies go directly to that app.
export default {
  fetch(request, env) {
    const incoming = new URL(request.url);
    const destination = new URL(env.FULL_APP_URL);
    destination.pathname = incoming.pathname;
    destination.search = incoming.search;
    return new Response(null, {
      status: 302,
      headers: { Location: destination.href, 'Cache-Control': 'no-store' },
    });
  },
};
