export function SurfaceBadPage() {
  return (
    <section className="rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
      <div className="rounded-xl">
        <span className="rounded-full">
          <button className="rounded bg-primary px-4 py-2 text-white">Save</button>
          <button className="rounded-md bg-primary px-6 py-3 font-medium text-white">
            Save and close
          </button>
        </span>
      </div>
    </section>
  );
}
