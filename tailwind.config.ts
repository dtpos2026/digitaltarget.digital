import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Public Sans', 'Manrope', 'system-ui', 'sans-serif'],
        display: ['Public Sans', 'Sora', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        gold: {
          DEFAULT: "hsl(var(--gold))",
          foreground: "hsl(var(--gold-foreground))",
          soft: "hsl(var(--gold-soft))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          success: "hsl(var(--status-success))",
          "success-foreground": "hsl(var(--status-success-foreground))",
          warning: "hsl(var(--status-warning))",
          "warning-foreground": "hsl(var(--status-warning-foreground))",
          danger: "hsl(var(--status-danger))",
          "danger-foreground": "hsl(var(--status-danger-foreground))",
          info: "hsl(var(--status-info))",
          "info-foreground": "hsl(var(--status-info-foreground))",
          pending: "hsl(var(--status-pending))",
          cooking: "hsl(var(--status-cooking))",
          onway: "hsl(var(--status-onway))",
          delivered: "hsl(var(--status-delivered))",
          cancelled: "hsl(var(--status-cancelled))",
          teal: "hsl(var(--status-teal))",
          purple: "hsl(var(--status-purple))",
          free: "hsl(var(--status-free))",
          "free-foreground": "hsl(var(--status-free-foreground))",
          running: "hsl(var(--status-running))",
          "running-foreground": "hsl(var(--status-running-foreground))",
          "pending-payment": "hsl(var(--status-pending-payment))",
          "pending-payment-foreground": "hsl(var(--status-pending-payment-foreground))",
          closed: "hsl(var(--status-closed))",
          "closed-foreground": "hsl(var(--status-closed-foreground))",
        },
        pos: {
          sidebar: "hsl(var(--pos-sidebar))",
          "sidebar-foreground": "hsl(var(--pos-sidebar-foreground))",
          cart: "hsl(var(--pos-cart))",
          grid: "hsl(var(--pos-grid-bg))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "slide-in": {
          from: { transform: "translateX(-100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-in": "slide-in 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
