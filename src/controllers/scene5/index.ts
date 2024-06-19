import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'
import {v4} from 'uuid'

import {
    dateToISOString,
    getAuthEkapPass,
    getAuthEkapUsername,
    getColorHexOrDefColor,
    getEkapUrlAPI,
    getEkapUrlPage,
    getFieldByXml,
    getProcessId,
    getUrlIssueAttachmentXML,
    getUrlUserProfileAttachmentXML,
    parseDate,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue,
    searchEkapUserIdByUsername,
    sendToEKapModuleNewBPDocumentContent,
    sleep,
    updateAuthorInEkapBPDocument,
    writeFailRecordXml,
    writeSuccessRecordXml,
} from '../../utils'
import {
    EWebSocketEvent,
    type ISocketResponseMessageProcess,
    WebSocketConnection,
    WebSocketData,
    WebSocketDispatch
} from '../../websocket'
import type {
    TCreateDocumentProccess,
    TFormProcessCustomDetail, TRequestUpdateAuthorInEkapBPDocument,
    TSectionFormDataInput,
    TXml, TXmlUserProfile,
} from '../../interfaces'

const redmineAPIKey = process.env.REDMINE_API_KEY ?? ''

export class SceneFive {
    private static page: Page

    constructor(page: Page) {
        SceneFive.page = page
        SceneFive.init()
    }

