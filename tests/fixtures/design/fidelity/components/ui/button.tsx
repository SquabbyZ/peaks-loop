export type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  children: React.ReactNode;
};

/** The only button the library ships: an enumerated variant and size set. */
export function Button({ variant = 'primary', size = 'md', children }: ButtonProps) {
  return (
    <button className={`pk-button pk-button--${variant} pk-button--${size}`} type="button">
      {children}
    </button>
  );
}
