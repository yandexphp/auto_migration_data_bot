export type TXml = {
    '?xml': {
        '@_version': string
        '@_encoding': string
    }
    issue: {
        id: string
        project: {
            '@_id': string
            '@_name': string
        }
        tracker: {
            '@_id': string
            '@_name': string
        }
        status: {
            '@_id': string
            '@_name': string
        }
        priority: {
            '@_id': string
            '@_name': string
        }
        author: {
            '@_id': string
            '@_name': string
        }
        subject: string
        description: string
        start_date: string
        due_date: string
        done_ratio: string
        is_private: string
        estimated_hours: string
        total_estimated_hours: string
        custom_fields: {
            '@_type': string
            custom_field: TCustom_field[]
        }
        created_on: string
        updated_on: string
        closed_on: string
        attachments: {
            '@_type': string
        }
    }
}

export type TCustom_field = {
    value: string
    '@_id': string
    '@_name': string
}

export type TCreateDocumentProccess = {
    approversDto: {
        approvers: []
        digitalSignature: string
        ordered: boolean
    }
    formDataDto: {
        sections: TSectionFormDataProccess[]
    }
    signersDto: {
        digitalSignature: string
        ordered: boolean
        signers: []
    }
}

export type TSectionFormDataProccess = {
    id: string
    inputs: TSectionFormDataInput[]
}

export type TSectionFormDataInput = {
    id: string
    value: string | string[]
}

export type TFormProcessCustomDetail = TFormProcessDetail & {
    formId: string
}

export type TFormProcessDetail = {
    id: string
    linkedFields: null
    name: string
    rootVersionId: string
    sections: TFormProcessSection[]
    version: number
}

export type TFormProcessSection = {
    defaultSection: boolean
    dynamicArea: boolean
    dynamicAreaButtonTitle: string
    dynamicAreaKey: null
    dynamicAreaNumerable: boolean
    dynamicAreaType: 'SECTIONS'
    id: string
    inputs: TFormProcessSectionInput[]
    order: number
    title: string
}

export type TFormProcessSectionInput = {
    accessConfig: {
        AUTHOR: string
    }
    accessType: string
    defaultInput: boolean
    id: string
    key: string
    order: number
    properties: {
        columnId?: string
        columnInputType?: string
        dictionaryId?: string
        options?: TFormProcessSectionPropInputOptionsItem[]
        layout: number
        selectType: string
    }
    required: null
    selectOptions: null
    title: string
    type: string
}

export type TFormProcessSectionPropInputOptionsItem = {
    label: string
    value: string
}
