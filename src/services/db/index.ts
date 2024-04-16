import databaseStruct from '../../config/db.json'

type DbSchema = typeof databaseStruct

export class DB {
    private readonly db: DbSchema

    constructor() {
        this.db = databaseStruct
    }

    public getAll<K extends keyof DbSchema>(dbName: K) {
        return this.db[dbName]
    }

    public getListByTable<K extends keyof DbSchema, T extends keyof DbSchema[K]>(dbName: K, tableName: T) {
        return this.db?.[dbName]?.[tableName] ?? []
    }

    public getDZO(projectId: string) {
        return new DZO(this.db, projectId)
    }
}

class DZO {
    private readonly db: DbSchema
    private readonly projectId: string
    private cacheQueryId: string = ''

    constructor(databaseStruct: DbSchema, projectId: string) {
        this.db = databaseStruct
        this.projectId = projectId
    }

    protected getDZO() {
        return this.db.ekap.projects ?? []
    }

    getAll() {
        return this.getDZO() ?? []
    }

    getProjectId() {
        return this.projectId
    }

    getQueryIdsByForm5() {
        return this.getAll().find(({ name }) => name === this.getProjectId())?.form5?.split(',') ?? []
    }

    getQueryIdsByForm6() {
        return this.getAll().find(({ name }) => name === this.getProjectId())?.form6?.split(',') ?? []
    }

    getQueryIdsByForm7() {
        return this.getAll().find(({ name }) => name === this.getProjectId())?.form7?.split(',') ?? []
    }
}
