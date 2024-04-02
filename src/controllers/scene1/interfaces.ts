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
    value: string
}
