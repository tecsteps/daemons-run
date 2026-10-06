import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/layout/Page';

export function ProjectsPage() {
  return (
    <Page title="Projects">
      <EmptyState
        illustration="app-empty-daemons"
        title="No projects yet"
        description="Any folder in /projects on a server counts as a project."
      />
    </Page>
  );
}
