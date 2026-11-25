import { useRows } from './states-data-hook';

export function StatesFetchClosurePage() {
  const rows = useRows();
  return (
    <section>
      <h1>Rows</h1>
      <p>{rows.length}</p>
    </section>
  );
}
