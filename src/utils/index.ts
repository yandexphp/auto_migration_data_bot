import {promises as fs} from 'fs'
import moment from 'moment'

import type {
    TCreateDocumentProccess,
    TFormProcessSectionPropInputOptionsItem,
    TResponseSendToEKapModuleNewDictionaryRecordContent,
    TResponseUpdateAuthorInEkapBPDocument,
    TXml
} from '../interfaces'

const PROTOCOL = 'https'

export const getUrlLoginPage = (): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/login`

export const getUrlIssue = (id: number): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/issues/${id}`

export const getEkapUrlAPI = (): string => `${PROTOCOL}://${process.env.EKAP_API_HOSTNAME}` ?? ''

export const getUrlIssueOfProjectByQueryId = (projectId: string, queryId: string | number, pageIndex = 1): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/projects/${projectId}/issues?page=${pageIndex}&query_id=${queryId}`

export const getUrlIssueAttachmentXML = (id: number): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/issues/${id}.xml?include=attachments`

export const getUrlUserProfileAttachmentXML = (userId: string) => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/people/${userId}.xml?include=attachments`

export const getUrlIssuesListByProject = (projectId: string, count = 9000): string => `${PROTOCOL}://${process.env.BASE_HOSTNAME}/projects/${projectId}/issues?per_page=${count}`

export const getAuthUsername = (): string => decodeURIComponent(atob(process.env.AUTH_USERNAME ?? ''))

export const getAuthPass = (): string => decodeURIComponent(atob(process.env.AUTH_PASSWORD ?? ''))

export const getEkapUrlPage = (): string => `${PROTOCOL}://${process.env.EKAP_BASE_HOSTNAME}${process.env.PAGE_EKAP_URL_ISSUE_LIST}`

export const getEkapUrlPageNew = (): string => `${PROTOCOL}://${process.env.EKAP_BASE_HOSTNAME}${process.env.PAGE_EKAP_URL_ISSUE_FORM_CREATE}`

export const getEkapUrlDictionaryEntry = (uuid: string): string => `${PROTOCOL}://${process.env.EKAP_BASE_HOSTNAME}${process.env.PAGE_EKAP_URL_ISSUE_FORM_CREATE?.replace('/new', '')}/entries/${uuid}`

export const getAuthEkapUsername = (): string => decodeURIComponent(atob(process.env.AUTH_EKAP_USERNAME ?? ''))

export const getAuthEkapPass = (): string => decodeURIComponent(atob(process.env.AUTH_EKAP_PASSWORD ?? ''))

export const getProcessId = (): string => process.env.PAGE_EKAP_URL_ISSUE_FORM_CREATE?.split('/')?.at(-2) ?? ''

export const getColorHexOrDefColor = (color: string, colorDefault: string, flag: boolean = false): string => `#${flag ? color : colorDefault}`

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

export const getSuccessLoadedIds = async () => {
    try {
        const fileName = './data/successRecordXml.json'

        await notExistFileOfCreate(fileName, '[]')

        const data = await fs.readFile(fileName, 'utf-8') ?? '[]'
        const jsonData = JSON.parse(data) as ({ [id: string]: string })[]

        return jsonData.map(({ id }) => id)
    } catch (e) {
        console.error(e)
    }

    return []
}

export const getFailedLoadedIds = async () => {
    try {
        const fileName = './data/failRecordXml.json'

        await notExistFileOfCreate(fileName, '[]')

        const data = await fs.readFile(fileName, 'utf-8') ?? '[]'
        const jsonData = JSON.parse(data) as ({ [id: string]: string })[]

        return jsonData.map(({ id }) => id)
    } catch (e) {
        console.error(e)
    }

    return []
}

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

export const getFieldByXml = (xml: TXml, field: string) => {
    return xml.issue.custom_fields.custom_field.find(({ '@_id': id }) => id === field)?.value ?? null
}

export const extractNumbers = (s: string): number[] => s.split(' ')
    .map(part => parseInt(part))
    .filter(number => !isNaN(number))

