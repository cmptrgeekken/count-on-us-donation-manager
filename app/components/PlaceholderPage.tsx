import { Page, EmptyState, BlockStack, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <Page>
      <TitleBar title={title} />
      <EmptyState
        heading="Coming soon"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" tone="subdued">
            This feature will be available in a future update.
          </Text>
        </BlockStack>
      </EmptyState>
    </Page>
  );
}
