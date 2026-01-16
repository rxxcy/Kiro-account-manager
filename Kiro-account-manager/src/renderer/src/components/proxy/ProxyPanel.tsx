import { useState, useEffect, useCallback } from 'react'
import { Play, Square, RefreshCw, Copy, Check, Server, Users, Activity, AlertCircle, Globe, Zap } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Switch, Badge, Select } from '../ui'
import { useAccountsStore } from '../../store/accounts'

interface ProxyStats {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalTokens: number
  startTime: number
}

interface ProxyConfig {
  enabled: boolean
  port: number
  host: string
  apiKey?: string
  enableMultiAccount: boolean
  logRequests: boolean
  maxRetries?: number
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
}

export function ProxyPanel() {
  const [isRunning, setIsRunning] = useState(false)
  const [config, setConfig] = useState<ProxyConfig>({
    enabled: false,
    port: 5580,
    host: '127.0.0.1',
    enableMultiAccount: true,
    logRequests: true
  })
  const [stats, setStats] = useState<ProxyStats | null>(null)
  const [accountCount, setAccountCount] = useState(0)
  const [availableCount, setAvailableCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentLogs, setRecentLogs] = useState<Array<{ time: string; path: string; status: number; tokens?: number }>>([])

  const accounts = useAccountsStore(state => state.accounts)

  // 获取状态
  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.api.proxyGetStatus()
      setIsRunning(result.running)
      if (result.config) {
        setConfig(result.config as ProxyConfig)
      }
      if (result.stats) {
        setStats(result.stats as ProxyStats)
      }

      const accountsResult = await window.api.proxyGetAccounts()
      setAccountCount(accountsResult.accounts.length)
      setAvailableCount(accountsResult.availableCount)
    } catch (err) {
      console.error('Failed to fetch proxy status:', err)
    }
  }, [])

  // 同步账号到反代池
  const syncAccounts = useCallback(async () => {
    try {
      const proxyAccounts = Array.from(accounts.values())
        .filter(acc => acc.credentials?.accessToken)
        .map(acc => ({
          id: acc.id,
          email: acc.email,
          accessToken: acc.credentials!.accessToken,
          refreshToken: acc.credentials?.refreshToken,
          profileArn: (acc as any).profileArn,
          expiresAt: acc.credentials?.expiresAt,
          // Token 刷新所需字段
          clientId: acc.credentials?.clientId,
          clientSecret: acc.credentials?.clientSecret,
          region: acc.credentials?.region || 'us-east-1',
          authMethod: acc.credentials?.authMethod as 'social' | 'idc' | undefined
        }))

      const result = await window.api.proxySyncAccounts(proxyAccounts)
      if (result.success) {
        setAccountCount(result.accountCount || 0)
        await fetchStatus()
      }
    } catch (err) {
      console.error('Failed to sync accounts:', err)
    }
  }, [accounts, fetchStatus])

  // 启动服务器
  const handleStart = async () => {
    setError(null)
    try {
      // 先同步账号
      await syncAccounts()

      const result = await window.api.proxyStart({
        port: config.port,
        host: config.host,
        enableMultiAccount: config.enableMultiAccount,
        logRequests: config.logRequests
      })

      if (result.success) {
        setIsRunning(true)
        await fetchStatus()
      } else {
        setError(result.error || '启动失败')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // 停止服务器
  const handleStop = async () => {
    setError(null)
    try {
      const result = await window.api.proxyStop()
      if (result.success) {
        setIsRunning(false)
        setStats(null)
      } else {
        setError(result.error || '停止失败')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // 复制地址
  const copyAddress = () => {
    const address = `http://${config.host}:${config.port}`
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 初始化
  useEffect(() => {
    fetchStatus()

    // 监听事件
    const unsubRequest = window.api.onProxyRequest((info) => {
      console.log('[Proxy] Request:', info)
    })

    const unsubResponse = window.api.onProxyResponse((info) => {
      setRecentLogs(prev => [{
        time: new Date().toLocaleTimeString(),
        path: info.path,
        status: info.status,
        tokens: info.tokens
      }, ...prev.slice(0, 19)])

      // 更新统计
      fetchStatus()
    })

    const unsubError = window.api.onProxyError((err) => {
      console.error('[Proxy] Error:', err)
      setError(err)
    })

    const unsubStatus = window.api.onProxyStatusChange((status) => {
      setIsRunning(status.running)
      if (status.running) {
        setConfig(prev => ({ ...prev, port: status.port }))
      }
    })

    return () => {
      unsubRequest()
      unsubResponse()
      unsubError()
      unsubStatus()
    }
  }, [fetchStatus])

  // 账号变化时同步
  useEffect(() => {
    if (isRunning) {
      syncAccounts()
    }
  }, [accounts, isRunning, syncAccounts])

  // 实时更新运行时间
  const [uptime, setUptime] = useState(0)
  useEffect(() => {
    if (!isRunning || !stats) {
      setUptime(0)
      return
    }
    
    // 立即计算一次
    setUptime(Math.floor((Date.now() - stats.startTime) / 1000))
    
    // 每秒更新
    const timer = setInterval(() => {
      setUptime(Math.floor((Date.now() - stats.startTime) / 1000))
    }, 1000)
    
    return () => clearInterval(timer)
  }, [isRunning, stats])
  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h}h ${m}m ${s}s`
  }

  return (
    <div className="space-y-4">
      {/* 状态卡片 */}
      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg text-primary">Kiro API 反代</CardTitle>
                <CardDescription>
                  提供 OpenAI 和 Claude 兼容的 API 端点
                </CardDescription>
              </div>
            </div>
            <Badge 
              variant={isRunning ? 'default' : 'secondary'} 
              className={isRunning ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}
            >
              {isRunning ? '运行中' : '已停止'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 控制按钮 */}
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <Button onClick={handleStart} className="gap-2">
                <Play className="h-4 w-4" />
                启动服务
              </Button>
            ) : (
              <Button onClick={handleStop} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />
                停止服务
              </Button>
            )}
            <Button onClick={syncAccounts} variant="outline" className="gap-2" disabled={!isRunning}>
              <RefreshCw className="h-4 w-4" />
              同步账号
            </Button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* 服务地址 */}
          {isRunning && (
            <div className="flex items-center gap-2">
              <Label className="min-w-[80px]">服务地址:</Label>
              <code className="flex-1 px-3 py-2 bg-muted rounded text-sm">
                http://{config.host}:{config.port}
              </code>
              <Button variant="outline" size="icon" onClick={copyAddress}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {/* 配置 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="port">端口</Label>
              <Input
                id="port"
                type="number"
                value={config.port}
                onChange={(e) => setConfig(prev => ({ ...prev, port: parseInt(e.target.value) || 5580 }))}
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="host">监听地址</Label>
              <Input
                id="host"
                value={config.host}
                onChange={(e) => setConfig(prev => ({ ...prev, host: e.target.value }))}
                disabled={isRunning}
              />
            </div>
          </div>

          {/* API Key 配置 */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key (可选)</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="留空则不验证"
              value={config.apiKey || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value || undefined }))}
              disabled={isRunning}
            />
            <p className="text-xs text-muted-foreground">设置后，请求需要在 Authorization 或 X-Api-Key 头中提供此密钥</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="multiAccount"
                checked={config.enableMultiAccount}
                onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enableMultiAccount: checked }))}
                disabled={isRunning}
              />
              <Label htmlFor="multiAccount">多账号轮询</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="logRequests"
                checked={config.logRequests}
                onCheckedChange={(checked) => setConfig(prev => ({ ...prev, logRequests: checked }))}
              />
              <Label htmlFor="logRequests">记录请求日志</Label>
            </div>
          </div>

          {/* 高级配置 */}
          <div className="border-t border-border pt-4 mt-4">
            <h4 className="text-sm font-medium mb-3 text-foreground">高级配置</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="preferredEndpoint">首选端点</Label>
                <Select
                  value={config.preferredEndpoint || ''}
                  options={[
                    { value: '', label: '自动选择', description: '根据可用性自动选择端点' },
                    { value: 'codewhisperer', label: 'CodeWhisperer', description: 'IDE 模式端点' },
                    { value: 'amazonq', label: 'AmazonQ', description: 'CLI 模式端点' }
                  ]}
                  onChange={(value) => setConfig(prev => ({ 
                    ...prev, 
                    preferredEndpoint: value as 'codewhisperer' | 'amazonq' | undefined || undefined
                  }))}
                  placeholder="选择端点"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxRetries">最大重试次数</Label>
                <Input
                  id="maxRetries"
                  type="number"
                  min={0}
                  max={10}
                  value={config.maxRetries || 3}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxRetries: parseInt(e.target.value) || 3 }))}
                  disabled={isRunning}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      {isRunning && (
        <div className="grid grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 bg-gradient-to-br from-blue-500/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10">
                  <Users className="h-4 w-4 text-blue-500" />
                </div>
                <span className="text-sm text-muted-foreground">账号池</span>
              </div>
              <div className="text-2xl font-bold text-foreground mt-1">{availableCount}/{accountCount}</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 bg-gradient-to-br from-purple-500/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/10">
                  <Activity className="h-4 w-4 text-purple-500" />
                </div>
                <span className="text-sm text-muted-foreground">总请求</span>
              </div>
              <div className="text-2xl font-bold text-foreground mt-1">{stats?.totalRequests || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">成功/失败</div>
              <div className="text-2xl font-bold mt-1">
                <span className="text-green-500">{stats?.successRequests || 0}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-red-500">{stats?.failedRequests || 0}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 bg-gradient-to-br from-primary/5 to-transparent">
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">运行时间</div>
              <div className="text-2xl font-bold text-primary mt-1">{formatUptime(uptime)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* API 端点说明 */}
      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            API 端点
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <code className="text-muted-foreground">POST /v1/chat/completions</code>
            <span>OpenAI 兼容</span>
          </div>
          <div className="flex justify-between">
            <code className="text-muted-foreground">POST /v1/messages</code>
            <span>Claude 兼容</span>
          </div>
          <div className="flex justify-between">
            <code className="text-muted-foreground">GET /v1/models</code>
            <span>模型列表</span>
          </div>
          <div className="flex justify-between">
            <code className="text-muted-foreground">GET /health</code>
            <span>健康检查</span>
          </div>
          <div className="border-t pt-2 mt-2">
            <div className="text-xs text-muted-foreground mb-1">管理 API (需要 API Key)</div>
            <div className="flex justify-between">
              <code className="text-muted-foreground">GET /admin/stats</code>
              <span>详细统计</span>
            </div>
            <div className="flex justify-between">
              <code className="text-muted-foreground">GET /admin/accounts</code>
              <span>账号列表</span>
            </div>
            <div className="flex justify-between">
              <code className="text-muted-foreground">GET /admin/logs</code>
              <span>请求日志</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 功能说明 */}
      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            支持的功能
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">Token 自动刷新</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">请求重试机制</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">多账号轮询</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">IDC/Social 认证</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">Agentic 模式检测</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">Thinking 模式支持</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">图像处理</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span className="text-foreground">使用量统计</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 最近请求日志 */}
      {recentLogs.length > 0 && (
        <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-orange-500/10">
                <Activity className="h-4 w-4 text-orange-500" />
              </div>
              最近请求
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[200px] overflow-auto space-y-1 text-sm font-mono">
              {recentLogs.map((log, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{log.time}</span>
                  <span className="flex-1">{log.path}</span>
                  <Badge variant={log.status === 200 ? 'default' : 'destructive'}>
                    {log.status}
                  </Badge>
                  {log.tokens && <span className="text-muted-foreground">{log.tokens} tokens</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
