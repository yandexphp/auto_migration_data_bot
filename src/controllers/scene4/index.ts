import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'
import {v4} from 'uuid'

import {
    dateToISOString,
    getAuthEkapPass,
    getAuthEkapUsername,
    getColorHexOrDefColor,
    getDictionaryValues,
    getEkapUrlAPI, getEkapUrlDictionaryEntry,
    getEkapUrlPage,
    getOneFieldXML,
    getProcessId,
    getUrlIssueAttachmentXML, getUrlUserProfileAttachmentXML,
    parseDate, searchEkapUserIdByUsername,
    sendToEKapModuleNewDictionaryRecordContent,
    sleep, updateAuthorInEkapBPDocument,
} from '../../utils'
import {
    EWebSocketEvent,
    type ISocketResponseMessageProcess,
    WebSocketConnection,
    WebSocketData,
    WebSocketDispatch
} from '../../websocket'
import type {
    IAttachmentUploaded,
    IAttachmentUploadFormData,
    TBodySectionDictionaryRecordContent,
    TDictionaryFormDetails, TRequestUpdateAuthorInEkapBPDocument, TXmlUserProfile,
    TXmlWithFiles
} from '../../interfaces'
import {nanoid} from '../../utils/nanoid.ts'

const redmineAPIKey = process.env.REDMINE_API_KEY ?? ''

interface TBody {
    dictionaryId: string
    isActual: boolean
    sectionEntries: TBodySectionDictionaryRecordContent[]
}

export class SceneFour {
    private static page: Page

    constructor(page: Page) {
        SceneFour.page = page
        SceneFour.init()
    }

