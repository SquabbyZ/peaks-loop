import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import '@/components/ui/ui.css';

/** One page that composes every declared capability, for S4.1/S4.2 to target. */
export default function ReportsPage() {
  return (
    <main>
      <Card padding="md">
        <h1>Reports</h1>
        <Field state="default" label="Search reports">
          <input type="search" name="q" />
        </Field>
        <Button variant="primary" size="md">
          Load more
        </Button>
        <Button variant="ghost" size="sm">
          Clear
        </Button>
      </Card>
    </main>
  );
}
