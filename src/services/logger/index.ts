import { Page } from 'puppeteer'

export class Logger {
    private page: Page

    constructor(page: Page) {
        this.page = page
    }

    public async log(...args: any[]) {
        try {
            await this.page.evaluate((args) => console.log(...args), args)
        } catch (e) {
            console.error(e)
        }
    }

    public async info(...args: any[]) {
        await this.page.evaluate(() => console.info(...args))
    }

    public async debug(...args: any[]) {
        await this.page.evaluate(() => console.debug(...args))
    }

    public async warn(...args: any[]) {
        await this.page.evaluate(() => console.warn(...args))
    }

    public async error(...args: any[]) {
        await this.page.evaluate(() => console.error(...args))
    }

    public async clear() {
        await this.page.evaluate(() => console.clear())
    }
}