    public static getSuccessLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)
    public static getFailedLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)

    public static async init() {
        try {
            const page = SceneFive.page
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

            const ENUM_FORM_COMPONENTS = {
                PURPOSE_OF_DOCUMENT: 'purpose_of_document',
                PERIOD: 'Period',
                YEAR: 'year_1',
                ORGANIZATION: 'organization',
                RISK_CATEGORY: 'risk_category',
                RISK_CODE: 'risk_code',
                MAIN_TYPE: 'main_type',
                EFFICIENCY: 'EFFICIENCY',
                NAME_RISK: 'name_risk',
                DESCRIPTION: 'description',
                TASK_DESCRIPTION: 'taskDescription',
                KEY_RISKS: 'key_risks',
                PROJECT_OWNER: 'project_owner',
                START_DATE: 'start_date',
                END_DATE: 'end_date',
                REACTIVE_EVENTS: 'reactive_events',
                SIZE: 'size',
                POSSIBILITY_OF_RISK: 'possibility_of_risk',
                MARK_OF_CURRENT_RISK: 'mark_of_current_risk',
                AMOUNT_OF_DAMAGE: 'amount_of_damage',
                TIME_AWAY_ONE: 'time_away_one',
                MARK_OF_RISK: 'mark_of_risk',
                RISK_ASSESSMENT: 'Risk_assessment',
                IMPLEMENTATION_OF_RISK: 'implementation_of_risk',
                RISK_RESULT: 'risk_result',
                INFLUENCE_TIME: 'influence_time',
                BASE: 'base',
                TYPE_OF_EVENT: 'type_of_event',
            }

            console.log('SceneFive initialization.')

            const procedureMigration = async (pageIndex = 1) => {
                console.log('F[procedureMigration] - Procedure migration by page', pageIndex, '- starting')

                const url = `https://ekap.kazatomprom.kz/projects/kaptech_riskmanagement/issues?query_id=216&page=${pageIndex}`
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

                    if (SceneFive.getSuccessLoadedList().includes(selectedId)) {
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
                        const xmlDocument = xmlObject as TXml

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

                        const body = {
                            approversDto: {
                                digitalSignature: 'false',
                                ordered: false,
                                approvers: []
                            },
                            formDataDto: {
                                sections: [],
                            },
                            signersDto: {
                                digitalSignature: 'false',
                                ordered: false,
                                signers: []
                            }
                        } as TCreateDocumentProccess

                        const ekapConfigRequest = {
                            headers: {
                                'Content-Type': 'application/json',
                                'accept': 'application/json, text/plain, */*',
                                'authorization': 'Bearer ' + ekapAccessToken
                            },
                        }

                        const formProcessDetail = await page.evaluate(async (processId, ekapApiUrl, ekapConfigRequest) => {
                            const resProcessDetail = await fetch(`${ekapApiUrl}/bpm/definition/bp/${processId}`, ekapConfigRequest)
                            console.log('resProcessDetail', processId, resProcessDetail.status, resProcessDetail.status === 200 ? 'bpm:successLoad' : '')

                            if (resProcessDetail.status !== 200) {
                                console.error(resProcessDetail.url, resProcessDetail.status)
                                throw new Error(`resProcessDetail response ${resProcessDetail.url} ${resProcessDetail.status}`)
                            }

                            const {formId} = await resProcessDetail.json()

                            const resFormDetail = await fetch(`${ekapApiUrl}/form/${formId}`, ekapConfigRequest)
                            console.log('resFormDetail', resFormDetail.status, resFormDetail.status === 200 ? 'form:successLoad' : '')

                            if (resFormDetail.status !== 200) {
                                console.error(resFormDetail.url, resFormDetail.status)
                                throw new Error(`resFormDetail response ${resFormDetail.url} ${resFormDetail.status}`)
                            }

                            const {...rest} = await resFormDetail.json()

                            return {formId, ...rest} as TFormProcessCustomDetail
                        }, getProcessId(), getEkapUrlAPI(), ekapConfigRequest)

                        let FLAG_ERROR = false

                        try {
                            await Promise.all(formProcessDetail.sections.map(async ({
                                                                                        id: sectionId,
                                                                                        inputs
                                                                                    }) => {
                                const sectionInputs = [] as TSectionFormDataInput[]

                                const inputsList = await Promise.all(inputs.map(async ({
                                                                                           id,
                                                                                           key,
                                                                                           accessType,
                                                                                           type,
                                                                                           properties: {
                                                                                               columnId = null,
                                                                                               options = null
                                                                                           }
                                                                                       }) => {
                                    try {
                                        let value = '' as string | string[]
                                        let fieldCode = '' as string | null

                                        switch (key) {
                                            case ENUM_FORM_COMPONENTS.PURPOSE_OF_DOCUMENT:
                                                fieldCode = '322'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PERIOD:
                                                fieldCode = '319'
                                                break;
                                            case ENUM_FORM_COMPONENTS.YEAR:
                                                fieldCode = '320'
                                                break;
                                            case ENUM_FORM_COMPONENTS.ORGANIZATION:
                                                fieldCode = '29'
                                                break;
                                            case ENUM_FORM_COMPONENTS.RISK_CATEGORY:
                                                fieldCode = '303'
                                                break;
                                            case ENUM_FORM_COMPONENTS.RISK_CODE:
                                                fieldCode = '174'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MAIN_TYPE:
                                                fieldCode = '307'
                                                break;
                                            case ENUM_FORM_COMPONENTS.EFFICIENCY:
                                                fieldCode = '308'
                                                break;
                                            case ENUM_FORM_COMPONENTS.NAME_RISK:
                                                fieldCode = '175'
                                                break;
                                            case ENUM_FORM_COMPONENTS.DESCRIPTION:
                                                fieldCode = '115'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TASK_DESCRIPTION:
                                                fieldCode = '177'
                                                break;
                                            case ENUM_FORM_COMPONENTS.KEY_RISKS:
                                                fieldCode = '183'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PROJECT_OWNER:
                                                fieldCode = '176'
                                                break;
                                            case ENUM_FORM_COMPONENTS.START_DATE:
                                            case ENUM_FORM_COMPONENTS.END_DATE:
                                                fieldCode = null

                                                switch (key) {
                                                    case ENUM_FORM_COMPONENTS.START_DATE:
                                                        value = xmlDocument.issue.start_date
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.END_DATE:
                                                        value = xmlDocument.issue.due_date
                                                        break;
                                                    default:
                                                }
                                                break;
                                            case ENUM_FORM_COMPONENTS.REACTIVE_EVENTS:
                                                fieldCode = '182'
                                                break;
                                            case ENUM_FORM_COMPONENTS.SIZE:
                                                fieldCode = '192'
                                                break;
                                            case ENUM_FORM_COMPONENTS.POSSIBILITY_OF_RISK:
                                                fieldCode = '309'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MARK_OF_CURRENT_RISK:
                                                fieldCode = '310'
                                                break;
                                            case ENUM_FORM_COMPONENTS.AMOUNT_OF_DAMAGE:
                                                fieldCode = '317'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TIME_AWAY_ONE:
                                                fieldCode = '311'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MARK_OF_RISK:
                                                fieldCode = '312'
                                                break;
                                            case ENUM_FORM_COMPONENTS.RISK_ASSESSMENT:
                                                fieldCode = '313'
                                                break;
                                            case ENUM_FORM_COMPONENTS.IMPLEMENTATION_OF_RISK:
                                                fieldCode = '314'
                                                break;
                                            case ENUM_FORM_COMPONENTS.RISK_RESULT:
                                                fieldCode = '318'
                                                break;
                                            case ENUM_FORM_COMPONENTS.INFLUENCE_TIME:
                                                fieldCode = '315'
                                                break;
                                            case ENUM_FORM_COMPONENTS.BASE:
                                                fieldCode = '316'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TYPE_OF_EVENT:
                                                fieldCode = '388'
                                                break;
                                            default:
                                                console.warn('continue by key', key)
                                                return
                                        }

                                        if (fieldCode) {
                                            const fieldValueByXml = getFieldByXml(xmlDocument, fieldCode)

                                            if (options) {
                                                value = putValueFromOptionsOrFieldValue(fieldValueByXml, options)
                                            } else {
                                                value = await putValueFromDictionaryOrFieldValue(fieldValueByXml, fieldCode, columnId, ekapConfigRequest)
                                            }
                                        }

                                        if (accessType === 'REQUIRED' && !value) value = ' '
                                        if (!Array.isArray(value) && key === ENUM_FORM_COMPONENTS.START_DATE) value = dateToISOString(parseDate(value) ?? value)
                                        if (!Array.isArray(value) && key === ENUM_FORM_COMPONENTS.END_DATE) value = dateToISOString(parseDate(value) ?? value)
                                        if (['DICTIONARY', 'RADIO'].includes(type) && !Array.isArray(value)) value = [value]

                                        return {id, value}
                                    } catch (e) {
                                        console.error(e)
                                    }

                                    return null
                                }))

                                const foundNull = inputsList.find(inputObj => inputObj === null)

                                if (foundNull) {
                                    throw new Error('Invalid field for create new bp/process a document')
                                }

                                const inputsListFilter = inputsList.filter(Boolean) as TSectionFormDataInput[]

                                sectionInputs.push(...inputsListFilter)
                                body.formDataDto.sections.push({id: sectionId, inputs: sectionInputs})
                            }))
                        } catch (e) {
                            FLAG_ERROR = true
                            console.error(e)
                        }

                        console.log('FLAG_ERROR for body', FLAG_ERROR)
                        console.log('body.formDataDto.sections', body.formDataDto.sections)

                        let isSuccessfully = false

                        // if (!FLAG_ERROR) {
                        //     const newDoc = await sendToEKapModuleNewBPDocumentContent(body, getProcessId(), ekapConfigRequest)
                        //     isSuccessfully = newDoc !== null
                        //
                        //     if(xmlContentUserProfile && newDoc !== null) {
                        //         const xmlObjectUserProfile = xmlParser.parse(xmlContentUserProfile)
                        //
                        //         if (xmlObjectUserProfile) {
                        //             const xmlDocumentUserProfile = xmlObjectUserProfile as TXmlUserProfile
                        //
                        //             console.log('xmlDocumentUserProfile', xmlDocumentUserProfile)
                        //
                        //             const { person } = xmlDocumentUserProfile.person
                        //
                        //             const ekapV2UserAuthorId = await searchEkapUserIdByUsername(person.login, ekapConfigRequest)
                        //
                        //             if(ekapV2UserAuthorId !== null) {
                        //                 await updateAuthorInEkapBPDocument<TRequestUpdateAuthorInEkapBPDocument>({
                        //                     processInstanceId: newDoc,
                        //                     userId: ekapV2UserAuthorId,
                        //                     userName: [person.lastname, person.firstname].filter(Boolean).join(' '),
                        //                     userType: 'AUTHOR'
                        //                 }, ekapConfigRequest)
                        //             }
                        //         }
                        //     }
                        // }

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

                            console.log('sendToEKapModuleNewBPDocument isSuccessfully', isSuccessfully, body, xmlDocument)
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

        console.log('SceneFive done.')
    }
}
