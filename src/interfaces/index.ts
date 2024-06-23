import {sendToEKapModuleNewDictionaryRecordContent, updateAuthorInEkapBPDocument} from "../utils";

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
        assigned_to?: {
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
        attachments: Attachments
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

export type TDictionaryFormDetails = {
    createdAt: string
    createdBy: {
        firstName: string
        fullName: string
        id: string
        lastName: string
        patronymicName: string | null
    }
    description: string
    id: string
    moduleId: string
    moduleName: string
    name: string
    rootVersionId: string
    sectionId: string
    sectionName: string
    sections: TDictionaryFormSection[]
}

export type TDictionaryFormSection = {
    defaultSection: boolean
    id: string
    inputs: TDictionaryFormSectionInputs[]
    order: number
    title: string
}

export type TDictionaryFormSectionInputs = {
    defaultInput: boolean
    id: string
    key: string | null
    order: number
    properties: {
        fieldCheckError: string
        helpText: string
        initialValue: string
        layout: number
        mask: string
        maxCharacterCheckError: string
        maxCheckError: string
        minCharacterCheckError: string
        minCheckError: string
        perceived: string
        placeholder: string
        tooltipText: string
        columnId: string
        columnInputType: string
        dictionaryId: string
        selectType: string
    }
    required: boolean
    title: string
    type: string
}

export type TXmlWithFiles = {
    issue: TXmlIssue
}

export type TXmlIssue = {
    id:                    string
    project:               EntityRef
    tracker:               EntityRef
    status:                EntityRef
    priority:              EntityRef
    author:                EntityRef
    subject:               string
    description:           string
    start_date:            string
    due_date:              string
    done_ratio:            string
    is_private:            string
    estimated_hours:       string
    total_estimated_hours: string
    created_on:            string
    updated_on:            string
    closed_on:             string
    attachments:           Attachments
}

export interface Attachments {
    attachment: Attachment
    "@_type":   string
}

export interface Attachment {
    id:           string
    filename:     string
    filesize:     string
    content_type: string
    description:  string
    content_url:  string
    author:       EntityRef
    created_on:   string
}

export interface EntityRef {
    "@_id":   string
    "@_name": string
}

export interface IAttachmentUploadFormData {
    file: File
    title: string
    bpId: string
    description: string
    url: string
    size: string
    filename: string
    userMetadata: string
    name: string
}

export interface IAttachmentUploaded {
    title: string
    description: string
    url: string
    size: number
    filename: string
    user_metadata: string
    bp_id: string
}

export type TXmlUserProfile = {
    "?xml": {
        "@_version": string
        "@_encoding": string
    }
    person: {
        person: {
            id: string
            login: string
            admin: string
            firstname: string
            lastname: string
            mail: string
            created_on: string
            last_login_on: string
            department: TXmlUserProfileDepartment[]
            custom_fields: {
                custom_field: TXmlUserProfileCustomField[]
            }
            phones: string
            mobile_phones: string
            address: string
            skype: string
            job_title: string
            middlename: string
            gender: string
            twitter: string
            facebook: string
            linkedin: string
            background: string
            is_system: string
        }
        attachments: {
            attachments: string[]
        }
        _total_count: string
        _offset: string
        _limit: string
    }
}

export type TXmlUserProfileDepartment = {
    _id: string
    _name: string
}

export type TXmlUserProfileCustomField = {
    _id: string
    _name: string
    value: string
}

export type TResponseUpdateAuthorInEkapBPDocument = {
    id: string
    processInstanceId: string
    userId: string
    userName: string
    userType: 'AUTHOR' | 'RESPONSIBLE' | 'SIGNER' | 'APPROVER'
    createdAt: string
}

export type TRequestUpdateAuthorInEkapBPDocument = Omit<TResponseUpdateAuthorInEkapBPDocument, 'id' | 'createdAt'>

export type TResponseSendToEKapModuleNewDictionaryRecordContent = {
    id: string
    dictionaryId: string
    dictionaryName: string
    isActual: boolean
    sectionEntries: TBodySectionDictionaryRecordContent[]
    createdAt: string
    createdBy: {
        id: string
        firstName: string
        lastName: string
        patronymicName: string | null
        fullName: string
    }
    updatedAt: null
    updatedBy: null
}

export interface TBodySectionDictionaryRecordContent {
    inputEntries: TBodyInputEntryDictionaryRecordContent[]
    sectionId: string | null
}

export interface TBodyInputEntryDictionaryRecordContent {
    inputId: string
    value: string | string[]
}
