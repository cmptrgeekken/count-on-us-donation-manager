import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdminRequest(request);
  const url = new URL(request.url);
  const destination = new URL("/app/dashboard", url.origin);
  url.searchParams.forEach((value, key) => destination.searchParams.set(key, value));
  return redirect(destination.toString());
};
