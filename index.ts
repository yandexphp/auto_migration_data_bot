import puppeteer from 'puppeteer'

import {getAuthPass, getAuthUsername, getUrlLoginPage} from './src/utils'
import {SceneOne} from './src/controllers/scene1'
import {SceneSecond} from './src/controllers/scene2'
import {SceneThree} from './src/controllers/scene3'

const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    dumpio: true,
    defaultViewport: null,
    userDataDir: './data',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--auto-open-devtools-for-tabs']
})

const pages = await browser.pages()
pages.forEach(async page => await page.close())

const page = await browser.newPage()
const TIMEOUT = 60000

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
                // new SceneOne(page)
                // new SceneSecond(page)
                // new SceneThree(page)
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
        // return new SceneOne(page)
        // return new SceneSecond(page)
        // return new SceneThree(page)
    }

    await Promise.all([
        page.click('#login-submit'),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
    ])
}

process.on('beforeExit', async () => {
    FLAG_SILENT_CLOSE_BROWSER = true
    await browser.close()
    process.exit(0)
})

process.on('SIGINT', async () => {
    FLAG_SILENT_CLOSE_BROWSER = true
    await browser.close()
    process.exit(0)
})

startBrowser().catch(async err => {
    if (!FLAG_SILENT_CLOSE_BROWSER) {
        console.error(err)
    }

    await page.close()
    await browser.close()
    process.exit(0)
})
