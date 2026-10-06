import { Link } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <Page title="Not found">
      <EmptyState
        illustration="app-not-found"
        title="This page does not exist"
        description="The link may be old, or the server was removed."
        action={
          <Button asChild>
            <Link to="/servers">Back to servers</Link>
          </Button>
        }
      />
    </Page>
  );
}
