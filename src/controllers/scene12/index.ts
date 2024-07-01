import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'
import {v4} from 'uuid'
import * as path from 'path'

import {
    dateToISOString,
    getAuthEkapPass,
    getAuthEkapUsername,
    getColorHexOrDefColor,
    getEkapUrlAPI,
    getEkapUrlPage,
    getFieldByXml, getOneFieldXML,
    getProcessId,
    getUrlIssueAttachmentXML, getUrlIssueOfProjectByQueryId,
    getUrlUserProfileAttachmentXML, parseDate,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue, readFile,
    searchEkapUserIdByUsername,
    sendToEKapModuleNewBPDocumentContent,
    sleep, sortSectionAndInputsByOrders,
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
    IAttachmentUploaded, IAttachmentUploadFormData, ILocalState,
    TCreateDocumentProccess,
    TFormProcessCustomDetail, TRequestUpdateAuthorInEkapBPDocument,
    TSectionFormDataInput,
    TXml, TXmlUserProfile,
} from '../../interfaces'
import {nanoid} from '../../utils/nanoid.ts'
import {Logger} from '../../services/logger'

const redmineAPIKey = process.env.REDMINE_API_KEY ?? ''

export class SceneTwelve {
    private static page: Page

    constructor(page: Page) {
        SceneTwelve.page = page
        SceneTwelve.init()
    }

