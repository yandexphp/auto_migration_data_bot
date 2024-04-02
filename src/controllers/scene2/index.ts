import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'

import {
    getAuthEkapPass,
    getAuthEkapUsername,
    getEkapUrlAPI,
    getEkapUrlPage,
    getEkapUrlPageNew,
    getFieldByXml,
    getProcessId,
    getProjectId,
    getQueryId,
    getUrlIssue,
    getUrlIssueAttachmentXML,
    getUrlIssueOfProjectByQueryId,
    parseDateRange,
    putValueFromDictionaryOrFieldValue,
    putValueFromOptionsOrFieldValue, sendToEKapModuleNewBPDocument,
    sleep,
    writeFailRecordXml, writeSuccessRecordXml
} from '../../utils'
import type {TCreateDocumentProccess, TFormProcessCustomDetail, TSectionFormDataInput, TXml} from './interfaces.ts'

export class SceneSecond {
    private static page: Page

    constructor(page: Page) {
        SceneSecond.page = page
        SceneSecond.init()
    }

    public static async init() {
        try {
            const page = SceneSecond.page
            const projectId = getProjectId()
            const ekapUrl = getEkapUrlPage()
            const xmlParser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false,
                trimValues: true
            })

            await page.goto(ekapUrl, { waitUntil: 'networkidle0' })

            try {
                await page.type('input[name="username"]', getAuthEkapUsername())
                await page.type('input[name="password"]', getAuthEkapPass())

                await sleep(5000)

                await Promise.all([
                    page.click('button[type="submit"]'),
                    page.waitForNavigation({ waitUntil: 'networkidle0' }),
                ])
            } catch {
                console.warn('username or password element not found')
            }

            const ekapAccessToken = await page.evaluate(() => (localStorage.getItem('EKAP_APP_AUTH_TOKEN')))

            await page.goto(getUrlIssueOfProjectByQueryId(projectId, getQueryId()), { waitUntil: 'networkidle0' })

            const perPages = await page.$$('.pagination .per-page a')
            const maxPerPage = await page.evaluate(element => parseInt(element?.textContent?.trim() ?? ''), perPages[perPages.length - 1])

            if(perPages.length > 1 && !isNaN(maxPerPage) && maxPerPage > 0) {
                await page.goto(getUrlIssueOfProjectByQueryId(projectId, getQueryId(), maxPerPage), { waitUntil: 'networkidle0' })
            }

            const nodeLinks = await page.$$('table.list.issues td.id a')

            if(!nodeLinks.length) return

            const issueIds = await Promise.all(nodeLinks.map(async nodeLink => (
                await page.evaluate(element => element.textContent?.trim(), nodeLink)
            )))

            console.log('issue identifiers', issueIds.length, issueIds)

            if(!issueIds.length) return

            const ids = issueIds.splice(0, 3)

            await page.evaluate(() => {
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
                labelElement.innerText = ` - - - The process of migrating data launched...'}`

                div.prepend(labelElement)
                document.body.appendChild(div)
            })

