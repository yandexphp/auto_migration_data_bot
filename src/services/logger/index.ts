import { appendFileSync } from 'fs'
import { format } from 'date-fns'

export class Logger {
    private static randomString: string = Logger.generateRandomString(5)

    private static generateRandomString(length: number): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
        let result = ''
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * characters.length)
            result += characters.charAt(randomIndex)
        }
        return result
    }

    public static log(...args: any[]): void {
        const date = new Date()
        const formattedDate = format(date, 'dd-MM-yyyy')
        const logFileName = `logfile-${Logger.randomString}-${formattedDate}.log`

        const logMessage = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : arg.toString()
        ).join(' ')

        console.log(...args)
        appendFileSync(logFileName, logMessage + '\n')
    }
}
