export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const apiOrigin = String(env.UMYINON_API_ORIGIN || "").replace(/\/+$/u, "");
      if (!apiOrigin) {
        return new Response("UMYINON_API_ORIGIN is not configured", {
          status: 500,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      const target = new URL(`${apiOrigin}${url.pathname}${url.search}`);
      const headers = new Headers(request.headers);
      headers.delete("host");
      const init = {
        method: request.method,
        headers,
        redirect: "manual",
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }
      return fetch(new Request(target, init));
    }

    return env.ASSETS.fetch(request);
  },
};
