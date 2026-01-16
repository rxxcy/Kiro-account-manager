// Kiro API 调用核心模块
import { v4 as uuidv4 } from 'uuid'
import type {
  KiroPayload,
  KiroUserInputMessage,
  KiroHistoryMessage,
  KiroToolWrapper,
  KiroToolResult,
  KiroImage,
  KiroToolUse,
  ProxyAccount
} from './types'

// Kiro API 端点配置
const KIRO_ENDPOINTS = [
  {
    url: 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'AI_EDITOR',
    amzTarget: 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    name: 'CodeWhisperer'
  },
  {
    url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'CLI',
    amzTarget: 'AmazonQDeveloperStreamingService.SendMessage',
    name: 'AmazonQ'
  }
]

// User-Agent 配置 - Social 认证方式
const KIRO_USER_AGENT = 'aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.6.18'
const KIRO_AMZ_USER_AGENT = 'aws-sdk-js/1.0.18 KiroIDE-0.6.18'

// User-Agent 配置 - IDC 认证方式 (Amazon Q CLI 样式)
const KIRO_CLI_USER_AGENT = 'aws-sdk-rust/1.3.9 os/macos lang/rust/1.87.0'
const KIRO_CLI_AMZ_USER_AGENT = 'aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/macos lang/rust/1.87.0 m/E app/AmazonQ-For-CLI'

// Agent 模式
const AGENT_MODE_SPEC = 'spec' // IDE 模式
const AGENT_MODE_VIBE = 'vibe' // CLI 模式

// Agentic 模式系统提示 - 防止大文件写入超时
const AGENTIC_SYSTEM_PROMPT = `# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation.`

// Thinking 模式标签
const THINKING_MODE_PROMPT = `<thinking_mode>enabled</thinking_mode>
<max_thinking_length>200000</max_thinking_length>`

// 模型 ID 映射
const MODEL_ID_MAP: Record<string, string> = {
  'gpt-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'gpt-4o': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'gpt-4-turbo': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'gpt-3.5-turbo': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-3-5-sonnet': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-3-opus': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-3-sonnet': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-3-haiku': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-sonnet-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'default': 'anthropic.claude-sonnet-4-20250514-v1:0'
}

export function mapModelId(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_ID_MAP)) {
    if (lower.includes(key)) {
      return value
    }
  }
  return MODEL_ID_MAP.default
}

// 检测是否为 Agentic 模式请求
export function isAgenticRequest(model: string, tools?: unknown[]): boolean {
  const lower = model.toLowerCase()
  // 模型名称包含 -agentic 或有工具调用
  return lower.includes('-agentic') || lower.includes('agentic') || Boolean(tools && tools.length > 0)
}

// 检测是否启用 Thinking 模式
export function isThinkingEnabled(headers?: Record<string, string>): boolean {
  if (!headers) return false
  // 检查 Anthropic-Beta 头是否包含 thinking
  const betaHeader = headers['anthropic-beta'] || headers['Anthropic-Beta'] || ''
  return betaHeader.toLowerCase().includes('thinking')
}

// 注入系统提示
export function injectSystemPrompts(
  content: string,
  isAgentic: boolean,
  thinkingEnabled: boolean
): string {
  let result = content
  
  // 注入时间戳
  const timestamp = new Date().toISOString()
  const timestampPrompt = `Current time: ${timestamp}`
  
  // 注入 Thinking 模式（必须在最前面）
  if (thinkingEnabled) {
    result = THINKING_MODE_PROMPT + '\n\n' + result
  }
  
  // 注入 Agentic 模式提示
  if (isAgentic) {
    result = result + '\n\n' + AGENTIC_SYSTEM_PROMPT
  }
  
  // 注入时间戳
  result = timestampPrompt + '\n\n' + result
  
  return result
}

