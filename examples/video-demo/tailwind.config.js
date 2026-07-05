/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#0f172a",
          fg: "#f8fafc",
          accent: "#6366f1",
        },
      },
    },
  },
  plugins: [],
};
