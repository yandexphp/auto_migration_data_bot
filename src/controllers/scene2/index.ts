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
    parseDateRange,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue,
    sendToEKapModuleNewBPDocument,
    sleep,
    writeFailRecordXml,
    writeSuccessRecordXml
} from '../../utils'
import type {TCreateDocumentProccess, TFormProcessCustomDetail, TSectionFormDataInput, TXml} from './interfaces.ts'
import {DB} from '../../services/db'

export class SceneSecond {
    private static page: Page

    constructor(page: Page) {
        SceneSecond.page = page
        SceneSecond.init()
    }

    public static async init() {
        try {
            const page = SceneSecond.page
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

            console.log('React Frontend eKap accessToken', ekapAccessToken)

            const db = new DB()

            const Iteration = async (projectId: string) => {
                const migrationInfo = {
                    failLoaded: 0,
                    countLoaded: 0,
                    allCountItems: 0,
                }

                const dzo = db.getDZO(projectId)
                const queryId = dzo.getQueryId()

                console.log('Iteration by projectId', `"${projectId}"`, 'queryId', `"${queryId}"`, '- starting')

                if(!queryId) {
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

                    // const isN document.querySelector('li.next.page')

                    console.log('issue identifiers', issueIds.length, issueIds)

                    if (!issueIds.length) {
                        console.warn('F[procedureMigration] - Forced termination of the migration process.', '\nif (!issueIds.length) { ... }')
                        return
                    }

                    const ids = issueIds.splice(1)

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
                                    headers: {
                                        'accept': '*/*',
                                        'accept-language': 'ru,ru-RU;q=0.9,en-US;q=0.8,en;q=0.7',
                                        'contenttype': 'application/json',
                                        'datatype': 'json',
                                        'if-none-match': 'W/"dda50ab0a6e22949702fb9cbd6ba22a6-gzip"',
                                        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                                        'sec-ch-ua-mobile': '?0',
                                        'sec-ch-ua-platform': '"Windows"',
                                        'sec-fetch-dest': 'empty',
                                        'sec-fetch-mode': 'cors',
                                        'sec-fetch-site': 'same-origin',
                                        'x-redmine-api-key': 'f7b6ff8906e7374faf31fff2d99486a8901df198'
                                    },
                                    referrerPolicy: 'strict-origin-when-cross-origin',
                                    mode: 'cors',
                                    credentials: 'include'
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

                            if (!xmlObject) continue;
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

                                const {formId} = await resProcessDetail.json()

                                const resFormDetail = await fetch(`${ekapApiUrl}/form/${formId}`, ekapConfigRequest)
                                console.log('resFormDetail', resFormDetail.status, resFormDetail.status === 200 ? 'form:successLoad' : '')

                                const {...rest} = await resFormDetail.json()

                                return {formId, ...rest} as TFormProcessCustomDetail
                            }, getProcessId(), getEkapUrlAPI(), ekapConfigRequest)

                            let FLAG_ERROR = false

                            try {
                                await Promise.all(formProcessDetail.sections.map(async ({id: sectionId, inputs}) => {
                                    const sectionInputs = [] as TSectionFormDataInput[]

                                    const inputsList = await Promise.all(inputs.map(async ({ id, key, accessType, type, properties: { columnId = null, options = null }}) => {
                                        try {
                                            let value = '' as string | string[]
                                            let fieldCode = '' as string | null

                                            switch (key) {
                                                case 'organization':
                                                    fieldCode = '29';
                                                    break;
                                                case 'period':
                                                    fieldCode = '319';
                                                    break;
                                                case 'insurance':
                                                    fieldCode = '720';
                                                    break;
                                                case 'is_mandatory':
                                                    fieldCode = '682';
                                                    break;
                                                case 'Policyholder':
                                                    fieldCode = '683';
                                                    break;
                                                case 'main_activities':
                                                    fieldCode = '684';
                                                    break;
                                                case 'information_about_the_object':
                                                    fieldCode = '685';
                                                    break;
                                                case 'franchise':
                                                    fieldCode = '709';
                                                    break;
                                                case 'necessity_to_include_fund':
                                                    fieldCode = '686';
                                                    break;
                                                case 'insurance_territor':
                                                case 'insurance_territory':
                                                    fieldCode = '687';
                                                    break;
                                                case 'insurance_premium':
                                                    fieldCode = '702';
                                                    break;
                                                case 'start_date':
                                                case 'end_date':
                                                    fieldCode = '734';
                                                    break;
                                                case 'Insurance_premium_sum':
                                                    fieldCode = '740';
                                                    break;
                                                case 'terms_of_payment':
                                                    fieldCode = '853';
                                                    break;
                                                case 'status1':
                                                    fieldCode = null;
                                                    break;
                                                default:
                                                    console.warn('continue by key', key)
                                                    return;
                                            }

                                            if (fieldCode === null) {
                                                if (key === 'status1') {
                                                    value = putValueFromOptionsOrFieldValue(xmlDocument.issue.status['@_name'], options)
                                                }
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
                                            if (fieldCode === '734' && !Array.isArray(value) && key === 'start_date') value = parseDateRange(value)?.startDate // 734 is Date field
                                            if (fieldCode === '734' && !Array.isArray(value) && key === 'end_date') value = parseDateRange(value)?.endDate // 734 is Date field
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

                            let isSuccessfully = false

                            if(!FLAG_ERROR) {
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

                    console.log('Procedure migration by page', pageIndex, `${isNextPage ? `We are redirecting you to the next page ${pageIndex + 1} to continue.`: ''}`, '- the iteration process is finished')
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

            const projectList = db.getListByTable('ekap', 'projects')

            console.log('Project List', db.getListByTable('ekap', 'projects'))

            for (const { name } of projectList) {
                await Iteration(name)
            }

            console.log('Iteration migrate data done.')
        } catch (e) {
            console.error(e)
        }

        console.log('SceneOne done.')
    }
}
