import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/layout/Page';

export function AppsPage() {
  return (
    <Page title="Apps">
      <EmptyState
        illustration="app-empty-previews"
        title="No apps exposed"
        description="Run daemons expose 3000 on a server to get a link for an app on localhost."
      />
    </Page>
  );
}