    public static getSuccessLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)
    public static getFailedLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)

    public static async init() {
        try {
            const arrOfContinueIssueIds: string[][] = []
            const page = SceneTwelve.page
            const ekapUrl = getEkapUrlPage()
            const xmlParser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false,
                trimValues: true
            })

            Logger.log('Go to auth page ekap')

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
                Logger.log('Username or password element in DOM is not found, or you are already authorized.')
            }

            Logger.log('Get AccessToken Ekap')

            const ekapAccessToken = await page.evaluate(() => (localStorage.getItem('EKAP_APP_AUTH_TOKEN')))

            Logger.log('AccessToken', ekapAccessToken)

            const dumpFile = await readFile(path.join(__dirname, '../../../websocket-issues-dump-7041.json'))
            const parseDumpFile = JSON.parse(dumpFile) as ILocalState
            const localCountFailed = parseDumpFile?.issues?.filter(({ isError }) => isError).length ?? 0
            const localCountLoaded = parseDumpFile?.issues?.filter(({ isMigrated }) => isMigrated).length ?? 0

            const migrationInfo = {
                failLoaded: localCountFailed,
                countLoaded: localCountLoaded,
                allCountItems: 0,
            }

            const ENUM_FORM_COMPONENTS = {
                COMPANY: 'company',
                PERIOD: 'period',
                COURSE: 'course',
                TYPE_OF_TRAINING: 'type_of_training',
                PRIORITY: 'priority',
                START_DATE: 'start_date',
                END_DATE: 'end_date',
                FULL_NAME: 'full_name',
                IIN: 'iin',
                PERSONNEL_CATEGORY: 'personnel_category',
                MANAGEMENT_LEVEL: 'management_level',
                GENDER: 'gender',
                JOB_TITLE: 'job_title',
                STRUCTURAL_SUBDIVISION: 'structural_subdivision',
                DATE_OF_BIRTH: 'date_of_birth',
                COUNRTY2: 'counrty2',
                PROVINCE_REGION2: 'province_region2',
                AREA: 'area',
                CITY_TOWN: 'city_town',
                TRAINING_FORMAT: 'training_format',
                PLATFORM_LOCATION: 'platform_location',
                DURATION_IN_DAYS: 'duration_in_days',
                DURATION_IN_HOURS: 'duration_in_hours',
                SERVICE_PROVIDER: 'service_provider',
                CONTRACT_NUMBER: 'contract_number',
                AGREEMENT_DATE: 'agreement_date',
                APPLICATION_NUMBER_2: 'application_number_2',
                APPLICATION_DATE_2: 'application_date_2',
                TOTAL_AMOUNT_1: 'total_amount_1',
                TOTAL_AMOUNT_2: 'total_amount_2',
                TOTAL_AMOUNT_3: 'total_amount_3',
                TOTAL_AMOUNT_4: 'total_amount_4',
                PARTICIPATION_STATUS: 'participation_status',
                REASON_FOR_ABSENCE: 'reason_for_absence',
                TRAVEL_EXPENSES: 'travel_expenses',
                MINING_CONTRACT: 'mining_contract',
                CONTRACT_NUMBER_4: 'contract_number_4',
                MINING_AGREEMENT: 'mining_agreement',
                FILES: 'files_1',
            }

            Logger.log('SceneTwelve initialization.')

            const procedureMigration = async (pageIndex = 1) => {
                Logger.log('F[procedureMigration] - Procedure migration by page', pageIndex, '- starting')

                const url = getUrlIssueOfProjectByQueryId('ipr', '7041', pageIndex, 750)
                Logger.log('F[procedureMigration] - Go to url: ' + url, pageIndex, '- starting')

                await page.goto(url, {waitUntil: 'networkidle0'})

                const nodeLinks = await page.$$('table.list.issues td.id a')

                if (!nodeLinks.length) {
                    Logger.log('F[procedureMigration] - Forced termination of the migration process.', '\nif (!nodeLinks.length) { ... }')
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
                        Logger.log(e)
                    }

                    return 0
                })

                Logger.log('F[procedureMigration] - Issue identifiers the page', issueIds.length, issueIds)

                if (!issueIds.length) {
                    Logger.log('F[procedureMigration] - Forced termination of the migration process.')
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
                    labelElement.setAttribute('data-entries-count', 'true')
                    labelElement.innerText = ` - - - Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`

                    div.prepend(labelElement)
                    document.body.appendChild(div)
                }, migrationInfo)

                for (const selectedId of ids) {
                    if (!selectedId) {
                        Logger.log('skip not found selectedId', selectedId)
                        arrOfContinueIssueIds.push(['skip not found selectedId', String(selectedId)])
                        continue
                    }

                    Logger.log('Work with selected id', selectedId)

                    Logger.log('--- await processInfo PENDING ---')

                    const processInfo = await WebSocketDispatch<ISocketResponseMessageProcess>({
                        type: EWebSocketEvent.PROCESS_PENDING,
                        data: {
                            process: {
                                id: String(selectedId)
                            }
                        }
                    })

                    Logger.log('--- await processInfo SUCCESSFULLY ---')

                    if(processInfo.data.process.id === selectedId && processInfo.data.process.isPending) {
                        Logger.log('Skipped the process', selectedId)
                        arrOfContinueIssueIds.push(['Skipped the process', selectedId])
                        continue
                    }

                    Logger.log('--- await WebSocketDispatch PENDING ---')

                    await WebSocketDispatch({
                        type: EWebSocketEvent.PROCESS_START,
                        data: {
                            process: {
                                id: String(selectedId)
                            }
                        }
                    })

                    Logger.log('--- await WebSocketDispatch SUCCESSFULLY ---')

                    Logger.log('--- Validation issueID is SuccessLoaded PENDING ---')

                    if (SceneTwelve.getSuccessLoadedList().includes(selectedId)) {
                        migrationInfo.countLoaded++
                        Logger.log(` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`)

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

                                const nodeAllCount = document.querySelector('p[data-entries-count="true"]') as HTMLParagraphElement | never

                                if(nodeAllCount) {
                                    nodeAllCount.innerText = ` - - - Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`
                                }
                            }
                        }, selectedId, migrationInfo)

                        arrOfContinueIssueIds.push([` - Issue ${selectedId} was is loaded as Success [OK]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`, selectedId])
                        continue
                    }

                    Logger.log('--- Validation issueID is SuccessLoaded NOT LOADED ---')

                    Logger.log('--- EKAP-1 Download XML Content PENDING ---')

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

                    Logger.log('--- EKAP-1 Download XML Content SUCCESSFULLY ---')

                    Logger.log('issue id', selectedId, xmlContent ? 'XML Loaded' : 'XML not data loaded')

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
                        Logger.log('--- EKAP-1 Parsing XML Content PENDING ---')
                        const xmlObject = xmlParser.parse(xmlContent)
                        Logger.log('--- EKAP-1 Parsing XML Content SUCCESSFULLY ---')

                        if (!xmlObject) {
                            Logger.log('--- EKAP-1 XML Content IS EMPTY ---')
                            arrOfContinueIssueIds.push(['--- EKAP-1 XML Content IS EMPTY ---', selectedId])
                            continue
                        }

                        const xmlDocument = xmlObject as TXml

                        Logger.log('xmlDocument', xmlDocument)

                        const authorIssueId = xmlDocument.issue.author["@_id"]
                        // const assignedUserIdEkapV1 = xmlDocument.issue?.assigned_to?.["@_id"] ?? null

                        // let xmlDocumentUserAssignedProfile = null

                        Logger.log('--- EKAP-1 Download XML Content for UserProfile PENDING ---')

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

                        Logger.log('--- EKAP-1 Download XML Content for UserProfile SUCCESSFULLY ---')

                        // if(assignedUserIdEkapV1 !== null) {
                        //     Logger.log('--- EKAP-1 Download XML Content for UserAssigned PENDING ---')
                        //
                        //     const xmlContentUserAssignedProfile = await page.evaluate(async (xmlUrl, redmineAPIKey) => {
                        //         try {
                        //             const response = await fetch(xmlUrl, {
                        //                 "headers": {
                        //                     "accept": "*/*",
                        //                     "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
                        //                     "contenttype": "application/json",
                        //                     "datatype": "json",
                        //                     "sec-ch-ua": "\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"",
                        //                     "sec-ch-ua-mobile": "?0",
                        //                     "sec-ch-ua-platform": "\"macOS\"",
                        //                     "sec-fetch-dest": "empty",
                        //                     "sec-fetch-mode": "cors",
                        //                     "sec-fetch-site": "same-origin",
                        //                     "x-redmine-api-key": redmineAPIKey
                        //                 },
                        //                 "referrerPolicy": "strict-origin-when-cross-origin",
                        //                 "body": null,
                        //                 "method": "GET",
                        //                 "mode": "cors",
                        //                 "credentials": "omit"
                        //             })
                        //
                        //             return await response.text()
                        //         } catch (err) {
                        //             console.error(err)
                        //         }
                        //
                        //         return null
                        //     }, getUrlUserProfileAttachmentXML(assignedUserIdEkapV1), redmineAPIKey)
                        //
                        //     // if(xmlContentUserAssignedProfile) {
                        //     //     const xmlObjectUserAssignedProfile = xmlParser.parse(xmlContentUserAssignedProfile)
                        //     //
                        //     //     if (xmlObjectUserAssignedProfile) {
                        //     //         xmlDocumentUserAssignedProfile = xmlObjectUserAssignedProfile as TXmlUserProfile
                        //     //     }
                        //     // }
                        //
                        //     Logger.log('--- EKAP-1 Download XML Content for UserAssigned SUCCESSFULLY ---')
                        // }

                        Logger.log('--- Create body for ekap/forms/bp ---')

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

                        Logger.log('--- Create headers config for ekap API ---')

                        const ekapConfigRequest = {
                            headers: {
                                'Content-Type': 'application/json',
                                'accept': 'application/json, text/plain, */*',
                                'authorization': 'Bearer ' + ekapAccessToken
                            },
                        }

                        Logger.log('--- EKAP-v2 Fetch API /bpm/definition/bp/{id} PENDING ---')

                        const getFormDefinition = async (): Promise<TFormProcessCustomDetail> => {
                            try {
                                return await page.evaluate(async (processId, ekapApiUrl, ekapConfigRequest) => {
                                    const resProcessDetail = await fetch(`${ekapApiUrl}/bpm/definition/bp/${processId}`, ekapConfigRequest)
                                    console.log('resProcessDetail', processId, resProcessDetail.status, resProcessDetail.status === 200 ? 'bpm:successLoad' : '')

                                    if (resProcessDetail.status !== 200) {
                                        console.log(resProcessDetail.url, resProcessDetail.status)
                                        throw new Error(`resProcessDetail response ${resProcessDetail.url} ${resProcessDetail.status}`)
                                    }

                                    const {formId} = await resProcessDetail.json()

                                    const resFormDetail = await fetch(`${ekapApiUrl}/form/${formId}`, ekapConfigRequest)
                                    console.log('resFormDetail', resFormDetail.status, resFormDetail.status === 200 ? 'form:successLoad' : '')

                                    if (resFormDetail.status !== 200) {
                                        console.log(resFormDetail.url, resFormDetail.status)
                                        throw new Error(`resFormDetail response ${resFormDetail.url} ${resFormDetail.status}`)
                                    }

                                    const {...rest} = await resFormDetail.json()

                                    return {formId, ...rest} as TFormProcessCustomDetail
                                }, getProcessId(), getEkapUrlAPI(), ekapConfigRequest)
                            } catch (e) {
                                Logger.log(e)
                                Logger.log('--- EKAP-v2 Fetch API /bpm/definition/bp/{id} RETRY A PENDING ---')
                                return await getFormDefinition()
                            }
                        }

                        const formProcessDetail = await getFormDefinition()

                        Logger.log('--- EKAP-v2 Fetch API /bpm/definition/bp/{id} SUCCESSFULLY ---')

                        let FLAG_ERROR = false

                        Logger.log('--- Start Logics PENDING ---')

                        try {
                            Logger.log('--- EKAP-1 Download attachments to arrayBuffer PENDING ---')

                            const { attachment = [] } = getOneFieldXML(xmlDocument.issue, 'attachments')
                            const attachments = Array.isArray(attachment) ? attachment : [attachment]
                            const uploadedAttachments = [] as IAttachmentUploaded[]

                            Logger.log('attachments', attachments)

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

                            Logger.log('uploaded attachments list', uploadedAttachments)

                            Logger.log('--- EKAP-1 Download attachments to arrayBuffer SUCCESSFULLY ---')

                            Logger.log('--- await Promise.all for put sections on Body content Ekap-v2 PENDING ---')

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
                                            case ENUM_FORM_COMPONENTS.COMPANY:
                                                fieldCode = '29'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PERIOD:
                                                fieldCode = '319'
                                                break;
                                            case ENUM_FORM_COMPONENTS.COURSE:
                                                fieldCode = '3450'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TYPE_OF_TRAINING:
                                                fieldCode = '3478'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PRIORITY:
                                                fieldCode = '3451'
                                                break;
                                            case ENUM_FORM_COMPONENTS.START_DATE:
                                                fieldCode = '3484'
                                                break;
                                            case ENUM_FORM_COMPONENTS.END_DATE:
                                                fieldCode = '3479'
                                                break;
                                            case ENUM_FORM_COMPONENTS.FULL_NAME:
                                                fieldCode = '1483'
                                                break;
                                            case ENUM_FORM_COMPONENTS.IIN:
                                                fieldCode = '3518'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PERSONNEL_CATEGORY:
                                                fieldCode = '3449'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MANAGEMENT_LEVEL:
                                                fieldCode = '860'
                                                break;
                                            case ENUM_FORM_COMPONENTS.GENDER:
                                                fieldCode = '887'
                                                break;
                                            case ENUM_FORM_COMPONENTS.JOB_TITLE:
                                                fieldCode = '3453'
                                                break;
                                            case ENUM_FORM_COMPONENTS.STRUCTURAL_SUBDIVISION:
                                                fieldCode = '3516'
                                                break;
                                            case ENUM_FORM_COMPONENTS.DATE_OF_BIRTH:
                                                fieldCode = '195'
                                                break;
                                            case ENUM_FORM_COMPONENTS.COUNRTY2:
                                                fieldCode = '3456'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PROVINCE_REGION2:
                                                fieldCode = '1479'
                                                break;
                                            case ENUM_FORM_COMPONENTS.AREA:
                                                fieldCode = '3626'
                                                break;
                                            case ENUM_FORM_COMPONENTS.CITY_TOWN:
                                                fieldCode = '3627'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TRAINING_FORMAT:
                                                fieldCode = '862'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PLATFORM_LOCATION:
                                                fieldCode = '3480'
                                                break;
                                            case ENUM_FORM_COMPONENTS.DURATION_IN_DAYS:
                                                fieldCode = '3458'
                                                break;
                                            case ENUM_FORM_COMPONENTS.DURATION_IN_HOURS:
                                                fieldCode = '3459'
                                                break;
                                            case ENUM_FORM_COMPONENTS.SERVICE_PROVIDER:
                                                fieldCode = '3460'
                                                break;
                                            case ENUM_FORM_COMPONENTS.CONTRACT_NUMBER:
                                                fieldCode = '3462'
                                                break;
                                            case ENUM_FORM_COMPONENTS.AGREEMENT_DATE:
                                                fieldCode = '3463'
                                                break;
                                            case ENUM_FORM_COMPONENTS.APPLICATION_NUMBER_2:
                                                fieldCode = '3464'
                                                break;
                                            case ENUM_FORM_COMPONENTS.APPLICATION_DATE_2:
                                                fieldCode = '3466'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TOTAL_AMOUNT_1:
                                                fieldCode = '3467'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TOTAL_AMOUNT_2:
                                                fieldCode = '3468'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TOTAL_AMOUNT_3:
                                                fieldCode = '3469'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TOTAL_AMOUNT_4:
                                                fieldCode = '3470'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PARTICIPATION_STATUS:
                                                fieldCode = '3471'
                                                break;
                                            case ENUM_FORM_COMPONENTS.REASON_FOR_ABSENCE:
                                                fieldCode = '3472'
                                                break;
                                            case ENUM_FORM_COMPONENTS.TRAVEL_EXPENSES:
                                                fieldCode = '3473'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MINING_CONTRACT:
                                                fieldCode = '3474'
                                                break;
                                            case ENUM_FORM_COMPONENTS.CONTRACT_NUMBER_4:
                                                fieldCode = '3476'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MINING_AGREEMENT:
                                                fieldCode = '3477'
                                                break;
                                            case ENUM_FORM_COMPONENTS.FILES:
                                                value = uploadedAttachments.map(({ bp_id }) => bp_id) ?? []
                                                break
                                            default:
                                                Logger.log('continue by key', key)
                                                arrOfContinueIssueIds.push(['continue by key ' + key, selectedId])
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
                                        if (!Array.isArray(value) && type === 'DATE') value = dateToISOString(parseDate(value) ?? value)
                                        if (!Array.isArray(value) && type === 'DATE') value = dateToISOString(parseDate(value) ?? value)
                                        if (['DICTIONARY', 'RADIO', 'SELECT', 'USERS'].includes(type) && !Array.isArray(value)) value = [value]

                                        Logger.log('Key', key, 'Value', value)

                                        return {id, value}
                                    } catch (e) {
                                        Logger.log('--- await Promise.all for put sections on Body content Ekap-v2 ERROR ---')
                                        Logger.log(e)
                                    }

                                    return null
                                }))

                                const foundNull = inputsList.find(inputObj => inputObj === null)

                                if (foundNull) {
                                    Logger.log('--- inputsList have null ERROR ---')
                                    throw new Error('Invalid field for create new bp/process a document')
                                }

                                const inputsListFilter = inputsList.filter(Boolean) as TSectionFormDataInput[]

                                sectionInputs.push(...inputsListFilter)
                                body.formDataDto.sections.push({id: sectionId, inputs: sectionInputs})
                            }))

                            Logger.log('--- Start Logics SUCCESSFULLY ---')
                        } catch (e) {
                            FLAG_ERROR = true
                            Logger.log('--- Start Logics ERROR ---')
                            Logger.log(e)
                        }

                        Logger.log('FLAG_ERROR for body', FLAG_ERROR)
                        Logger.log('FormProcessDetails', formProcessDetail)
                        Logger.log('body.formDataDto.sections', body.formDataDto.sections)

                        let isSuccessfully = false

                        if (!FLAG_ERROR) {
                            body.formDataDto.sections = sortSectionAndInputsByOrders(formProcessDetail, body)
                            Logger.log('SORTED body.formDataDto.sections', body.formDataDto.sections)

                            Logger.log('--- await sendToEKapModuleNewBPDocumentContent PENDING ---')

                            const newDoc = await sendToEKapModuleNewBPDocumentContent(body, getProcessId(), ekapConfigRequest)

                            Logger.log('--- await sendToEKapModuleNewBPDocumentContent SUCCESSFULLY ---')

                            isSuccessfully = newDoc !== null

                            Logger.log('--- New Document BP ---', newDoc)
                            
                            if(xmlContentUserProfile && newDoc !== null) {
                                Logger.log('--- await Features of Author put from Ekap-1 to Ekap-v2 PENDING ---')
                                const xmlObjectUserProfile = xmlParser.parse(xmlContentUserProfile)

                                if (xmlObjectUserProfile) {
                                    const xmlDocumentUserProfile = xmlObjectUserProfile as TXmlUserProfile

                                    Logger.log('xmlDocumentUserProfile', xmlDocumentUserProfile)

                                    const { person } = xmlDocumentUserProfile.person

                                    const ekapV2UserAuthorId = await searchEkapUserIdByUsername(person.login, ekapConfigRequest)

                                    if(ekapV2UserAuthorId !== null) {
                                        await updateAuthorInEkapBPDocument<TRequestUpdateAuthorInEkapBPDocument>({
                                            processInstanceId: newDoc,
                                            userId: ekapV2UserAuthorId,
                                            userName: [person.lastname, person.firstname].filter(Boolean).join(' '),
                                            userType: 'AUTHOR'
                                        }, ekapConfigRequest)

                                        Logger.log('--- await Features of Author put from Ekap-1 to Ekap-v2 SUCCESSFULLY ---')
                                    } else {
                                        Logger.log('--- await Features of Author put from Ekap-1 to Ekap-v2 UNKNOWN ---')
                                    }
                                }
                            }
                        }

                        if (isSuccessfully) {
                            Logger.log(`--- Migration ${selectedId} is SUCCESSFULLY ---`)
                            migrationInfo.countLoaded++
                            await writeSuccessRecordXml(selectedId, { sceneId: 6 })

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
                            Logger.log(`--- Migration ${selectedId} is FAILED ---`)
                            migrationInfo.failLoaded++
                            await writeFailRecordXml(selectedId, { sceneId: 6 })

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

                                const nodeAllCount = document.querySelector('p[data-entries-count="true"]') as HTMLParagraphElement | never

                                if(nodeAllCount) {
                                    nodeAllCount.innerText = ` - - - Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`
                                }
                            }

                            console.log('sendToEKapModuleNewBPDocument isSuccessfully', isSuccessfully, body, xmlDocument)
                        }, body, isSuccessfully, selectedId, getProcessId(), migrationInfo, xmlDocument, color)
                    }
                }

                if (isNextPage) {
                    const newPageIndex = pageIndex + 1
                    Logger.log(`--- await Migration go to next page ${newPageIndex} ---`)
                    await procedureMigration(newPageIndex)
                }

                Logger.log('Procedure migration by page', pageIndex, `${isNextPage ? `We are redirecting you to the next page ${pageIndex + 1} to continue.` : ''}`, '- the iteration process is finished')
            }

            Logger.log('Procedure Migration start 1 page')

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

                    const nodeAllCount = document.querySelector('p[data-entries-count="true"]') as HTMLParagraphElement | never

                    if(nodeAllCount) {
                        nodeAllCount.innerText = ` - - - Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`
                    }
                }
            }, migrationInfo)

            Logger.log(' - finished successfully as', migrationInfo)
            Logger.log('Array issue ids is failed load', arrOfContinueIssueIds)
        } catch (e) {
            Logger.log(e)
        }

        Logger.log('SceneTwelve done.')
    }
}