export const putValueFromDictionaryOrFieldValue = async (value: string | null, fieldCode: string | null | undefined, columnId: string | null, ekapConfigRequest: RequestInit) => {
    try {
        if(!columnId) {
            return value ?? ''
        }

        const resProcessDetail = await fetch(`${getEkapUrlAPI()}/admin/dictionaries/input-values/${columnId}`, ekapConfigRequest)
        const dataSave = await resProcessDetail.json() as string[]
        let data = [...dataSave]
        let foundIdx = -1

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

            foundIdx = data.findIndex((v) => v === value)
        } else if(fieldCode && fieldCode === '319') {
            const [curYear, curQuarter] = extractNumbers(String(value))

            foundIdx = data
                .map(extractNumbers)
                .findIndex(([year, quarter]) => year === curYear && quarter === curQuarter)
        } else {
            foundIdx = data.findIndex((v) => v === value)
        }

        console.log('founded index by "', value,'" from data', data)

        if(foundIdx === -1) {
            const errorMessage = `Not found value "${value}" from columnId ${columnId}` + (fieldCode ? ` of fieldCode "${fieldCode}"` : '')
            console.error(errorMessage, dataSave)
            throw new Error(errorMessage)
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

export const getOneFieldXML = <T, K extends keyof T>(obj: T, key: K): T[K] => obj[key]

export const parseSingleDate = (dateStr: string): Date => {
    const [day, month, year] = dateStr.split('.').map(Number)
    return new Date(year, month - 1, day)
}

export const convertToISO = (dateString: string) => {
    const formats = ['YYYY-MM-DD', 'YYYY.MM.DD', 'DD-MM-YYYY', 'DD.MM.YYYY']
    const date = moment(dateString, formats)
    return date.toISOString()
}

export const parseDate = (dateString: string) => {
    try {
        const matchDate = dateString.match(/(\d{4}[.-]\d{2}[.-]\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/g)

        if(matchDate) {
            const [dateStr] = matchDate

            return convertToISO(dateStr)
        }
    } catch (e) {
        console.error(e)
    }

    return dateString
}

export const dateToISOString = (date: string): string => new Date(date).toISOString()

export const parseDateRange = (dateString: string) => {
    try {
        const matchDate = dateString.match(/(\d{2}\.\d{2}\.\d{4})/g)

        if(matchDate) {
            const [startDateStr, endDateStr] = matchDate

            return {
                startDate: parseSingleDate(startDateStr).toISOString(),
                endDate: parseSingleDate(endDateStr).toISOString()
            }
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
    console.log('sendToEKapModuleNewBPDocument create a new bp/process', processId)
    const response = await fetch(`${getEkapUrlAPI()}/bpm/process/start/${processId}`, {
        ...ekapConfigRequest,
        method: 'POST',
        body: JSON.stringify(body)
    })

    const result = await response.text()

    console.log('sendToEKapModuleNewBPDocument response', response.status, result)

    return response.status === 200
}

export const sendToEKapModuleNewBPDocumentContent = async (body: TCreateDocumentProccess, processId: string, ekapConfigRequest: RequestInit): Promise<string> => {
    console.log('sendToEKapModuleNewBPDocumentContent create a new bp/process', processId)
    const response = await fetch(`${getEkapUrlAPI()}/bpm/process/start/${processId}`, {
        ...ekapConfigRequest,
        method: 'POST',
        body: JSON.stringify(body)
    })

    const result = await response.json()

    console.log('sendToEKapModuleNewBPDocumentContent response', response.status, result)

    return response.status === 200 ? result : null
}

export const sendToEKapModuleNewDictionaryRecord = async <T>(body: T, ekapConfigRequest: RequestInit): Promise<boolean> => {
    console.log('sendToEKapModuleNewDictionaryRecord create a new dictionary record')
    const response = await fetch(`${getEkapUrlAPI()}/dictionary-entries`, {
        ...ekapConfigRequest,
        method: 'POST',
        body: JSON.stringify(body)
    })

    const result = await response.json()

    console.log('sendToEKapModuleNewDictionaryRecord response', response.status, result)

    return response.status === 200
}

export const sendToEKapModuleNewDictionaryRecordContent = async <T>(body: T, ekapConfigRequest: RequestInit): Promise<TResponseSendToEKapModuleNewDictionaryRecordContent|null> => {
    try {
        console.log('sendToEKapModuleNewDictionaryRecordContent create a new dictionary record')
        const response = await fetch(`${getEkapUrlAPI()}/dictionary-entries`, {
            ...ekapConfigRequest,
            method: 'POST',
            body: JSON.stringify(body)
        })

        const result = await response.json()

        console.log('sendToEKapModuleNewDictionaryRecordContent response', response.status, result)

        if(response.status === 200) {
            return result
        }
    } catch (e) {
        console.error(e)
    }

    return null
}

export const getDictionaryValues = async (dictionaryId: string, ekapConfigRequest: RequestInit): Promise<string[]> => {
    try {
        const response = await fetch(`${getEkapUrlAPI()}/admin/dictionaries/input-values/${dictionaryId}`, { ...ekapConfigRequest })
        return await response.json() ?? []
    } catch (e) {
        console.error(e)
    }

    return []
}

export const searchEkapUserIdByUsername = async (username: string, ekapConfigRequest: RequestInit): Promise<string|null> => {
    try {
        console.log(`searchEkapUserIdByUsername get userID by username ${username}`)

        const response = await fetch(`${getEkapUrlAPI()}/users/search/old/ekap?username=${username}`, {
            ...ekapConfigRequest,
        })

        const userId = await response.json()

        console.log('searchEkapUserIdByUsername response', response.status, userId)

        if(response.status === 200) {
            return userId
        }
    } catch (e) {
        console.error(e)
    }

    return null
}

export const updateAuthorInEkapBPDocument = async <T>(body: T, ekapConfigRequest: RequestInit): Promise<TResponseUpdateAuthorInEkapBPDocument | null> => {
    try {
        console.log('updateAuthorInEkapBPDocument update', body)

        const response = await fetch(`${getEkapUrlAPI()}/bpm/old/ekap/`, {
            ...ekapConfigRequest,
            method: 'POST',
            body: JSON.stringify(body)
        })

        const result = await response.json()

        console.log('updateAuthorInEkapBPDocument response', response.status, result)

        if(response.status === 200) {
            return result
        }
    } catch (e) {
        console.error(e)
    }

    return null
}
