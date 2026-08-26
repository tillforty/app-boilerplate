import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom gives the lib modules their browser globals (localStorage, window).
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
