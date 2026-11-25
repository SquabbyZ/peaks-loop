import { RowList } from '@/components/RowList';
import { Missing } from '@/components/Missing';

export function UsersPage({ rows }: { rows: Array<{ id: string; name: string }> }) {
  return (
    <section className="text-base">
      <RowList rows={rows} />
      <Missing />
    </section>
  );
}
