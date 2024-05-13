import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'

import {
    getAuthEkapPass,
    getAuthEkapUsername,
    getColorHexOrDefColor,
    getEkapUrlAPI,
    getEkapUrlPage,
    getFailedLoadedIds,
    getFieldByXml,
    getProcessId,
    getSuccessLoadedIds,
    getUrlIssueAttachmentXML,
    getUrlIssueOfProjectByQueryId,
    parseDate,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue,
    sendToEKapModuleNewBPDocument,
    sleep,
    writeFailRecordXml,
    writeSuccessRecordXml
} from '../../utils'
import type {TCreateDocumentProccess, TFormProcessCustomDetail, TSectionFormDataInput, TXml} from '../../interfaces'
import {DB} from '../../services/db'

export class SceneTwo {
    private static page: Page

    constructor(page: Page) {
        SceneTwo.page = page
        SceneTwo.init()
    }

    public static async init() {
        try {
            const page = SceneTwo.page
            const ekapUrl = getEkapUrlPage()
            const xmlParser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false,
                trimValues: true
            })

            let totalRecords = 0

            await page.goto(ekapUrl, {waitUntil: 'networkidle0'})

            try {
                await page.type('input[name="username"]', getAuthEkapUsername())
                await page.type('input[name="password"]', getAuthEkapPass())

                await sleep(5000)

                await Promise.all([
                    page.click('button[type="submit"]'),
                    page.waitForNavigation({waitUntil: 'networkidle0'}),
                ])

                await sleep(2000)
            } catch {
                console.warn('Username or password element in DOM is not found, or you are already authorized.')
            }

            const ekapAccessToken = await page.evaluate(() => (localStorage.getItem('EKAP_APP_AUTH_TOKEN')))

            const db = new DB()

            const ENUM_FORM_COMPONENTS = {
                EKAP1_ID: 'EKAP1_ID',
                ORGANIZATION: 'organization',
                PERIOD: 'period',
                IS_MANDATORY: 'is_mandatory',
                FRANCHISE: 'franchise',
                START_DATE: 'start_date',
                END_DATE: 'end_date',
                STATUS: 'status1',
                TASK_DESCRIPTION: 'taskDescription',
                SYSTEM_DESCRIPTION: 'system_description',
                PROVIDER: 'Provider',
                NUMBER_OF_DOCUMENT: 'number_of_document',
                PURCHASING_METHOD: 'Purchasing_method',
                PLACE_GOODS: 'place_goods',
                TOTAL_SUM: 'total_sum',
                SUM: 'sum',
                PERCENT: 'percent',
                TOTAL_SUM_INSURED: 'Total_sum_insured',
                TOTAL_INSURENCE_AMOUNT_OF_CONTRACT: 'Total_insurence_amount_of_contract',
                SPECIAL_CONDITIONS: 'special_conditions',
                RESPONSIBLE_DEPARTMENT: 'responsible_department_F6',
            }

