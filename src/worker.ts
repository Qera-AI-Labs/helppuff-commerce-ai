import { Env } from "./types";
import { App } from "./index";

export { App };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      if (!env.APP) {
        return new Response(JSON.stringify({ error: "Durable Object binding 'APP' is not configured" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      const id = env.APP.idFromName("default");
      const stub = env.APP.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
