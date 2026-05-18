import { readFileSync } from 'fs'
import { join, dirname } from 'path'

function getTemplatesDir(): string {
  const possiblePaths = [
    join(__dirname, 'templates'),
    join(dirname(__dirname), 'src', 'templates'),
  ]
  for (const p of possiblePaths) {
    try {
      readFileSync(join(p, 'chatgpt', 'index.html'), 'utf-8')
      return p
    } catch {}
  }
  return join(__dirname, 'templates')
}

const templatesDir = getTemplatesDir()

export function renderTemplate(templateName: string, data: Record<string, string>): string {
  const htmlPath = join(templatesDir, templateName, 'index.html')
  const cssPath = join(templatesDir, templateName, 'style.css')
  let html = readFileSync(htmlPath, 'utf-8')
  let css = ''
  try {
    css = readFileSync(cssPath, 'utf-8')
  } catch {}
  const htmlWithCss = html.replace('{{CSS}}', css)
  let result = htmlWithCss
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    result = result.replace(regex, value)
  }
  return result
}
