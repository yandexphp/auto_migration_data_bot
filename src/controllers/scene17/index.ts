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
    getOneFieldXML,
    getProcessId, getUrlIssue,
    getUrlIssueAttachmentXML,
    getUrlUserProfileAttachmentXML,
    parseDate,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue,
    searchEkapUserIdByUsername, sendCommentInEkapBPDocument,
    sendToEKapModuleNewBPDocumentContent,
    sleep,
    sortSectionAndInputsByOrders,
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
    IAttachmentUploaded,
    IAttachmentUploadFormData, IRequestSendComment,
    TCreateDocumentProccess,
    TFormProcessCustomDetail,
    TRequestUpdateAuthorInEkapBPDocument,
    TSectionFormDataInput,
    TXml,
    TXmlUserProfile,
} from '../../interfaces'
import {nanoid} from '../../utils/nanoid.ts'
import {Logger} from '../../services/logger'

const redmineAPIKey = process.env.REDMINE_API_KEY ?? ''

export class SceneSeventeen {
    private static page: Page

    constructor(page: Page) {
        SceneSeventeen.page = page
        SceneSeventeen.init()
    }

    public static getSuccessLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)
    public static getFailedLoadedList = () => WebSocketData.issues.filter(({ isMigrated }) => isMigrated).map(({ issueId }) => issueId)

    public static async init() {
        try {
            const arrOfContinueIssueIds: string[][] = []
            const page = SceneSeventeen.page
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

            const migrationInfo = {
                failLoaded: 0,
                countLoaded: 0,
                allCountItems: 0,
            }

            const ENUM_FORM_COMPONENTS = {
                ORGANIZATION: 'organization',
                DATE: 'date',
                PARAGRAPH: 'paragraph',
                POSITION: 'position',
                FULL_NAME: 'full_name',
                PRODUCTION_INDICATORS: 'production_indicators',
                MEASURES_REASONS: 'measures_reasons',
                FILES: 'files',
            }

            Logger.log('SceneSeventeen initialization.')

            const procedureMigration = async (pageIndex = 1) => {
                Logger.log('F[procedureMigration] - Procedure migration by page', pageIndex, '- starting')

                const url = `https://ekap.kazatomprom.kz/projects/reg_ps/issues?page=${pageIndex}&per_page=750`
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

                    if (SceneSeventeen.getSuccessLoadedList().includes(selectedId)) {
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
                    } else {
                        Logger.log(`--- Validation issueID ${selectedId} is SuccessLoaded NOT LOADED ---`)
                    }

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

                        Logger.log('--- GO TO ISSUE PAGE PENDING ---')

                        await page.goto(getUrlIssue(Number(selectedId)), { waitUntil: 'networkidle0' })

                        Logger.log('--- GO TO ISSUE PAGE SUCCESSFULLY ---')

                        Logger.log('--- GET ALL COMMENTS NODES PENDING ---')

                        const allCommentList = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('#history div[id*="note-"]')).map(commentNode => ({
                                authorId: commentNode.querySelector('h4 > a[href*="/people/"]')?.getAttribute('href')?.split('/people/')[1] ?? '',
                                authorName: commentNode.querySelector('h4 > a[href*="/people/"]')?.textContent ?? '',
                                createdAt: commentNode.querySelector('h4 > a[title]')?.getAttribute('title') ?? '',
                                comment: commentNode.querySelector('h4')?.nextElementSibling?.textContent ?? ''
                            }))
                        }, [])

                        Logger.log('--- GET ALL COMMENTS NODES SUCCESSFULLY ---',  allCommentList)

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
                                            case ENUM_FORM_COMPONENTS.ORGANIZATION:
                                                fieldCode = '29'
                                                break;
                                            case ENUM_FORM_COMPONENTS.DATE:
                                                fieldCode = '351'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PARAGRAPH:
                                                fieldCode = '854'
                                                break;
                                            case ENUM_FORM_COMPONENTS.POSITION:
                                                fieldCode = '407'
                                                break;
                                            case ENUM_FORM_COMPONENTS.FULL_NAME:
                                                fieldCode = '342'
                                                break;
                                            case ENUM_FORM_COMPONENTS.PRODUCTION_INDICATORS:
                                                fieldCode = '547'
                                                break;
                                            case ENUM_FORM_COMPONENTS.MEASURES_REASONS:
                                                fieldCode = '181'
                                                break;
                                            case ENUM_FORM_COMPONENTS.FILES:
                                                value = uploadedAttachments.map(({ bp_id }) => bp_id) ?? []
                                                break;
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
                                        if (!Array.isArray(value) && type === 'DATE' && value) value = dateToISOString(parseDate(value) ?? value)
                                        if (!Array.isArray(value) && type === 'DATE' && value) value = dateToISOString(parseDate(value) ?? value)
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
                        let newDocProcessId = null

                        if (!FLAG_ERROR) {
                            body.formDataDto.sections = sortSectionAndInputsByOrders(formProcessDetail, body)
                            Logger.log('SORTED body.formDataDto.sections', body.formDataDto.sections)

                            Logger.log('--- await sendToEKapModuleNewBPDocumentContent PENDING ---')

                            newDocProcessId = await sendToEKapModuleNewBPDocumentContent(body, getProcessId(), ekapConfigRequest)

                            Logger.log('--- await sendToEKapModuleNewBPDocumentContent SUCCESSFULLY ---')

                            isSuccessfully = newDocProcessId !== null

                            Logger.log('--- New Document BP ---', newDocProcessId)

                            if(xmlContentUserProfile && newDocProcessId !== null) {
                                Logger.log('--- await Features of Author put from Ekap-1 to Ekap-v2 PENDING ---')
                                const xmlObjectUserProfile = xmlParser.parse(xmlContentUserProfile)

                                if (xmlObjectUserProfile) {
                                    const xmlDocumentUserProfile = xmlObjectUserProfile as TXmlUserProfile

                                    Logger.log('xmlDocumentUserProfile', xmlDocumentUserProfile)

                                    const { person } = xmlDocumentUserProfile.person

                                    const ekapV2UserAuthorId = await searchEkapUserIdByUsername(person.login, ekapConfigRequest)

                                    if(ekapV2UserAuthorId !== null) {
                                        await updateAuthorInEkapBPDocument<TRequestUpdateAuthorInEkapBPDocument>({
                                            processInstanceId: newDocProcessId,
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

                        /**
                         * Send to comments
                         */
                        if(isSuccessfully && allCommentList.length && newDocProcessId) {
                            for(const comment of allCommentList) {
                                try {
                                    if(!comment.authorId) {
                                        Logger.log(`Skip comment ${comment.comment} because author not found...`)
                                        continue;
                                    }

                                    Logger.log(`--- EKAP-1 Download XML Content for UserProfile ${comment.authorId} of Comment PENDING ---`)

                                    const xmlContentUserProfileComment = await page.evaluate(async (xmlUrl, redmineAPIKey) => {
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
                                    }, getUrlUserProfileAttachmentXML(comment.authorId), redmineAPIKey)

                                    Logger.log('--- EKAP-1 Download XML Content for UserProfile of Comment SUCCESSFULLY ---')

                                    if(xmlContentUserProfileComment) {
                                        Logger.log('--- await Features of Comment send from Ekap-1 to Ekap-v2 PENDING ---')

                                        const xmlObjectUserProfileComment = xmlParser.parse(xmlContentUserProfileComment)

                                        Logger.log('xmlObjectUserProfileComment', xmlObjectUserProfileComment)

                                        const { person: commentPerson } = xmlObjectUserProfileComment.person

                                        const ekapV2UserCommentAuthorId = await searchEkapUserIdByUsername(commentPerson.login, ekapConfigRequest)

                                        if(ekapV2UserCommentAuthorId !== null) {
                                            const commentResponse = await sendCommentInEkapBPDocument<IRequestSendComment>({
                                                processInstanceId: newDocProcessId,
                                                userId: ekapV2UserCommentAuthorId,
                                                updatedBy: dateToISOString(parseDate(comment.createdAt)),
                                                userName: comment.authorName,
                                                value: comment.comment
                                            }, ekapConfigRequest)

                                            Logger.log('--- await Features of comment send from Ekap-1 to Ekap-v2 SUCCESSFULLY ---', commentResponse)
                                        } else {
                                            Logger.log('--- await Features of comment send from Ekap-1 to Ekap-v2 UNKNOWN ---')
                                        }

                                        Logger.log('--- await Features of Comment send from Ekap-1 to Ekap-v2 SUCCESSFULLY ---')
                                    }
                                } catch (e) {
                                    Logger.log(e)
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

        Logger.log('SceneSeventeen done.')
    }
}
