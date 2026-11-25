export function SurfacePrimaryPage() {
  return (
    <section>
      <a href="/docs" className="text-primary underline">
        Docs
      </a>
      <div className="data-selected:border-primary" data-selected="true">
        Card
      </div>
      <Loader2 className="text-primary" />
    </section>
  );
}
