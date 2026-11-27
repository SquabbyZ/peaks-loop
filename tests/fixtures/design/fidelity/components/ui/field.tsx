export type FieldProps = {
  state?: 'default' | 'error' | 'disabled';
  label: string;
  children: React.ReactNode;
};

/** A labelled input slot whose state set is enumerated, not free-form. */
export function Field({ state = 'default', label, children }: FieldProps) {
  return (
    <label className={`pk-field pk-field--${state}`}>
      <span className="pk-field__label">{label}</span>
      {children}
    </label>
  );
}
