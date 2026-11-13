import type { Config } from 'tailwindcss';

// هوية خالد لصيانة المحمول: كحلي / أزرق / سماوي / أبيض
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0B1F3A', 700: '#12305A', 600: '#1A3F73' },
        brand: { DEFAULT: '#1D6FE0', 600: '#175CBC', 50: '#EAF2FD' },
        sky: { DEFAULT: '#22C3E6', 100: '#D9F5FB' },
      },
      fontFamily: { sans: ['Cairo', 'system-ui', 'sans-serif'] },
      borderRadius: { xl: '0.9rem' },
    },
  },
  plugins: [],
};
export default config;