// 构建 Kiro API 请求负载
export function buildKiroPayload(
  content: string,
  modelId: string,
  origin: string,
  history: KiroHistoryMessage[] = [],
  tools: KiroToolWrapper[] = [],
  toolResults: KiroToolResult[] = [],
  images: KiroImage[] = [],
  profileArn?: string,
  inferenceConfig?: { maxTokens?: number; temperature?: number; topP?: number }
): KiroPayload {
  const userInputMessage: KiroUserInputMessage = {
    content,
    modelId,
    origin
  }

  if (images.length > 0) {
    userInputMessage.images = images
  }

  if (tools.length > 0 || toolResults.length > 0) {
    userInputMessage.userInputMessageContext = {}
    if (tools.length > 0) {
      userInputMessage.userInputMessageContext.tools = tools
    }
    if (toolResults.length > 0) {
      userInputMessage.userInputMessageContext.toolResults = toolResults
    }
  }

  const payload: KiroPayload = {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage
      }
    }
  }

  if (history.length > 0) {
    payload.conversationState.history = history
  }

  if (profileArn) {
    payload.profileArn = profileArn
  }

  if (inferenceConfig && (inferenceConfig.maxTokens || inferenceConfig.temperature !== undefined || inferenceConfig.topP !== undefined)) {
    payload.inferenceConfig = {}
    if (inferenceConfig.maxTokens) {
      payload.inferenceConfig.maxTokens = inferenceConfig.maxTokens
    }
    if (inferenceConfig.temperature !== undefined) {
      payload.inferenceConfig.temperature = inferenceConfig.temperature
    }
    if (inferenceConfig.topP !== undefined) {
      payload.inferenceConfig.topP = inferenceConfig.topP
    }
  }

  return payload
}

// 获取认证方式对应的请求头
function getAuthHeaders(account: ProxyAccount, endpoint: typeof KIRO_ENDPOINTS[0]): Record<string, string> {
  const isIDC = account.authMethod === 'idc'
  
  return {
    'Content-Type': 'application/x-amz-json-1.0',
    'Accept': '*/*',
    'X-Amz-Target': endpoint.amzTarget,
    'User-Agent': isIDC ? KIRO_CLI_USER_AGENT : KIRO_USER_AGENT,
    'X-Amz-User-Agent': isIDC ? KIRO_CLI_AMZ_USER_AGENT : KIRO_AMZ_USER_AGENT,
    'x-amzn-kiro-agent-mode': isIDC ? AGENT_MODE_VIBE : AGENT_MODE_SPEC,
    'x-amzn-codewhisperer-optout': 'true',
    'Amz-Sdk-Request': 'attempt=1; max=3',
    'Amz-Sdk-Invocation-Id': uuidv4(),
    'Authorization': `Bearer ${account.accessToken}`
  }
}

// 获取排序后的端点列表（根据首选端点配置）
function getSortedEndpoints(preferredEndpoint?: 'codewhisperer' | 'amazonq'): typeof KIRO_ENDPOINTS {
  if (!preferredEndpoint) return [...KIRO_ENDPOINTS]
  
  const sorted = [...KIRO_ENDPOINTS]
  const preferredName = preferredEndpoint === 'codewhisperer' ? 'CodeWhisperer' : 'AmazonQ'
  
  sorted.sort((a, b) => {
    if (a.name === preferredName) return -1
    if (b.name === preferredName) return 1
    return 0
  })
  
  return sorted
}

// 调用 Kiro API（流式）
export async function callKiroApiStream(
  account: ProxyAccount,
  payload: KiroPayload,
  onChunk: (text: string, toolUse?: KiroToolUse) => void,
  onComplete: (usage: { inputTokens: number; outputTokens: number }) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
): Promise<void> {
  const endpoints = getSortedEndpoints(preferredEndpoint)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      // 更新 payload 中的 origin
      if (payload.conversationState.currentMessage.userInputMessage) {
        payload.conversationState.currentMessage.userInputMessage.origin = endpoint.origin
      }

      const headers = getAuthHeaders(account, endpoint)
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      })

      if (response.status === 429) {
        console.log(`[KiroAPI] Endpoint ${endpoint.name} quota exhausted, trying next...`)
        lastError = new Error(`Quota exhausted on ${endpoint.name}`)
        continue
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.text()
        throw new Error(`Auth error ${response.status}: ${body}`)
      }

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`API error ${response.status}: ${body}`)
      }

      // 解析 Event Stream
      await parseEventStream(response.body!, onChunk, onComplete, onError)
      return
    } catch (error) {
      lastError = error as Error
      console.error(`[KiroAPI] Endpoint ${endpoint.name} failed:`, error)
      
      // 如果是认证错误，不继续尝试其他端点
      if ((error as Error).message.includes('Auth error')) {
        throw error
      }
    }
  }

  if (lastError) {
    onError(lastError)
  }
}

