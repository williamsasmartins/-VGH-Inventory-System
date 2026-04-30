import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    // Keep existing index.css styles intact — Tailwind only adds utilities
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // Mirror the CSS variables so Tailwind classes match the design system
        'bg-primary':   '#0F172A',
        'bg-secondary': '#1E293B',
        'bg-card':      '#1E293B',
        'bg-hover':     '#334155',
        'border-base':  '#334155',
        'text-primary': '#F8FAFC',
        'text-secondary':'#94A3B8',
        'text-muted':   '#64748B',
        'green':        '#16A34A',
        'green-light':  '#22C55E',
        'red':          '#DC2626',
        'red-light':    '#FCA5A5',
        'yellow':       '#F59E0B',
        'blue-accent':  '#60A5FA',
      },
      borderRadius: {
        card: '12px',
        sm:   '8px',
      },
    },
  },
  plugins: [],
}

export default config
