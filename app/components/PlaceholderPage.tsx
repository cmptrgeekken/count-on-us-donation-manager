interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <>
      <ui-title-bar title={title} />
      <s-page>
        <s-section heading="Coming soon">
          <s-text>
            This feature will be available in a future update.
          </s-text>
        </s-section>
      </s-page>
    </>
  );
}
