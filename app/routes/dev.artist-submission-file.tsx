import type { LoaderFunctionArgs } from "@remix-run/node";

import { readSignedLocalArtistSubmissionFile } from "../services/artistSubmissionStorage.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = Number(url.searchParams.get("expires") ?? "0");
  const signature = url.searchParams.get("signature") ?? "";

  const file = await readSignedLocalArtistSubmissionFile({
    key,
    expires,
    signature,
  });

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "private, no-store",
    },
  });
};