    public static getSuccessLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)
    public static getFailedLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)

    public static async init() {
        try {
            const page = SceneFour.page
            const ekapUrl = getEkapUrlPage()
            const xmlParser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false,
                trimValues: true
            })

            await page.goto(ekapUrl, {waitUntil: 'networkidle0'})

            try {
                await page.type('input[name="username"]', getAuthEkapUsername())
                await page.type('input[name="password"]', getAuthEkapPass())

                await sleep(5000)

                await Promise.all([
                    page.click('button[type="submit"]'),
                    page.waitForNavigation({waitUntil: 'networkidle0'}),
                ])
            } catch {
                console.warn('Username or password element in DOM is not found, or you are already authorized.')
            }

            const ekapAccessToken = await page.evaluate(() => (localStorage.getItem('EKAP_APP_AUTH_TOKEN')))

            console.log('AccessToken', ekapAccessToken)

            const migrationInfo = {
                failLoaded: 0,
                countLoaded: 0,
                allCountItems: 0,
            }

            enum ENUM_DICTIONARY_OLD_COMPONENTS {
                DOCUMENT_NAME = '91ae51f0-82b7-49b3-938a-5ba63df21213',
                STRUCTURE_DEPARTMENT = '89455f7d-882a-4e5e-8c18-86cb1264470c',
                START_DATE = 'd9b69f92-b64c-4eae-8bdf-19f9cda182f3',
                CHECK_DATA = 'f22e1aa9-928c-4840-b5d1-79b461602475',
                NOTE = '49f91aa7-fb2c-4a2b-9667-dc67991f6d4a',
                FILE = 'a3941c39-9134-4c5e-89dc-6a1358849f96',
            }

            console.log('SceneFour initialization.')

            const procedureMigration = async (pageIndex = 1) => {
                console.log('F[procedureMigration] - Procedure migration by page', pageIndex, '- starting')

                const url = `https://ekap.kazatomprom.kz/projects/internal_regulations/issues?c%5B%5D=subject&c%5B%5D=start_date&c%5B%5D=due_date&c%5B%5D=attachments&c%5B%5D=description&f%5B%5D=&group_by=project&per_page=750&set_filter=1&sort=id%3Adesc&utf8=%E2%9C%93&page=${pageIndex}`
                await page.goto(url, {waitUntil: 'networkidle0'})

                const nodeLinks = await page.$$('table.list.issues td.id a')

                if (!nodeLinks.length) {
                    console.warn('F[procedureMigration] - Forced termination of the migration process.', '\nif (!nodeLinks.length) { ... }')
                    return
                }

                const issueIds = await Promise.all(nodeLinks.map(async nodeLink => (
                    await page.evaluate(element => element.textContent?.trim(), nodeLink)
                )))

                const isNextPage = await page.evaluate(() => document.querySelector('li.next.page') !== null)

                migrationInfo.allCountItems = await page.evaluate(() => {
                    try {
                        const el = document.querySelector('.pagination .items')
                        return el !== null ? parseInt(String(el?.textContent)?.split('/')[1]) : 0
                    } catch (e) {
                        console.error(e)
                    }

                    return 0
                })

                console.log('F[procedureMigration] - Issue identifiers the page', issueIds.length, issueIds)

                if (!issueIds.length) {
                    console.warn('F[procedureMigration] - Forced termination of the migration process.')
                    return
                }

                const ids = issueIds

                await page.evaluate((migrationInfo) => {
                    const div = document.createElement('div')
                    div.style.position = 'fixed'
                    div.style.zIndex = '999999'
                    div.style.background = 'rgb(0 0 0 / 91%)'
                    div.style.width = '100%'
                    div.style.height = '100%'
                    div.style.top = '0'
                    div.style.left = '0'
                    div.style.right = '0'
                    div.style.bottom = '0'
                    div.setAttribute('data-log-label', '')

                    const labelElement = document.createElement('p')
                    labelElement.style.fontSize = '10px'
                    labelElement.style.padding = '2px 4px'
                    labelElement.style.margin = '0'
                    labelElement.style.color = '#b2b2b2'
                    labelElement.innerText = ` - - - Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`

                    div.prepend(labelElement)
                    document.body.appendChild(div)
                }, migrationInfo)

                for (const selectedId of ids) {
                    if (!selectedId) {
                        console.log('skip not found selectedId', selectedId)
                        continue
                    }

                    await sleep(1000)

                    const processInfo = await WebSocketDispatch<ISocketResponseMessageProcess>({
                        type: EWebSocketEvent.PROCESS_PENDING,
                        data: {
                            process: {
                                id: String(selectedId)
                            }
                        }
                    })

                    if(processInfo.data.process.id === selectedId && processInfo.data.process.isPending) {
                        console.log('Skipped the process', selectedId)
                        continue
                    }

                    await WebSocketDispatch({
                        type: EWebSocketEvent.PROCESS_START,
                        data: {
                            process: {
                                id: String(selectedId)
                            }
                        }
                    })

                    if (SceneFour.getSuccessLoadedList().includes(selectedId)) {
                        migrationInfo.countLoaded++
                        console.log(` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`)

                        await page.evaluate((selectedId, migrationInfo) => {
                            const logLabelElement = document.querySelector('div[data-log-label]')

                            if (logLabelElement) {
                                const labelElement = document.createElement('p')
                                labelElement.style.fontSize = '12px'
                                labelElement.style.padding = '2px 4px'
                                labelElement.style.margin = '0'
                                labelElement.style.color = '#92eaa0'
                                labelElement.innerText = ` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`
                                logLabelElement.prepend(labelElement)
                            }
                        }, selectedId, migrationInfo)
                        continue
                    }

                    const xmlContent = await page.evaluate(async (xmlUrl, redmineAPIKey) => {
                        try {
                            const response = await fetch(xmlUrl, {
                                "headers": {
                                    "accept": "*/*",
                                    "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
                                    "contenttype": "application/json",
                                    "datatype": "json",
                                    "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
                                    "sec-ch-ua-mobile": "?0",
                                    "sec-ch-ua-platform": "\"macOS\"",
                                    "sec-fetch-dest": "empty",
                                    "sec-fetch-mode": "cors",
                                    "sec-fetch-site": "same-origin",
                                    "x-redmine-api-key": redmineAPIKey
                                },
                                "referrerPolicy": "strict-origin-when-cross-origin",
                                "body": null,
                                "method": "GET",
                                "mode": "cors",
                                "credentials": "omit"
                            })

                            return await response.text()
                        } catch (err) {
                            console.error(err)
                        }

                        return null
                    }, getUrlIssueAttachmentXML(Number(selectedId)), redmineAPIKey)

                    console.log('issue id', selectedId, xmlContent ? 'XML Loaded' : 'XML not data loaded')

                    if (!xmlContent) {
                        if(WebSocketData.issues.findIndex(({ issueId }) => issueId === selectedId) === -1) {
                            WebSocketConnection()?.send(JSON.stringify({
                                type: EWebSocketEvent.ISSUE,
                                data: {
                                    issues: [{
                                        id: v4(),
                                        issueId: String(selectedId),
                                        isError: true,
                                        isMigrated: false,
                                        isSavedOnDisk: true
                                    }]
                                }
                            }))
                        }
                    } else {
                        const xmlObject = xmlParser.parse(xmlContent)

                        if (!xmlObject) continue
                        const xmlDocument = xmlObject as TXmlWithFiles

                        console.log('xmlDocument', xmlDocument)

                        const authorIssueId = xmlDocument.issue.author["@_id"]

                        const xmlContentUserProfile = await page.evaluate(async (xmlUrl, redmineAPIKey) => {
                            try {
                                const response = await fetch(xmlUrl, {
                                    "headers": {
                                        "accept": "*/*",
                                        "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
                                        "contenttype": "application/json",
                                        "datatype": "json",
                                        "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
                                        "sec-ch-ua-mobile": "?0",
                                        "sec-ch-ua-platform": "\"macOS\"",
                                        "sec-fetch-dest": "empty",
                                        "sec-fetch-mode": "cors",
                                        "sec-fetch-site": "same-origin",
                                        "x-redmine-api-key": redmineAPIKey
                                    },
                                    "referrerPolicy": "strict-origin-when-cross-origin",
                                    "body": null,
                                    "method": "GET",
                                    "mode": "cors",
                                    "credentials": "omit"
                                })

                                return await response.text()
                            } catch (err) {
                                console.error(err)
                            }

                            return null
                        }, getUrlUserProfileAttachmentXML(authorIssueId), redmineAPIKey)

                        const body: TBody = {
                            dictionaryId: getProcessId(),
                            isActual: false,
                            sectionEntries: []
                        }

                        const ekapConfigRequest = {
                            headers: {
                                'Content-Type': 'application/json',
                                'accept': 'application/json, text/plain, */*',
                                'authorization': 'Bearer ' + ekapAccessToken
                            },
                        }

                        const processDetail = await page.evaluate(async (processId, ekapApiUrl, ekapConfigRequest) => {
                            try {
                                const resProcessDetail = await fetch(`${ekapApiUrl}/admin/dictionaries/${processId}`, ekapConfigRequest)
                                console.log('resProcessDetail', processId, resProcessDetail.status, resProcessDetail.status === 200 ? 'dictionaries:successLoad' : '')

                                if (resProcessDetail.status !== 200) {
                                    console.error(resProcessDetail.url, resProcessDetail.status)
                                    throw new Error(`resProcessDetail response ${resProcessDetail.url} ${resProcessDetail.status}`)
                                }

                                return await resProcessDetail.json() as TDictionaryFormDetails
                            } catch (e) {
                                console.error(e)
                            }

                            return null
                        }, getProcessId(), getEkapUrlAPI(), ekapConfigRequest)

                        if(processDetail) {
                            try {
                                body.isActual = xmlDocument.issue.status['@_name'].toLowerCase().includes('Актуально'.toLowerCase())

                                const { attachment = [] } = getOneFieldXML(xmlDocument.issue, 'attachments')
                                const attachments = Array.isArray(attachment) ? attachment : [attachment]
                                const uploadedAttachments = [] as IAttachmentUploaded[]

                                console.log('attachments', attachments)

                                if(attachments.length) {
                                    await Promise.all(attachments.map(async attachment => {
                                        const uploadedAttachment = await page.evaluate(async (attachment, nanoid, redmineAPIKey, ekapApiUrl, ekapConfigRequest) => {
                                            console.log('Start download file buffer', attachment.filename)

                                            const response = await fetch(attachment.content_url, {
                                                "headers": {
                                                    "accept": "*/*",
                                                    "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
                                                    "contenttype": "application/json",
                                                    "datatype": "json",
                                                    "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
                                                    "sec-ch-ua-mobile": "?0",
                                                    "sec-ch-ua-platform": "\"macOS\"",
                                                    "sec-fetch-dest": "empty",
                                                    "sec-fetch-mode": "cors",
                                                    "sec-fetch-site": "same-origin",
                                                    "x-redmine-api-key": redmineAPIKey
                                                },
                                                "referrerPolicy": "strict-origin-when-cross-origin",
                                                "body": null,
                                                "method": "GET",
                                                "mode": "cors",
                                                "credentials": "omit"
                                            })

                                            console.log('downloadAttachmentAsBuffer status', response.status)

                                            const fileArrayBuffer = await response.arrayBuffer()
                                            const fileBlob = new Blob([fileArrayBuffer])
                                            const fileBasename = attachment.filename.substring(0, attachment.filename.lastIndexOf('.'))
                                            const fileExt = attachment.filename.substring(attachment.filename.lastIndexOf('.'))
                                            const fileNameHash = `${fileBasename}-${nanoid}${fileExt}`
                                            const file = new File([fileBlob], fileNameHash, { type: attachment.content_type })

                                            console.log('downloadAttachmentAsBuffer file', file)

                                            const result = {
                                                file,
                                                title: '',
                                                bpId: fileNameHash,
                                                description: '',
                                                url: '???',
                                                size: String(file.size),
                                                filename: fileNameHash,
                                                userMetadata: JSON.stringify({a: 'b'}),
                                                name: fileBasename + fileExt
                                            } as IAttachmentUploadFormData

                                            console.log('---- DATA ----', result)

                                            console.log('End download file buffer', attachment.filename)

                                            if(response.status === 200) {
                                                const {
                                                    title,
                                                    bpId,
                                                    description,
                                                    url,
                                                    size,
                                                    filename,
                                                    userMetadata,
                                                    name
                                                } = result

                                                const formData = new FormData()
                                                formData.append('file', file, bpId)
                                                formData.append('title', title)
                                                formData.append('bpId', bpId)
                                                formData.append('description', description)
                                                formData.append('url', url)
                                                formData.append('size', size)
                                                formData.append('filename', bpId)
                                                formData.append('userMetadata', userMetadata)
                                                formData.append('name', name)

                                                const uploadResponse = await fetch(`${ekapApiUrl}/minio/file/upload/instruction`, {
                                                    method: 'POST',
                                                    headers: {
                                                        'authorization': ekapConfigRequest.headers['authorization'],
                                                        'accept': 'application/json, text/plain, */*',
                                                        'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
                                                        'sec-ch-ua-mobile': '?0',
                                                        'sec-ch-ua-platform': '"macOS"',
                                                        'sec-fetch-dest': 'empty',
                                                        'sec-fetch-mode': 'cors',
                                                        'sec-fetch-site': 'same-site',
                                                    },
                                                    body: formData,
                                                    mode: 'cors',
                                                    credentials: 'include',
                                                    referrer: ekapApiUrl,
                                                    referrerPolicy: 'strict-origin-when-cross-origin',
                                                })

                                                console.log('uploadAttachment upload response', uploadResponse.status)

                                                if (uploadResponse.status === 200) {
                                                    console.log('File uploaded successfully')
                                                    return await uploadResponse.json() as IAttachmentUploaded
                                                } else if (uploadResponse.status === 409) {
                                                    return {
                                                        title,
                                                        description,
                                                        url,
                                                        size: Number(size),
                                                        filename,
                                                        user_metadata: userMetadata,
                                                        bp_id: bpId,
                                                    } as IAttachmentUploaded
                                                }
                                            }

                                            return null
                                        }, attachment, nanoid(), redmineAPIKey, getEkapUrlAPI(), ekapConfigRequest)

                                        if(uploadedAttachment) {
                                            uploadedAttachments.push(uploadedAttachment)
                                        }
                                    }))
                                }

                                console.log('uploaded attachments list', uploadedAttachments)

                                const dictionariesMap = new Map<string, string[]>()

                                await Promise.all(processDetail.sections.map(async ({ id: sectionId, inputs }) => {
                                    const inputEntries = await Promise.all(inputs.map(async ({ id: inputId, properties: { columnId = null }}) => {
                                        let value: string | string[] = ''

                                        switch (inputId) {
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.DOCUMENT_NAME:
                                                value = getOneFieldXML(xmlDocument.issue, 'subject')
                                                break
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.STRUCTURE_DEPARTMENT: {
                                                const structureDep = getOneFieldXML(xmlDocument.issue, 'project')?.['@_name']

                                                try {
                                                    if(columnId && !dictionariesMap.has(columnId)) {
                                                        const dictionaryValues = await getDictionaryValues(columnId, ekapConfigRequest)
                                                        console.log('dictionaryValues', dictionaryValues)
                                                        dictionariesMap.set(columnId, dictionaryValues.map(value => value.toLowerCase()))
                                                    }
                                                } catch (e) {
                                                    console.error(e)
                                                }

                                                value = dictionariesMap.get(columnId ?? '')?.find(value => value === structureDep) ?? structureDep
                                                break
                                            }
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.START_DATE:
                                                const startDate = getOneFieldXML(xmlDocument.issue, 'start_date')
                                                value = dateToISOString(parseDate(startDate) ?? startDate)
                                                break
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.CHECK_DATA:
                                                const dueDate = getOneFieldXML(xmlDocument.issue, 'due_date')
                                                value = dateToISOString(parseDate(dueDate) ?? dueDate)
                                                break
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.NOTE:
                                                value = getOneFieldXML(xmlDocument.issue, 'description') ?? ''
                                                break
                                            case ENUM_DICTIONARY_OLD_COMPONENTS.FILE:
                                                value = uploadedAttachments.map(({ bp_id }) => bp_id) ?? []
                                                break
                                        }

                                        return {
                                            inputId,
                                            value
                                        }
                                    }))

                                    body.sectionEntries.push({ sectionId, inputEntries })
                                }))
                            } catch (error) {
                                console.error(error)
                            }
                        }

                        let isSuccessfully = false

                        console.log('body', body)

                        try {
                            if (SceneFour.getSuccessLoadedList().includes(selectedId)) {
                                migrationInfo.countLoaded++
                                console.log(` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`)

                                await page.evaluate((selectedId, migrationInfo) => {
                                    const logLabelElement = document.querySelector('div[data-log-label]')

                                    if (logLabelElement) {
                                        const labelElement = document.createElement('p')
                                        labelElement.style.fontSize = '12px'
                                        labelElement.style.padding = '2px 4px'
                                        labelElement.style.margin = '0'
                                        labelElement.style.color = '#92eaa0'
                                        labelElement.innerText = ` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`
                                        logLabelElement.prepend(labelElement)
                                    }
                                }, selectedId, migrationInfo)
                                continue
                            } else {
                                const newDoc = await sendToEKapModuleNewDictionaryRecordContent<TBody>(body, ekapConfigRequest)
                                isSuccessfully = newDoc !== null

                                if(xmlContentUserProfile && newDoc !== null) {
                                    const xmlObjectUserProfile = xmlParser.parse(xmlContentUserProfile)

                                    if (xmlObjectUserProfile) {
                                        const xmlDocumentUserProfile = xmlObjectUserProfile as TXmlUserProfile

                                        console.log('xmlDocumentUserProfile', xmlDocumentUserProfile)

                                        const { person } = xmlDocumentUserProfile.person

                                        const ekapV2UserAuthorId = await searchEkapUserIdByUsername(person.login, ekapConfigRequest)

                                        if(ekapV2UserAuthorId !== null) {
                                            await updateAuthorInEkapBPDocument<TRequestUpdateAuthorInEkapBPDocument>({
                                                processInstanceId: newDoc.id,
                                                userId: ekapV2UserAuthorId,
                                                userName: [person.lastname, person.firstname].filter(Boolean).join(' '),
                                                userType: 'AUTHOR'
                                            }, ekapConfigRequest)
                                        }
                                    }

                                    console.log('Entry URL', getEkapUrlDictionaryEntry(newDoc.id))
                                }
                            }
                        } catch (e) {
                            console.error(e)
                        }

                        if (isSuccessfully) {
                            migrationInfo.countLoaded++
                            if(WebSocketData.issues.findIndex(({ issueId }) => issueId === selectedId) === -1) {
                                WebSocketConnection()?.send(JSON.stringify({
                                    type: EWebSocketEvent.ISSUE,
                                    data: {
                                        issues: [{
                                            id: v4(),
                                            issueId: String(selectedId),
                                            isError: false,
                                            isMigrated: true,
                                            isSavedOnDisk: true
                                        }]
                                    }
                                }))
                            }
                        } else {
                            migrationInfo.failLoaded++
                            if(WebSocketData.issues.findIndex(({ issueId }) => issueId === selectedId) === -1) {
                                WebSocketConnection()?.send(JSON.stringify({
                                    type: EWebSocketEvent.ISSUE,
                                    data: {
                                        issues: [{
                                            id: v4(),
                                            issueId: String(selectedId),
                                            isError: true,
                                            isMigrated: false,
                                            isSavedOnDisk: true
                                        }]
                                    }
                                }))
                            }
                        }

                        const color = getColorHexOrDefColor('92eaa0', 'ea9295', isSuccessfully)

                        await page.evaluate((body, isSuccessfully, selectedId, processId, migrationInfo, xmlDocument, color) => {
                            const logLabelElement = document.querySelector('div[data-log-label]')

                            if (logLabelElement) {
                                const labelElement = document.createElement('p')
                                labelElement.style.fontSize = '12px'
                                labelElement.style.padding = '2px 4px'
                                labelElement.style.margin = '0'
                                labelElement.style.color = color
                                labelElement.innerText = ` - Issue ${selectedId} in process ${processId} a create new item is - ${isSuccessfully ? 'Success [OK]' : 'Failed [ERROR]'}; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries`
                                logLabelElement.prepend(labelElement)
                            }

                            console.log('sendToEKapModuleNewDictionaryRecordContent isSuccessfully', isSuccessfully, body, xmlDocument)
                        }, body, isSuccessfully, selectedId, getProcessId(), migrationInfo, xmlDocument, color)
                    }
                }

                if (isNextPage) {
                    const newPageIndex = pageIndex + 1
                    await procedureMigration(newPageIndex)
                }

                console.log('Procedure migration by page', pageIndex, `${isNextPage ? `We are redirecting you to the next page ${pageIndex + 1} to continue.` : ''}`, '- the iteration process is finished')
            }

            await procedureMigration(1)

            await page.evaluate((migrationInfo) => {
                const logLabelElement = document.querySelector('div[data-log-label]')

                if (logLabelElement) {
                    const labelElement = document.createElement('p')
                    labelElement.style.fontSize = '10px'
                    labelElement.style.padding = '2px 4px'
                    labelElement.style.margin = '0'
                    labelElement.style.color = 'rgb(176 146 234)'
                    labelElement.innerText = ` - - - Entries migrate the page finish ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}`
                    logLabelElement.prepend(labelElement)
                }
            }, migrationInfo)

            console.log(' - finished successfully as', migrationInfo)
        } catch (e) {
            console.error(e)
        }

        console.log('SceneFour done.')
    }
}
