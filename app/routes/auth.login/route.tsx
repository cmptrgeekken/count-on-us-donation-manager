import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <s-page>
      <s-section heading="Log in">
        <Form method="post">
          <div style={{ display: "grid", gap: "1rem", maxWidth: "28rem" }}>
            <s-text>Enter your store's `.myshopify.com` domain to continue.</s-text>

            {errors.shop && (
              <s-banner tone="critical">
                <s-text>{errors.shop}</s-text>
              </s-banner>
            )}

            <div style={{ display: "grid", gap: "0.35rem" }}>
              <s-text-field
                type="text"
                name="shop"
                label="Shop domain"
                value={shop}
                onChange={(event) => setShop((event.currentTarget as HTMLInputElement).value)}
              />
              <s-text color="subdued">Example: `example.myshopify.com`</s-text>
            </div>

            <div>
              <s-button type="submit">Log in</s-button>
            </div>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
