export const loader = async () => {
  return Response.json({
    ok: true,
    service: "count-on-us",
    timestamp: new Date().toISOString(),
  });
};
