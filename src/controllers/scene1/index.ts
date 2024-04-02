import type {Page} from 'puppeteer'
import {XMLParser} from 'fast-xml-parser'

import {
    getAuthEkapPass,
    getAuthEkapUsername,
    getEkapUrlPage, getEkapUrlPageNew, getProjectId, getUrlIssue,
    getUrlIssueAttachmentXML,
    getUrlIssuesListByProject,
    sleep,
    writeFailRecordXml
} from '../../utils'
import type {TCreateDocumentProccess, TXml} from './interfaces.ts'

export class SceneOne {
    private static page: Page

    constructor(page: Page) {
        SceneOne.page = page
        SceneOne.init()
    }

    public static async init() {
        try {
            const page = SceneOne.page
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

            await page.goto(getUrlIssuesListByProject(projectId), { waitUntil: 'networkidle0' })

            const perPages = await page.$$('.pagination .per-page a')
            const maxPerPage = await page.evaluate(element => parseInt(element?.textContent?.trim() ?? ''), perPages[perPages.length - 1])

            if(perPages.length > 1 && !isNaN(maxPerPage) && maxPerPage > 0) {
                await page.goto(getUrlIssuesListByProject(projectId, maxPerPage), { waitUntil: 'networkidle0' })
            }

            const nodeLinks = await page.$$('table.list.issues td.id a')

            if(!nodeLinks.length) return

            const issueIds = await Promise.all(nodeLinks.map(async nodeLink => (
                await page.evaluate(element => element.textContent?.trim(), nodeLink)
            )))

            console.log('issue identifiers', issueIds)

            if(!issueIds.length) return

            const ids = ['581334']

            for (const selectedId of ids) {
                if(!selectedId) continue

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

                await page.goto(getUrlIssue(Number(selectedId)), { waitUntil: 'networkidle0' })

                const xmlUrl = getUrlIssueAttachmentXML(Number(selectedId))
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
                }, xmlUrl)

                console.log('issue id selected', selectedId, xmlContent ? 'XML Loaded' : 'XML not data loaded')

                if(!xmlContent) {
                    await writeFailRecordXml(selectedId, issueIds)
                } else {
                    const xmlObject = xmlParser.parse(xmlContent)

                    if(!xmlObject) continue;
                    const { issue: issueXML } = xmlObject as TXml

                    await page.goto(getEkapUrlPageNew(), { waitUntil: 'networkidle0' })

                    const components = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('[name*=sections]')).map(node => {
                            const exp = node.getAttribute('name')?.split('.')
                            const inputKey = node.getAttribute('inputkey') ?? ''
                            return {
                                section: exp?.[1] ?? '',
                                id: exp?.[2] ?? '',
                                inputKey,
                            }
                        })
                    })

                    components.forEach(({ section, id, inputKey }) => {
                        const foundSectionIdx = body.formDataDto.sections.findIndex(({ id }) => id === section)

                        if(foundSectionIdx === -1) {
                            body.formDataDto.sections.push({
                                id: section,
                                inputs: []
                            })
                        }

                        let value = ''

                        switch (inputKey) {
                            case 'theme': value = issueXML.subject ?? ''; break;
                            case 'description': value = issueXML.description ?? ''; break;
                            default: value = ''
                        }

                        body.formDataDto.sections[foundSectionIdx]?.inputs.push({ id, value })
                    })

                    await page.evaluate((body) => {
                        console.log('body', body)
                    }, body)
                }

                await sleep(1000)
            }
        } catch (e)  {
            console.error(e)
        }
    }
}