// 解析 AWS Event Stream 二进制格式
async function parseEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string, toolUse?: KiroToolUse) => void,
  onComplete: (usage: { inputTokens: number; outputTokens: number }) => void,
  onError: (error: Error) => void
): Promise<void> {
  const reader = body.getReader()
  let buffer = new Uint8Array(0)
  let accumulatedContent = ''
  let toolUses: KiroToolUse[] = []
  let usage = { inputTokens: 0, outputTokens: 0 }

  try {
    while (true) {
      const { done, value } = await reader.read()
      
      if (done) {
        break
      }

      // 合并缓冲区
      const newBuffer = new Uint8Array(buffer.length + value.length)
      newBuffer.set(buffer)
      newBuffer.set(value, buffer.length)
      buffer = newBuffer

      // 尝试解析消息
      while (buffer.length >= 16) {
        // AWS Event Stream 格式：
        // - 4 bytes: total length
        // - 4 bytes: headers length
        // - 4 bytes: prelude CRC
        // - headers
        // - payload
        // - 4 bytes: message CRC

        const totalLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)
        
        if (buffer.length < totalLength) {
          break // 等待更多数据
        }

        const headersLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(4, false)
        
        // 跳过 prelude (12 bytes) 和 headers
        const payloadStart = 12 + headersLength
        const payloadEnd = totalLength - 4 // 减去 message CRC
        
        if (payloadStart < payloadEnd) {
          const payloadBytes = buffer.slice(payloadStart, payloadEnd)
          
          try {
            const payloadText = new TextDecoder().decode(payloadBytes)
            const event = JSON.parse(payloadText)
            
            // 处理不同类型的事件
            if (event.assistantResponseEvent) {
              const content = event.assistantResponseEvent.content
              if (content) {
                accumulatedContent += content
                onChunk(content)
              }
            }
            
            if (event.toolUseEvent) {
              const toolUse: KiroToolUse = {
                toolUseId: event.toolUseEvent.toolUseId || uuidv4(),
                name: event.toolUseEvent.name,
                input: event.toolUseEvent.input || {}
              }
              toolUses.push(toolUse)
              onChunk('', toolUse)
            }
            
            if (event.usageEvent) {
              usage.inputTokens = event.usageEvent.inputTokens || 0
              usage.outputTokens = event.usageEvent.outputTokens || 0
            }
            
            if (event.endOfStreamEvent) {
              // 流结束
            }
            
            if (event.error) {
              throw new Error(event.error.message || 'Unknown stream error')
            }
          } catch (parseError) {
            // 忽略解析错误，可能是二进制数据
            console.debug('[EventStream] Parse error:', parseError)
          }
        }
        
        // 移动到下一条消息
        buffer = buffer.slice(totalLength)
      }
    }
    
    onComplete(usage)
  } catch (error) {
    onError(error as Error)
  } finally {
    reader.releaseLock()
  }
}

// 非流式调用（等待完整响应）
export async function callKiroApi(
  account: ProxyAccount,
  payload: KiroPayload,
  signal?: AbortSignal
): Promise<{
  content: string
  toolUses: KiroToolUse[]
  usage: { inputTokens: number; outputTokens: number }
}> {
  return new Promise((resolve, reject) => {
    let content = ''
    const toolUses: KiroToolUse[] = []
    let usage = { inputTokens: 0, outputTokens: 0 }

    callKiroApiStream(
      account,
      payload,
      (text, toolUse) => {
        content += text
        if (toolUse) {
          toolUses.push(toolUse)
        }
      },
      (u) => {
        usage = u
        resolve({ content, toolUses, usage })
      },
      reject,
      signal
    )
  })
}