            const Iteration = async (projectId: string) => {
                const migrationInfo = {
                    failLoaded: 0,
                    countLoaded: 0,
                    allCountItems: 0,
                }

                const dzo = db.getDZO(projectId)
                const queryIds = dzo.getQueryIdsByForm6()

                for (const queryId of queryIds) {
                    console.log('Iteration ids', queryIds)
                    console.log('Iteration by projectId', `"${projectId}"`, 'queryId', `"${queryId}"`, '- starting')

                    if (!queryId) {
                        console.warn('F[Iteration] - Forced termination of the migration process.', '\nif (!queryId) { ... }')
                        return
                    }

                    const procedureMigration = async (pageIndex = 1) => {
                        console.log('Procedure migration by page', pageIndex, '- starting')
                        await page.goto(getUrlIssueOfProjectByQueryId(projectId, queryId, pageIndex), {waitUntil: 'networkidle0'})

                        const nodeLinks = await page.$$('table.list.issues td.id a')

                        if (!nodeLinks.length) {
                            console.warn('F[procedureMigration] - Forced termination of the migration process.', '\nif (!nodeLinks.length) { ... }')
                            return
                        }

                        const issueIds = await Promise.all(nodeLinks.map(async nodeLink => (
                            await page.evaluate(element => element.textContent?.trim(), nodeLink)
                        )))

                        totalRecords += issueIds.length

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

                        console.log('issue identifiers', issueIds.length, issueIds)

                        if (!issueIds.length) {
                            console.warn('F[procedureMigration] - Forced termination of the migration process.', '\nif (!issueIds.length) { ... }')
                            return
                        }

                        const ids = issueIds
                        const successLoadedList = await getSuccessLoadedIds()
                        const failedLoadedList = await getFailedLoadedIds()

                        await page.evaluate((migrationInfo, projectId, queryId) => {
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
                            labelElement.innerText = ` - - - The process of migrating data launched for projectId "${projectId}" queryId "${queryId}"... Entries migrate started ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}'}`

                            div.prepend(labelElement)
                            document.body.appendChild(div)
                        }, migrationInfo, projectId, queryId)

                        for (const selectedId of ids) {
                            if (!selectedId) {
                                console.log('skip not found selectedId', selectedId)
                                continue
                            }

                            if (successLoadedList.includes(selectedId)) {
                                migrationInfo.countLoaded++

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

                            if (failedLoadedList.includes(selectedId)) {
                                migrationInfo.failLoaded++

                                await page.evaluate((selectedId, migrationInfo) => {
                                    const logLabelElement = document.querySelector('div[data-log-label]')

                                    if (logLabelElement) {
                                        const labelElement = document.createElement('p')
                                        labelElement.style.fontSize = '12px'
                                        labelElement.style.padding = '2px 4px'
                                        labelElement.style.margin = '0'
                                        labelElement.style.color = '#ea9295'
                                        labelElement.innerText = ` - Issue ${selectedId} was is loaded as Failed [ERROR]; Left ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} entries.`
                                        logLabelElement.prepend(labelElement)
                                    }
                                }, selectedId, migrationInfo)
                                continue
                            }

                            // await page.goto(getUrlIssue(Number(selectedId)), { waitUntil: 'networkidle0' })

                            const xmlContent = await page.evaluate(async (xmlUrl) => {
                                try {
                                    const response = await fetch(xmlUrl, {
                                        "headers": {
                                            "accept": "*/*",
                                            "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
                                            "contenttype": "application/json",
                                            "datatype": "json",
                                            "sec-ch-ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
                                            "sec-ch-ua-mobile": "?0",
                                            "sec-ch-ua-platform": "\"macOS\"",
                                            "sec-fetch-dest": "empty",
                                            "sec-fetch-mode": "cors",
                                            "sec-fetch-site": "same-origin",
                                            "x-redmine-api-key": "02bc6557baef9963b64963f72d242b4e093d3352"
                                        },
                                        "referrer": "https://ekap.kazatomprom.kz/projects/zarechnoe_riskmanagement/issues?page=1&query_id=1046",
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
                            }, getUrlIssueAttachmentXML(Number(selectedId)))

                            console.log('issue id', selectedId, xmlContent ? 'XML Loaded' : 'XML not data loaded')

                            if (!xmlContent) {
                                await writeFailRecordXml(selectedId, issueIds)
                            } else {
                                const xmlObject = xmlParser.parse(xmlContent)

                                if (!xmlObject) continue
                                const xmlDocument = xmlObject as TXml

                                // await page.goto(getEkapUrlPageNew(), { waitUntil: 'networkidle0' })

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
                                    console.log('resProcessDetail', resProcessDetail.status, resProcessDetail.status === 200 ? 'bpm:successLoad' : '')

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
                                                    case ENUM_FORM_COMPONENTS.PERIOD:
                                                        fieldCode = '319'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.ORGANIZATION:
                                                        fieldCode = '29'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.TASK_DESCRIPTION:
                                                        fieldCode = '689'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.IS_MANDATORY:
                                                        fieldCode = '682'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.SYSTEM_DESCRIPTION:
                                                        fieldCode = '690'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.PROVIDER:
                                                        fieldCode = '691'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.NUMBER_OF_DOCUMENT:
                                                        fieldCode = '692'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.PURCHASING_METHOD:
                                                        fieldCode = '230'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.PLACE_GOODS:
                                                        fieldCode = '582'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.FRANCHISE:
                                                        fieldCode = '709'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.TOTAL_SUM:
                                                        fieldCode = '700'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.SUM:
                                                        fieldCode = '702'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.START_DATE:
                                                        fieldCode = '732'
                                                        break
                                                    case ENUM_FORM_COMPONENTS.END_DATE:
                                                        fieldCode = '733'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.PERCENT:
                                                        fieldCode = '785'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.TOTAL_SUM_INSURED:
                                                        fieldCode = '851'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.TOTAL_INSURENCE_AMOUNT_OF_CONTRACT:
                                                        fieldCode = '852'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.SPECIAL_CONDITIONS:
                                                        fieldCode = '853'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.RESPONSIBLE_DEPARTMENT:
                                                        fieldCode = '293'
                                                        break;
                                                    case ENUM_FORM_COMPONENTS.STATUS:
                                                    case ENUM_FORM_COMPONENTS.EKAP1_ID:
                                                        fieldCode = null

                                                        switch (key) {
                                                            case ENUM_FORM_COMPONENTS.STATUS:
                                                                value = putValueFromOptionsOrFieldValue(xmlDocument.issue.status['@_name'], options)
                                                                break;
                                                            case ENUM_FORM_COMPONENTS.EKAP1_ID:
                                                                value = xmlDocument.issue.id
                                                                break;
                                                            default:
                                                        }
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
                                                if (
                                                    (fieldCode === '732' && !Array.isArray(value) && key === ENUM_FORM_COMPONENTS.START_DATE) ||
                                                    (fieldCode === '733' && !Array.isArray(value) && key === ENUM_FORM_COMPONENTS.END_DATE)
                                                ) {
                                                    value = value ? parseDate(value) : ''
                                                }
                                                if (['DICTIONARY', 'RADIO', 'SELECT'].includes(type) && !Array.isArray(value)) value = [value]

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
                                console.log('body request', body)

                                let isSuccessfully = false

                                if (!FLAG_ERROR) {
                                    isSuccessfully = await sendToEKapModuleNewBPDocument(body, getProcessId(), ekapConfigRequest)
                                }

                                if (isSuccessfully) {
                                    migrationInfo.countLoaded++
                                    await writeSuccessRecordXml(selectedId, issueIds)
                                } else {
                                    migrationInfo.failLoaded++
                                    await writeFailRecordXml(selectedId, issueIds)
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

                            await page.goto(getUrlIssueOfProjectByQueryId(projectId, queryId, newPageIndex), {waitUntil: 'networkidle0'})
                            await procedureMigration(newPageIndex)
                        }

                        console.log('Procedure migration by page', pageIndex, `${isNextPage ? `We are redirecting you to the next page ${pageIndex + 1} to continue.` : ''}`, '- the iteration process is finished')
                    }

                    await procedureMigration()

                    await page.evaluate((migrationInfo, projectId, queryId) => {
                        const logLabelElement = document.querySelector('div[data-log-label]')

                        if (logLabelElement) {
                            const labelElement = document.createElement('p')
                            labelElement.style.fontSize = '10px'
                            labelElement.style.padding = '2px 4px'
                            labelElement.style.margin = '0'
                            labelElement.style.color = 'rgb(176 146 234)'
                            labelElement.innerText = ` - - - The process of migrating data completed for projectId "${projectId}" queryId "${queryId}". Entries migrate the page finish ${migrationInfo.countLoaded} of ${migrationInfo.allCountItems} and failed entries is ${migrationInfo.failLoaded}`
                            logLabelElement.prepend(labelElement)
                        }
                    }, migrationInfo, projectId, queryId)

                    console.log('Iteration by projectId', `"${projectId}"`, 'queryId', `"${queryId}"`, '- finished successfully')
                }
            }

            const projectList = db.getListByTable('ekap', 'projects')

            console.log('Project List', db.getListByTable('ekap', 'projects'))

            for (const {name} of projectList) {
                await Iteration(name)
            }

            console.log('Iteration migrate data done.')
            console.log('Total loaded records: ', totalRecords)
        } catch (e) {
            console.error(e)
        }

        console.log('SceneTwo done.')
    }
}
