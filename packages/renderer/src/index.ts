import { chromium, Browser, Page } from 'playwright'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
  }
  return browser
}

export interface RenderOptions {
  format?: string
  margin?: { top: string; right: string; bottom: string; left: string }
}

export async function renderPDF(html: string, options: RenderOptions = {}): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle' })
    const pdf = await page.pdf({
      format: (options.format as any) ?? 'A4',
      margin: options.margin ?? {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm',
      },
      printBackground: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

export async function shutdown(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}
