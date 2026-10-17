const siteName = import.meta.env.VITE_SITE_NAME || 'Communal Cache'

export function siteTitle(title: string) {
  return title.replace('Communal Cache', siteName)
}