            for (const selectedId of ids) {
                if(!selectedId) continue

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

                if(!xmlContent) {
                    await writeFailRecordXml(selectedId, issueIds)
                } else {
                    const xmlObject = xmlParser.parse(xmlContent)

                    if(!xmlObject) continue;
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
                    } as RequestInit

                    const formProcessDetail = await page.evaluate(async (processId, ekapApiUrl, ekapConfigRequest) => {
                        const resProcessDetail = await fetch(`${ekapApiUrl}/bpm/definition/bp/${processId}`, ekapConfigRequest)
                        const { formId } = await resProcessDetail.json()

                        const resFormDetail = await fetch(`${ekapApiUrl}/form/${formId}`, ekapConfigRequest)
                        const { ...rest } = await resFormDetail.json()

                        return { formId, ...rest } as TFormProcessCustomDetail
                    }, getProcessId(), getEkapUrlAPI(), ekapConfigRequest)

                    await Promise.all(formProcessDetail.sections.map(async ({ id: sectionId, inputs }) => {
                        const sectionInputs = [] as TSectionFormDataInput[]

                        const inputsList = await Promise.all(inputs.map(async ({ id, key, title, accessType, type, properties: { columnId = null, options = null } }) => {
                            let value = '' as string | string[]
                            let fieldCode = '' as string | null

                            switch(key) {
                                case 'organization': fieldCode = '29'; break;
                                case 'period': fieldCode = '319'; break;
                                case 'insurance': fieldCode = '720'; break;
                                case 'is_mandatory': fieldCode = '682'; break;
                                case 'Policyholder': fieldCode = '683'; break;
                                case 'main_activities': fieldCode = '684'; break;
                                case 'information_about_the_object': fieldCode = '685'; break;
                                case 'franchise': fieldCode = '709'; break;
                                case 'necessity_to_include_fund': fieldCode = '686'; break;
                                case 'insurance_territor':
                                case 'insurance_territory':
                                    fieldCode = '687';
                                    break;
                                case 'insurance_premium': fieldCode = '702'; break;
                                case 'Insurance_period': fieldCode = '734'; break;
                                case 'Insurance_premium_sum': fieldCode = '740'; break;
                                case 'terms_of_payment': fieldCode = '853'; break;
                                case 'status1':
                                    fieldCode = null;
                                    break;
                                default:
                                    console.warn('continue by key', key)
                                    return;
                            }

                            if(fieldCode === null) {
                                if(key === 'status1') {
                                    value = putValueFromOptionsOrFieldValue(xmlDocument.issue.status['@_name'], options)
                                }
                            }

                            if(fieldCode) {
                                const fieldValueByXml = getFieldByXml(xmlDocument, fieldCode)

                                if(options) {
                                    value = putValueFromOptionsOrFieldValue(fieldValueByXml, options)
                                } else {
                                    value = await putValueFromDictionaryOrFieldValue(fieldValueByXml, fieldCode, columnId, ekapConfigRequest)
                                }
                            }

                            if(accessType === 'REQUIRED' && !value) value = ' '
                            if(fieldCode === '734' && !Array.isArray(value)) value = parseDateRange(value)?.startDate // 734 is Date field
                            if(['DICTIONARY', 'RADIO'].includes(type) && !Array.isArray(value)) value = [value]

                            return { id, value }
                        }))

                        const inputsListFilter = inputsList.filter(Boolean) as TSectionFormDataInput[]

                        sectionInputs.push(...inputsListFilter)
                        body.formDataDto.sections.push({ id: sectionId, inputs: sectionInputs })
                    }))

                    const isSuccessfully = await sendToEKapModuleNewBPDocument(body, getProcessId(), ekapConfigRequest)
                    console.log('isSuccessfully', isSuccessfully)

                    if(isSuccessfully) {
                        await writeSuccessRecordXml(selectedId, issueIds)
                    }

                    await page.evaluate((body, isSuccessfully, selectedId, processId) => {
                        const logLabelElement = document.querySelector('div[data-log-label]')

                        if(logLabelElement) {
                            const labelElement = document.createElement('p')
                            labelElement.style.fontSize = '12px'
                            labelElement.style.padding = '2px 4px'
                            labelElement.style.margin = '0'
                            labelElement.style.color = '#' + (isSuccessfully ? '92eaa0' :'ea9295')
                            labelElement.innerText = ` - Issue ${selectedId} in process ${processId} a create new item is - ${isSuccessfully ? 'Success [OK]' : 'Failed [ERROR]'}`
                            logLabelElement.prepend(labelElement)
                        }

                        console.log('isSuccessfully', isSuccessfully, body)
                    }, body, isSuccessfully, selectedId, getProcessId())
                }

                await sleep(1000)
            }

            await page.evaluate(() => {
                const logLabelElement = document.querySelector('div[data-log-label]')

                if(logLabelElement) {
                    const labelElement = document.createElement('p')
                    labelElement.style.fontSize = '10px'
                    labelElement.style.padding = '2px 4px'
                    labelElement.style.margin = '0'
                    labelElement.style.color = 'rgb(176 146 234)'
                    labelElement.innerText = ` - - - The process of migrating data completed.'}`
                    logLabelElement.prepend(labelElement)
                }
            })
        } catch (e)  {
            console.error(e)
        }
    }
}
