import { promises as fs } from 'fs'
import type { Page } from 'puppeteer'

import type {
    TCreateDocumentProccess,
    TFormProcessSectionPropInputOptionsItem,
    TXml
} from '../controllers/scene2/interfaces.ts'

const PROTOCOL = 'https'

export const getUrlLoginPage = (): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/login`

export const getUrlIssue = (id: number): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/issues/${id}`

export const getEkapUrlAPI = (): string => `${PROTOCOL}://${process.env.EKAP_API_HOSTNAME}` ?? ''

export const getUrlIssueOfProjectByQueryId = (projectId: string, queryId: string | number, count = 100): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/projects/${projectId}/issues?per_page=${count}&query_id=${queryId}`

export const getQueryId = (): string => process.env.QUERY_ID ?? ''

export const getUrlIssueAttachmentXML = (id: number): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/issues/${id}.xml?include=attachments`

export const getUrlIssuesListByProject = (projectId: string, count = 9000): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/projects/${projectId}/issues?per_page=${count}`

export const getAuthUsername = (): string => atob(process.env.AUTH_USERNAME ?? '')

export const getAuthPass = (): string => atob(process.env.AUTH_PASSWORD ?? '')

export const getEkapUrlPage = (): string => `${PROTOCOL}://${process.env.EKAP_BASE_HOSTNAME}${process.env.PAGE_EKAP_URL_ISSUE_LIST}`

export const getEkapUrlPageNew = (): string => `${PROTOCOL}://${process.env.EKAP_BASE_HOSTNAME}${process.env.PAGE_EKAP_URL_ISSUE_FORM_CREATE}`

export const getAuthEkapUsername = (): string => atob(process.env.AUTH_EKAP_USERNAME ?? '')

export const getAuthEkapPass = (): string => atob(process.env.AUTH_EKAP_PASSWORD ?? '')

export const getProjectId = (): string => process.env.PROJECT_ID ?? ''

export const getProcessId = (): string => process.env.PAGE_EKAP_URL_ISSUE_FORM_CREATE?.split('/')?.at(-2) ?? ''

export const bodyBuilder = (obj: { [key: string]: any }): string => Object.entries(obj).map(([key, value]) => `${key}=${value}`).join('&')

export const saveCookies = async (page: Page) => {
    const cookies = await page.cookies()
    const cookieJson = JSON.stringify(cookies, null, 2)
    await fs.writeFile('./data/cookies.json', cookieJson)
}

export const loadCookies = async (page: Page) => {
    const cookieJson = await fs.readFile('./data/cookies.json', 'utf8')

    if(cookieJson) {
        const cookies = JSON.parse(cookieJson)
        await page.setCookie(...cookies)
    }
}

export const notExistFileOfCreate = async (fileName: string, defaultContent: string = '') => {
    const isFile = await fs.exists(fileName)

    if(!isFile) {
        await fs.writeFile(fileName, defaultContent ?? '', 'utf-8')
    }
}

export const writeFailRecordXml = async (id: number | string, ids: (string|undefined)[] = []) => {
    try {
        const fileName = './data/failRecordXml.json'

        await notExistFileOfCreate(fileName, '[]')

        const data = await fs.readFile(fileName, 'utf-8') ?? '[]'
        console.log('data', data)
        const jsonData = JSON.parse(data)

        jsonData.push({
            id,
            ids: ids.filter(Boolean) ?? [],
        })

        await fs.writeFile(fileName, JSON.stringify(jsonData, null, 2), 'utf-8')
    } catch (e) {
        console.error(e)
    }
}

export const writeSuccessRecordXml = async (id: number | string, ids: (string|undefined)[] = []) => {
    try {
        const fileName = './data/successRecordXml.json'

        await notExistFileOfCreate(fileName, '[]')

        const data = await fs.readFile(fileName, 'utf-8') ?? '[]'
        console.log('data', data)
        const jsonData = JSON.parse(data)

        jsonData.push({
            id,
            ids: ids.filter(Boolean) ?? [],
        })

        await fs.writeFile(fileName, JSON.stringify(jsonData, null, 2), 'utf-8')
    } catch (e) {
        console.error(e)
    }
}

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

export const getFieldByXml = (xml: TXml, field: string) => {
    return xml.issue.custom_fields.custom_field.find(({ '@_id': id }) => id === field)?.value ?? null
}

export const putValueFromDictionaryOrFieldValue = async (value: string | null, fieldCode: string | null | undefined, columnId: string | null, ekapConfigRequest: RequestInit) => {
    try {
        if(!columnId) {
            return value ?? ''
        }

        const resProcessDetail = await fetch(`${getEkapUrlAPI()}/admin/dictionaries/input-values/${columnId}`, ekapConfigRequest)
        const dataSave = await resProcessDetail.json() as string[]
        let data = [...dataSave]

        if(fieldCode && ['683', '29'].includes(fieldCode)) {
            data = data.map(x => {
                return x
                    .replaceAll('«', '')
                    .replaceAll('»', '')
                    .replaceAll('"', '')
                    .toUpperCase()
            })

            value = String(value)
                .replaceAll('«', '')
                .replaceAll('»', '')
                .replaceAll('"', '')
                .toUpperCase()
        } else if(fieldCode && fieldCode === '319') {
            value = String(value).replace(' год', '')
        }

        const foundIdx = data.findIndex((v) => v === value)

        if(foundIdx === -1) {
            throw new Error(`Not found value "${value}" from columnId ${columnId}` + fieldCode ? ` of fieldCode "${fieldCode}"` : '')
        }

        return String(dataSave[foundIdx])
    } catch (e) {
        console.error(e)
    }

    return value ?? ''
}

export const putValueFromOptionsOrFieldValue = (value: string | null, options: TFormProcessSectionPropInputOptionsItem[] | null): string => {
    if(!options) {
        return value ?? ''
    }

    return options.find(x => x.label === value)?.value ?? value ?? ''
}

export const parseDateRange = (dateString: string) => {
    try {
        const [startDateStr, endDateStr] = dateString.split('-')

        const parseSingleDate = (dateStr: string): Date => {
            const [day, month, year] = dateStr.split('.').map(Number)
            return new Date(year, month - 1, day)
        }

        return {
            startDate: parseSingleDate(startDateStr).toISOString(),
            endDate: parseSingleDate(endDateStr).toISOString()
        }
    } catch (e) {
        console.error(e)
    }

    return {
        startDate: '',
        endDate: ''
    }
}

export const sendToEKapModuleNewBPDocument = async (body: TCreateDocumentProccess, processId: string, ekapConfigRequest: RequestInit): Promise<boolean> => {
    const { status } = await fetch(`${getEkapUrlAPI()}/bpm/process/start/${processId}`, {
        ...ekapConfigRequest,
        method: 'POST',
        body: JSON.stringify(body)
    })

    return status === 200
}
