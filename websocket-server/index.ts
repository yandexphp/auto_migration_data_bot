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

interface ILocalStateProcess {
    pending: string[]
}

interface IMessageIssue {
    type: EWebSocketEvent.ISSUE,
    data: ILocalState
}

interface IMessageProcess {
    type: EWebSocketEvent.PROCESS_START | EWebSocketEvent.PROCESS_END | EWebSocketEvent.PROCESS_PENDING
    data: {
        process: {
            id: string
        }
    }
}

interface IMessagePing {
    type: EWebSocketEvent.PING | EWebSocketEvent.PONG
    data: unknown
}

type TWebSocketMessage =
    | IMessageIssue
    | IMessageProcess
    | IMessagePing;

export enum EWebSocketEvent {
    PING = 'PING',
    PONG = 'PONG',
    ISSUE ='ISSUE',
    PROCESS_START = 'PROCESS_START',
    PROCESS_END = 'PROCESS_END',
    PROCESS_PENDING = 'PROCESS_PENDING',
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

const localStateProcess: ILocalStateProcess = {
    pending: []
}

wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({
        type: EWebSocketEvent.ISSUE,
        data: diskLocalData
    }))

    ws.on('message', (message: string) => {
        try {
            const { type, data } = JSON.parse(message) as TWebSocketMessage

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
                case EWebSocketEvent.PROCESS_START:
                    if(!localStateProcess.pending.includes(data.process.id)) {
                        localStateProcess.pending.push(data.process.id)
                        console.log('WebSocket Server', EWebSocketEvent.PROCESS_START, 'Add process', data.process.id)
                    }

                    ws.send(JSON.stringify({
                        type: EWebSocketEvent.PROCESS_START,
                        data: {
                            process: {
                                id: data.process.id
                            }
                        }
                    }))
                    break
                case EWebSocketEvent.PROCESS_END:
                    if(localStateProcess.pending.includes(data.process.id)) {
                        localStateProcess.pending.splice(localStateProcess.pending.findIndex(processId => processId === data.process.id), 1)
                        console.log('WebSocket Server', EWebSocketEvent.PROCESS_END, 'Remove process', data.process.id)
                    }

                    ws.send(JSON.stringify({
                        type: EWebSocketEvent.PROCESS_END,
                        data: {
                            process: {
                                id: data.process.id
                            }
                        }
                    }))
                    break
                case EWebSocketEvent.PROCESS_PENDING:
                    console.log('WebSocket Server', EWebSocketEvent.PROCESS_PENDING, 'Status process', {
                        process: {
                            id: data.process.id,
                            isPending: localStateProcess.pending.includes(data.process.id)
                        }
                    })

                    ws.send(JSON.stringify({
                        type: EWebSocketEvent.PROCESS_PENDING,
                        data: {
                            process: {
                                id: data.process.id,
                                isPending: localStateProcess.pending.includes(data.process.id)
                            }
                        }
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
