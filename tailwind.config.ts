import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "sans-serif"],
        serif: ["Manrope", "sans-serif"]
      },
      colors: {
        nb: {
          1: "#1F2937", // primary text
          2: "#52606D", // secondary text
          3: "#D8E1EB", // borders/dividers
          4: "#4F6373", // primary accent (buttons/focus)
          5: "#D1DEE3", // base surface
          6: "#F6F8FB", // elevated/alt surface
          7: "#EAF1FF", // selected/soft accent background
          8: "#2D8A54", // success
          9: "#C44343"  // error
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
