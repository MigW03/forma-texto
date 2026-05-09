/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sand: '#F0EEE8',
        forest: '#1A3C2E',
        'forest-mid': '#2D5A3F',
        'forest-light': '#3D7A57',
        ink: '#1A1A18',
        muted: '#6B6B60',
        border: '#DDDBD3',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
