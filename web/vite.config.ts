import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export function siteMetadataPlugin(siteName: 'Communal Cache' | 'Communal Cache Staging') {
  const shortName = siteName === 'Communal Cache Staging' ? 'CC Staging' : siteName
  const manifest = JSON.parse(readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'))
  return {
    name: 'site-metadata',
    transformIndexHtml(html: string) {
      return html.replace('<title>Communal Cache</title>', `<title>${siteName}</title>`)
        .replace('name="apple-mobile-web-app-title" content="Communal Cache"', `name="apple-mobile-web-app-title" content="${shortName}"`)
    },
    generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): unknown }) {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({ ...manifest, name: siteName, short_name: shortName }, null, 2) + '\n' })
    },
  }
}

const siteName = process.env.VITE_SITE_NAME === 'Communal Cache Staging' ? 'Communal Cache Staging' : 'Communal Cache'

export default defineConfig({
  plugins: [react(), tailwindcss(), siteMetadataPlugin(siteName)],
  define: { 'import.meta.env.VITE_SITE_NAME': JSON.stringify(siteName) },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
