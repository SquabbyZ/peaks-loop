import { StatusBadge } from './a11y-status-badge';

export function BadgePage() {
  return (
    <section>
      <h1>Badges</h1>
      <StatusBadge label="Copy" onClick={() => undefined} />
    </section>
  );
}
