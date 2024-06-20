import WebSocket from 'ws'
import {promises as fs} from 'fs'

import {notExistFileOfCreate} from '../utils'

export interface IIssue {
    id: string
    issueId: string
    isError: boolean
    isMigrated: boolean
    isSavedOnDisk: boolean
}

export interface ILocalState {
    issues: IIssue[]
}

export let WebSocketData: ILocalState = {
    issues: []
}

export interface IMessageIssue {
    type: EWebSocketEvent.ISSUE,
    data: ILocalState
}

export interface IMessageProcess {
    type: EWebSocketEvent.PROCESS_START | EWebSocketEvent.PROCESS_END | EWebSocketEvent.PROCESS_PENDING
    data: {
        process: {
            id: string
        }
    }
}

export interface IMessagePing {
    type: EWebSocketEvent.PING | EWebSocketEvent.PONG
    data: never
}

export interface ISocketResponseMessageProcess {
    type: EWebSocketEvent.PROCESS_START | EWebSocketEvent.PROCESS_END | EWebSocketEvent.PROCESS_PENDING
    data: {
        process: {
            id: string
            isPending: boolean
        }
    }
}

type TWebSocketMessage =
    | IMessageIssue
    | IMessageProcess
    | IMessagePing;

export let ws: WebSocket | null = null
export let WebSocketExit = false
export let WebSocketReconnectTime = 5000
export const WebSocketIp = '127.0.0.1'
export const WebSocketPort = 8080

export enum EWebSocketCloseStatus {
    NORMAL_CLOSURE = 1000,
    GOING_AWAY = 1001,
    PROTOCOL_ERROR = 1002,
    UNSUPPORTED_DATA = 1003,
    NO_STATUS_RECEIVED = 1005,
    ABNORMAL_CLOSURE = 1006,
    INVALID_FRAME_PAYLOAD_DATA = 1007,
    POLICY_VIOLATION = 1008,
    MESSAGE_TOO_BIG = 1009,
    MANDATORY_EXTENSION = 1010,
    INTERNAL_SERVER_ERROR = 1011
}

export enum EWebSocketEvent {
    PING = 'PING',
    PONG = 'PONG',
    ISSUE ='ISSUE',
    PROCESS_START = 'PROCESS_START',
    PROCESS_END = 'PROCESS_END',
    PROCESS_PENDING = 'PROCESS_PENDING',
}

export const WebSocketReconnect = () => {
    if(WebSocketExit) {
        return
    }

    setTimeout(WebSocketConnection, WebSocketReconnectTime)
}

export const WebSocketClose = () => {
    WebSocketExit = true

    if(ws) {
        ws.close(EWebSocketCloseStatus.NORMAL_CLOSURE)
        ws = null
    }
}

const startPing = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const ping = () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('WebSocketData', WebSocketData)
                console.info('WebSocket', EWebSocketEvent.PING)
                ws.send(JSON.stringify({
                    type: EWebSocketEvent.PING
                }))
            }
        }

        ping()

        const pingInterval = setInterval(() => {
            if (ws) {
                ping()
            } else {
                clearInterval(pingInterval)
            }
        }, 15000)
    }
}

export const WebSocketConnection = () => {
    if(WebSocketExit) {
        return ws
    } else if (!ws || (ws instanceof WebSocket && ws.readyState === WebSocket.CLOSED)) {
        ws = new WebSocket(`ws://${WebSocketIp}:${WebSocketPort}`)

        ws.on('open', () => {
            console.log('Connected to WebSocket server')
            startPing()
        })

        ws.on('message', (message: string) => {
            try {
                const { type, data } = JSON.parse(message) as TWebSocketMessage

                switch (type) {
                    case EWebSocketEvent.ISSUE:
                        WebSocketData = data
                        writeDump(WebSocketData)
                        break
                    case EWebSocketEvent.PING:
                        console.info('WebSocket', EWebSocketEvent.PING)
                        break
                    case EWebSocketEvent.PONG:
                        console.info('WebSocket', EWebSocketEvent.PONG)
                        break
                    case EWebSocketEvent.PROCESS_START:
                        console.info('WebSocket', EWebSocketEvent.PROCESS_START, data)
                        break
                    case EWebSocketEvent.PROCESS_END:
                        console.info('WebSocket', EWebSocketEvent.PROCESS_END, data)
                        break
                    case EWebSocketEvent.PROCESS_PENDING:
                        console.info('WebSocket', EWebSocketEvent.PROCESS_PENDING, data)
                        break
                    default:
                        console.warn('Default case of received message:', type, data)
                }
            } catch (e) {
                console.error(e)
            }
        })

        ws.on('close', () => {
            console.log('WebSocket connection closed. Attempting to reconnect...')
            WebSocketReconnect()
        })

        ws.on('error', (error) => {
            console.error('WebSocket', error)
            if (ws?.readyState === WebSocket.CLOSED) {
                WebSocketReconnect()
            }
        })
    }

    return ws
}

const filterUniqueById = (issues: IIssue[]): IIssue[] => {
    const issueMap = new Map<string, IIssue>()

    issues.forEach(issue => {
        issueMap.set(issue.issueId, issue)
    })

    return Array.from(issueMap.values())
}

const writeDump = async (data: ILocalState) => {
    try {
        const fileName = 'websocket-issues-dump.json'

        await notExistFileOfCreate(fileName, '{}')

        const fileData = await fs.readFile(fileName, 'utf-8') ?? '{}'
        const jsonData = JSON.parse(fileData)

        const oldIssues = jsonData.issues ?? []
        const newIssues = data.issues ?? []

        const newData = {
            ...jsonData,
            ...data,
            issues: filterUniqueById([
                ...oldIssues,
                ...newIssues
            ])
        }

        await fs.writeFile(fileName, JSON.stringify(newData), 'utf-8')
    } catch (e) {
        console.error('writeDump', e)
    }
}

export const WebSocketDispatch = <T extends TWebSocketMessage>(
    request: TWebSocketMessage,
    funcCondition?: (data: T) => boolean
): Promise<T> => {
    return new Promise((resolve, reject) => {
        try {
            const onMessageDispatch = (message: string) => {
                const socketMessage = JSON.parse(message) as TWebSocketMessage
                const { type } = socketMessage

                if (type === request.type && !funcCondition) {
                    resolve((() => {
                        WebSocketConnection()?.off('message', onMessageDispatch)
                        return socketMessage as T
                    })())
                } else if (type === request.type && funcCondition && funcCondition(socketMessage as T)) {
                    resolve((() => {
                        WebSocketConnection()?.off('message', onMessageDispatch)
                        return socketMessage as T
                    })())
                }
            }

            WebSocketConnection()?.on('message', onMessageDispatch)
            WebSocketConnection()?.send(JSON.stringify(request))
        } catch (e) {
            console.error(e)
            reject(null)
        }
    })
}
