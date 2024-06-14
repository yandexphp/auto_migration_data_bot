import { WebSocketServer, WebSocket } from 'ws'
import fs from 'node:fs'

import {notExistFileOfCreate} from '../src/utils'

interface IIssue {
    id: string
    issueId: string
    isError: boolean
    isMigrated: boolean
    isSavedOnDisk: boolean
}

interface ILocalState {
    issues: IIssue[]
}

interface IWebSocketMessage {
    type: EWebSocketEvent
    data: ILocalState
}

export enum EWebSocketEvent {
    PING = 'PING',
    PONG = 'PONG',
    ISSUE ='ISSUE'
}

const fileName = '../websocket-issues-dump.json'
await notExistFileOfCreate(fileName, '{ "issues": [] }')
const diskLocalData = JSON.parse(fs.readFileSync(fileName, 'utf-8') ?? '{ "issues": [] }')

const wss = new WebSocketServer({ port: 8080 })

let localState: ILocalState = {
    ...diskLocalData,
    issues: [
        ...(diskLocalData.issues ?? [])
    ]
}

wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({
        type: EWebSocketEvent.ISSUE,
        data: diskLocalData
    }))

    ws.on('message', (message: string) => {
        try {
            const { type, data } = JSON.parse(message) as IWebSocketMessage

            switch (type) {
                case EWebSocketEvent.ISSUE:
                    localState = {
                        ...localState,
                        ...data,
                        issues: [
                            ...localState.issues,
                            ...data.issues
                        ],
                    }

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: EWebSocketEvent.ISSUE,
                                data: localState
                            }))
                        }
                    })
                    break
                case EWebSocketEvent.PING:
                    ws.send(JSON.stringify({
                        type: EWebSocketEvent.PONG,
                    }))
                    break
                default:
                    console.warn('Default case of received message:', type, data)
            }
        } catch (e) {
            console.error(e)
        }
    })


    ws.on('ping', () => {
        console.log('ping')
    })

    ws.on('pong', () => {
        console.log('pong')
    })
})

console.log('WebSocket server started on ws://localhost:8080')

const cleanUp = () => {
    console.log('Cleaning up before exit...')
    wss.clients.forEach((client) => {
        client.close()
    })

    wss.close(() => {
        console.log('WebSocket server closed')
        process.exit(0)
    })
}

process.on('SIGINT', cleanUp)
process.on('SIGTERM', cleanUp)
process.on('exit', cleanUp)
