if (typeof Response.json !== "function") {
  Object.defineProperty(Response, "json", {
    configurable: true,
    value(data: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json; charset=utf-8");
      }

      return new Response(JSON.stringify(data), {
        ...init,
        headers,
      });
    },
  });
}
