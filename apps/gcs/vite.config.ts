import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // Kept off apps/hud's port so both harnesses can run side by side.
    port: 5174,
  },
})
