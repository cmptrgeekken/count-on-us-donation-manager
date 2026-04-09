import type { LoaderFunctionArgs } from "@remix-run/node";
import { PlaceholderPage } from "../components/PlaceholderPage";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdminRequest(request);
  return null;
};

export default function ProviderConnectionsPage() {
  return <PlaceholderPage title="Provider Connections" />;
}
