export const loader = async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "count-on-us",
      timestamp: new Date().toISOString(),
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
};
