import puppeteer from 'puppeteer'

import {getAuthPass, getAuthUsername, getUrlLoginPage} from './src/utils'
import {SceneFour} from './src/controllers/scene4'
import {WebSocketClose, WebSocketConnection} from './src/websocket'

WebSocketConnection()

try {
    const browser = await puppeteer.launch({
        headless: false,
        devtools: true,
        dumpio: true,
        defaultViewport: null,
        userDataDir: `./data/${Date.now()}`,
        args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--auto-open-devtools-for-tabs'
        ]
    })

    const pages = await browser.pages()
    pages.forEach(async page => await page.close())

    const page = await browser.newPage()
    const TIMEOUT = 960000

    page.setDefaultNavigationTimeout(TIMEOUT)
    page.setDefaultTimeout(TIMEOUT)

    let FLAG_SILENT_CLOSE_BROWSER = false

    page
        .on('console', message => console.log(`${message.type().toUpperCase()} ${message.text()}`))
        .on('pageerror', ({message}) => console.error('Error', message))
        .on('requestfailed', request => console.log(`Request failed ${request.failure()?.errorText} ${request.url()}`))
        .on('response', async response => {
            const url = response.url()
            const status = response.status()
            const method = response.request().method().toUpperCase()

            console.debug(`Response ${method} ${status} ${url}`)

            if (url.endsWith('/login') && method === 'POST') {
                if (status === 302) {
                    console.info('Authorization Successfully!')
                    new SceneFour(page)
                } else {
                    console.warn('Authorization failed, please check your login or password')
                    throw new Error('Failed to login')
                }
            }
        })

    const startBrowser = async () => {
        await page.goto(getUrlLoginPage(), {waitUntil: 'networkidle0'})

        try {
            await page.type('input[id="username"]', getAuthUsername())
            await page.type('input[id="password"]', getAuthPass())
        } catch {
            return new SceneFour(page)
        }

        await Promise.all([
            page.click('#login-submit'),
            page.waitForNavigation({waitUntil: 'networkidle0'}),
        ])
    }

    process.on('beforeExit', async () => {
        FLAG_SILENT_CLOSE_BROWSER = true
        await browser.close()
        WebSocketClose()

        process.exit(0)
    })

    process.on('SIGINT', async () => {
        FLAG_SILENT_CLOSE_BROWSER = true
        await browser.close()
        WebSocketClose()

        process.exit(0)
    })

    startBrowser().catch(async err => {
        if (!FLAG_SILENT_CLOSE_BROWSER) {
            console.error(err)
        }

        await page.close()
        await browser.close()
        WebSocketClose()

        process.exit(0)
    })
} catch (e) {
    console.error(e)
    WebSocketClose()

    process.exit(0)
}
