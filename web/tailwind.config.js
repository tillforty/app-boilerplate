import tillforty from './tailwind-preset.js'
import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [tillforty],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  plugins: [animate],
}
