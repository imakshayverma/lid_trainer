import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Lato", "sans-serif"],
        serif: ["Lato", "sans-serif"]
      },
      colors: {
        nb: {
          1: "#2F3742",
          2: "#6C7481",
          3: "#D0D4DC",
          4: "#EE8E3B",
          5: "#FFFFFF",
          6: "#F1F1F1",
          7: "#FDEAD8",
          8: "#258A58",
          9: "#C34C4C"
        }
      },
      boxShadow: {
        panel: "0 4px 10px rgba(0, 0, 0, 0.19), 0 3px 9px rgba(0, 0, 0, 0.23);",
        card: "0 12px 26px -20px rgba(32, 38, 48, 0.24)"
      }
    }
  },
  plugins: []
};

export default config;
